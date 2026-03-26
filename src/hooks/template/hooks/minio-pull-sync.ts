import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { config as dotenvConfig } from "dotenv";

const PROJECT_ID = "__PROJECT_ID__";

function resolveRoomTemplate(value: string, projectId: string): string {
  const trimmed = value.trim().replace(/^"|"$/g, "");
  if (!trimmed) return "";
  if (!projectId) return trimmed;
  return trimmed
    .replace(/\{room_id\}/gi, projectId)
    .replace(/room_id/gi, projectId);
}

function resolveApiHookUrl(projectId: string): string {
  const domainTemplate = process.env.API_HOOK_URL_DOMAIN || "";
  if (domainTemplate.trim()) {
    return resolveRoomTemplate(domainTemplate, projectId);
  }

  const explicit = process.env.API_HOOK_URL || "";
  if (explicit.trim()) {
    return resolveRoomTemplate(explicit, projectId);
  }

  const local = process.env.API_HOOK_URL_LOCAL || "";
  if (local.trim()) {
    return resolveRoomTemplate(local, projectId);
  }

  return "";
}

function findWorkspaceRoot(startPath: string = process.cwd()): string {
  const explicitRoot = process.env.CLAUDE_WS_USER_CWD;
  if (explicitRoot && existsSync(path.join(explicitRoot, ".env"))) {
    return explicitRoot;
  }

  let current = path.resolve(startPath);
  while (true) {
    if (existsSync(path.join(current, ".env"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return explicitRoot || process.cwd();
}

function loadRootEnv(startPath: string = process.cwd()): void {
  const workspaceRoot = findWorkspaceRoot(startPath);
  const envPath = path.join(workspaceRoot, ".env");
  if (existsSync(envPath)) {
    dotenvConfig({ path: envPath, override: false });
  }
}

let config: {
  apiBaseUrl: string;
  apiHookApiKey: string;
  projectId: string;
};

function initializeRuntimeConfig() {
  loadRootEnv(process.cwd());
  config = {
    apiBaseUrl: resolveApiHookUrl(PROJECT_ID),
    apiHookApiKey: (process.env.API_HOOK_API_KEY || "").trim(),
    projectId: PROJECT_ID,
  };

  if (!config.apiBaseUrl) {
    console.error("❌ Missing API_HOOK_URL in workspace root .env!");
    process.exit(1);
  }
}

const hooksDir = path.join(process.cwd(), ".claude", "hooks");
const PULL_DB_PATH = path.join(hooksDir, "pull-sync-state.db");
const TMP_DIR = path.join(process.cwd(), ".claude", "tmp");
const PUSH_STATE_FILE = path.join(TMP_DIR, "local-sync-state.json");

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

function getLocalPathFromKey(fileKey: string, folder: FolderType): string {
  const mainPrefix = `${config.projectId}/`;
  const markdownPrefix = `markdown/${config.projectId}/`;

  if (folder === "main") {
    const relative = fileKey.startsWith(mainPrefix) ? fileKey.slice(mainPrefix.length) : fileKey;
    return path.join(process.cwd(), relative);
  }

  const markdownRelative = fileKey.startsWith(markdownPrefix) ? fileKey.slice(markdownPrefix.length) : fileKey;
  return path.join(process.cwd(), "markdown", markdownRelative);
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

async function fetchManifest(label: string, options?: { root?: "markdown"; allowNotFound?: boolean }): Promise<ManifestEntry[]> {
  const root = options?.root;
  const allowNotFound = options?.allowNotFound || false;
  console.error(`🔍 Calling API to get manifest for '${label}'${root ? ` (root=${root})` : ""}...`);

  const url = root ? buildApiUrl(`manifest?root=${encodeURIComponent(root)}`) : buildApiUrl("manifest");
  const response = await fetch(url, { headers: buildApiHeaders() });

  if ((response.status === 404 || response.status === 400) && allowNotFound) {
    console.error(`ℹ️ ${label} not found on remote, treating as empty manifest.`);
    return [];
  }

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

async function getQueueCandidates(): Promise<{ candidates: QueueFileCandidate[]; manifestData: ManifestEntry[] }> {
  const [mainManifest, markdownManifest] = await Promise.all([
    fetchManifest("main folder"),
    fetchManifest("markdown folder", { root: "markdown", allowNotFound: true }),
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

  return {
    candidates: [...normalize(mainManifest, "main"), ...normalize(markdownManifest, "markdown")],
    manifestData: [...mainManifest, ...markdownManifest],
  };
}

async function writePushStateFile(manifestData: ManifestEntry[]): Promise<void> {
  await fs.mkdir(TMP_DIR, { recursive: true });
  await fs.writeFile(PUSH_STATE_FILE, JSON.stringify(manifestData, null, 2), "utf-8");
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
        const localPath = getLocalPathFromKey(candidate.key, candidate.folder);
        if (existsSync(localPath)) {
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
    initializeRuntimeConfig();

    console.error("\n=================== ENQUEUE MINIO PULL JOB ===================");
    const { candidates, manifestData } = await getQueueCandidates();
    await writePushStateFile(manifestData);

    sqlite = await ensurePullDb();
    const result = enqueueCandidates(sqlite, candidates);

    console.error(`✅ Queue DB: ${PULL_DB_PATH}`);
    console.error(`✅ Push state file: ${PUSH_STATE_FILE}`);
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
