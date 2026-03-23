import fs from "fs/promises";
import path from "path";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";

// Load .env from .claude/hooks/ directory
import { config as dotenvConfig } from "dotenv";
const hooksDir = path.join(process.cwd(), ".claude", "hooks");
dotenvConfig({ path: path.join(hooksDir, ".env") });

const config = {
  apiBaseUrl: process.env.API_HOOK_URL as string,
  apiHookApiKey: (process.env.API_HOOK_API_KEY || "").trim(),
  projectId: (process.env.PROJECT_ID || "__PROJECT_ID__") as string,
};

if (!config.apiBaseUrl) {
  console.error("❌ Missing API_HOOK_URL in .env!");
  process.exit(1);
}

const PULL_DB_PATH = path.join(hooksDir, "pull-sync-state.db");

function buildApiUrl(endpoint: string): string {
  const base = String(config.apiBaseUrl || "").replace(/\/+$/g, "");
  const path = endpoint.replace(/^\/+/g, "");
  return `${base}/${path}`;
}

function buildApiHeaders(): HeadersInit {
  if (!config.apiHookApiKey) return {};
  return { "x-api-key": config.apiHookApiKey };
}

type QueueJobStatus = "queued" | "running" | "completed" | "failed" | "partial";
type FolderType = "main" | "markdown";

export interface ManifestEntry {
  key: string;
  size: number;
  lastModified: string;
  eTag: string;
  url: string;
}

interface QueueFileCandidate {
  key: string;
  folder: FolderType;
  fingerprint: string;
  size: number;
  lastModified: string;
  eTag: string;
}

function buildFingerprint(entry: Pick<ManifestEntry, "size" | "lastModified" | "eTag">): string {
  const eTag = String(entry.eTag || "").trim();
  return eTag.length > 0 ? eTag : `${entry.size}:${entry.lastModified}`;
}

async function ensurePullDb(): Promise<Database.Database> {
  await fs.mkdir(hooksDir, { recursive: true });

  const sqlite = new Database(PULL_DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS pull_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','partial')),
      requested_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      total_files INTEGER NOT NULL DEFAULT 0,
      enqueued_files INTEGER NOT NULL DEFAULT 0,
      skipped_files INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS pull_job_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      file_key TEXT NOT NULL,
      folder TEXT NOT NULL CHECK(folder IN ('main','markdown')),
      fingerprint TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','pulling','done','failed','skipped')),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (job_id) REFERENCES pull_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS file_sync_state (
      file_key TEXT PRIMARY KEY,
      folder TEXT NOT NULL CHECK(folder IN ('main','markdown')),
      status TEXT NOT NULL CHECK(status IN ('pulling','done','failed')),
      fingerprint TEXT NOT NULL,
      size INTEGER NOT NULL,
      last_modified TEXT NOT NULL,
      etag TEXT,
      last_job_id TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pull_jobs_status_requested_at ON pull_jobs(status, requested_at);
    CREATE INDEX IF NOT EXISTS idx_pull_job_files_job_status ON pull_job_files(job_id, status);
    CREATE INDEX IF NOT EXISTS idx_file_sync_state_status_updated_at ON file_sync_state(status, updated_at);
  `);

  return sqlite;
}

async function fetchManifest(folder: string, label: string): Promise<ManifestEntry[]> {
  console.error(`🔍 Calling API to get manifest for '${label}' (${folder})...`);

  const url = buildApiUrl(`manifest?folder=${encodeURIComponent(folder)}`);
  const response = await fetch(url, { headers: buildApiHeaders() });

  if (!response.ok) {
    throw new Error(`API manifest failed for ${label}: HTTP ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  if (json.status !== "success" || !Array.isArray(json.data)) {
    throw new Error(`API manifest error for ${label}: ${json.message || "Invalid payload"}`);
  }

  const objects: ManifestEntry[] = json.data;
  console.error(`✅ Got ${objects.length} files from ${label}.`);

  return objects;
}

async function getQueueCandidates(): Promise<QueueFileCandidate[]> {
  const mainPrefix = config.projectId;
  const markdownPrefix = `markdown/${config.projectId}`;

  const [mainManifest, markdownManifest] = await Promise.all([
    fetchManifest(mainPrefix, "main folder"),
    fetchManifest(markdownPrefix, "markdown folder"),
  ]);

  const normalize = (entries: ManifestEntry[], folder: FolderType): QueueFileCandidate[] => (
    entries.map((entry) => ({
      key: entry.key,
      folder,
      fingerprint: buildFingerprint(entry),
      size: entry.size,
      lastModified: entry.lastModified,
      eTag: entry.eTag,
    }))
  );

  return [...normalize(mainManifest, "main"), ...normalize(markdownManifest, "markdown")];
}

function enqueueCandidates(
  sqlite: Database.Database,
  candidates: QueueFileCandidate[]
): { jobId: string; status: QueueJobStatus; totalFiles: number; enqueuedFiles: number; skippedFiles: number } {
  const now = Date.now();
  const jobId = randomUUID();

  const readStateStmt = sqlite.prepare(`
    SELECT status, fingerprint
    FROM file_sync_state
    WHERE file_key = ?
  `);

  const insertJobStmt = sqlite.prepare(`
    INSERT INTO pull_jobs (
      id, project_id, status, requested_at, total_files, enqueued_files, skipped_files
    ) VALUES (?, ?, 'queued', ?, 0, 0, 0)
  `);

  const insertJobFileStmt = sqlite.prepare(`
    INSERT INTO pull_job_files (
      job_id, file_key, folder, fingerprint, status, attempt_count, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
  `);

  const updateJobStmt = sqlite.prepare(`
    UPDATE pull_jobs
    SET total_files = ?, enqueued_files = ?, skipped_files = ?, status = ?, finished_at = ?
    WHERE id = ?
  `);

  const tx = sqlite.transaction(() => {
    insertJobStmt.run(jobId, config.projectId, now);

    let enqueuedFiles = 0;
    let skippedFiles = 0;

    for (const candidate of candidates) {
      const state = readStateStmt.get(candidate.key) as { status: string; fingerprint: string } | undefined;

      if (state?.status === "pulling") {
        skippedFiles += 1;
        insertJobFileStmt.run(
          jobId,
          candidate.key,
          candidate.folder,
          candidate.fingerprint,
          "skipped",
          "Skipped: file currently pulling",
          now
        );
        continue;
      }

      if (state?.status === "done" && state.fingerprint === candidate.fingerprint) {
        skippedFiles += 1;
        insertJobFileStmt.run(
          jobId,
          candidate.key,
          candidate.folder,
          candidate.fingerprint,
          "skipped",
          "Skipped: already done with same fingerprint",
          now
        );
        continue;
      }

      enqueuedFiles += 1;
      insertJobFileStmt.run(
        jobId,
        candidate.key,
        candidate.folder,
        candidate.fingerprint,
        "queued",
        null,
        now
      );
    }

    const totalFiles = candidates.length;
    const status: QueueJobStatus = enqueuedFiles === 0 ? "completed" : "queued";
    updateJobStmt.run(totalFiles, enqueuedFiles, skippedFiles, status, enqueuedFiles === 0 ? now : null, jobId);

    return { jobId, status, totalFiles, enqueuedFiles, skippedFiles };
  });

  return tx() as { jobId: string; status: QueueJobStatus; totalFiles: number; enqueuedFiles: number; skippedFiles: number };
}

async function runEnqueue() {
  let sqlite: Database.Database | null = null;
  try {
    console.error("\n=================== ENQUEUE MINIO PULL JOB ===================");
    const candidates = await getQueueCandidates();

    sqlite = await ensurePullDb();
    const result = enqueueCandidates(sqlite, candidates);

    console.error(`✅ Queue DB: ${PULL_DB_PATH}`);
    console.error(`🧾 Job ID: ${result.jobId}`);
    console.error(`📊 Total: ${result.totalFiles} | Enqueued: ${result.enqueuedFiles} | Skipped: ${result.skippedFiles}`);
    console.error(`📌 Job status: ${result.status}`);
    console.error("🎉 Pull job enqueued successfully.");
  } catch (error) {
    console.error("❌ Enqueue pull job failed:", error);
    process.exitCode = 1;
  } finally {
    if (sqlite) sqlite.close();
  }
}

void runEnqueue();
