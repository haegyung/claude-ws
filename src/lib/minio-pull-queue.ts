import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { db, schema } from './db';
import { asc } from 'drizzle-orm';
import { createLogger } from './logger';
import { buildApiHookEndpoint, resolveApiHookUrl } from './api-hook-url';

const log = createLogger('MinioPullQueue');

export type QueueJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'partial';
export type QueueFileStatus = 'queued' | 'pulling' | 'done' | 'failed' | 'skipped';

export interface ManifestEntry {
  key: string;
  size: number;
  lastModified: string;
  eTag: string;
  url: string;
}

interface HookEnv {
  apiHookUrl: string;
  apiHookApiKey: string;
  projectId: string;
}

interface QueueFileCandidate {
  key: string;
  folder: 'main' | 'markdown';
  fingerprint: string;
  size: number;
  lastModified: string;
  eTag: string;
  sourceKey?: string;
}

interface QueueCounts {
  totalFiles: number;
  enqueuedFiles: number;
  skippedFiles: number;
}

const PULL_DB_FILE = 'pull-sync-state.db';
const WORKER_POLL_INTERVAL_MS = 1500;
const WORKER_MAX_PARALLEL_PROJECTS = 3;
const MAX_CONCURRENT_DOWNLOADS = 5;
const CONCURRENCY_PROBE_BATCH_SIZE = 5;
const MIN_CONCURRENT_DOWNLOADS = 1;
const DOWNLOAD_TIMEOUT_MS = 20_000;
const DOWNLOAD_MAX_RETRIES = 3;
const DOWNLOAD_RETRY_BASE_DELAY_MS = 700;
const MB = 1024 * 1024;
const PROTECTED_MAIN_DIRS = new Set(['.claude', 'temp', 'tmp', 'node_modules', '.git', 'markdown']);

function buildFingerprint(entry: Pick<ManifestEntry, 'size' | 'lastModified' | 'eTag'>): string {
  const eTag = String(entry.eTag || '').trim();
  return eTag.length > 0 ? eTag : `${entry.size}:${entry.lastModified}`;
}

function createConcurrencyLimit(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = () => {
        active += 1;
        fn().then(resolve, reject).finally(() => {
          active -= 1;
          const next = queue.shift();
          if (next) next();
        });
      };

      if (active < concurrency) run();
      else queue.push(run);
    });
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function selectDownloadConcurrency(totalBytes: number, fileCount: number): number {
  if (fileCount <= 0) return MIN_CONCURRENT_DOWNLOADS;

  const averageBytes = totalBytes / fileCount;

  // Large average file sizes should be downloaded more conservatively.
  if (averageBytes >= 120 * MB) return 1;
  if (averageBytes >= 60 * MB) return 2;

  // For smaller files, adjust by total batch size.
  if (totalBytes >= 2 * 1024 * MB) return 1; // >= 2GB
  if (totalBytes >= 800 * MB) return 2;      // >= 800MB
  if (totalBytes >= 300 * MB) return 3;      // >= 300MB
  if (totalBytes >= 120 * MB) return 4;      // >= 120MB

  return MAX_CONCURRENT_DOWNLOADS;
}

function resolveProjectPath(projectPath: string): string {
  if (path.isAbsolute(projectPath)) return projectPath;
  const userCwd = process.env.CLAUDE_WS_USER_CWD || process.cwd();
  return path.resolve(userCwd, projectPath);
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function isProtectedMainRelativePath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath).replace(/^\/+/, '');
  return [...PROTECTED_MAIN_DIRS].some((name) => normalized === name || normalized.startsWith(`${name}/`));
}

function buildLocalFingerprint(size: number, lastModifiedMs: number): string {
  return `${size}:${Math.floor(lastModifiedMs)}`;
}

function getPullQueueDbPath(projectPath: string): string {
  const resolvedProjectPath = resolveProjectPath(projectPath);
  return path.join(resolvedProjectPath, '.claude', 'hooks', PULL_DB_FILE);
}

async function ensurePullQueueDb(projectPath: string): Promise<Database.Database> {
  const resolvedProjectPath = resolveProjectPath(projectPath);
  const hooksDir = path.join(resolvedProjectPath, '.claude', 'hooks');
  await fs.mkdir(hooksDir, { recursive: true });

  const dbPath = getPullQueueDbPath(projectPath);
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

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

async function openExistingPullQueueDb(projectPath: string): Promise<Database.Database | null> {
  const dbPath = getPullQueueDbPath(projectPath);
  if (!fsSync.existsSync(dbPath)) {
    return null;
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  // Keep schema creation idempotent for backward compatibility.
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

async function readHookEnv(projectPath: string, fallbackProjectId: string): Promise<HookEnv> {
  const envPath = path.join(projectPath, '.claude', 'hooks', '.env');
  const content = await fs.readFile(envPath, 'utf-8');

  const map = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, '');
    map.set(key, value);
  }

  const apiHookUrl = resolveApiHookUrl(map);
  if (!apiHookUrl) {
    throw new Error('Missing API_HOOK_URL in project hook .env and process env');
  }
  const apiHookApiKey = map.get('API_HOOK_API_KEY')?.trim()
    || process.env.API_HOOK_API_KEY?.trim()
    || '';

  const projectId = map.get('PROJECT_ID')?.trim() || fallbackProjectId;
  return { apiHookUrl, apiHookApiKey, projectId };
}

function buildApiHeaders(apiHookApiKey: string): Record<string, string> {
  if (!apiHookApiKey) return {};
  return { 'x-api-key': apiHookApiKey };
}

async function fetchManifest(
  apiHookUrl: string,
  apiHookApiKey: string,
  folder: string,
  label: string
): Promise<ManifestEntry[]> {
  const url = buildApiHookEndpoint(apiHookUrl, `manifest?folder=${encodeURIComponent(folder)}`);
  const response = await fetch(url, { headers: buildApiHeaders(apiHookApiKey) });
  if (!response.ok) {
    throw new Error(`Manifest API failed for ${label}: HTTP ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  if (json.status !== 'success' || !Array.isArray(json.data)) {
    throw new Error(`Invalid manifest payload for ${label}`);
  }

  return json.data as ManifestEntry[];
}

async function scanLocalFolderCandidates(
  projectPath: string,
  projectId: string,
  folder: 'main' | 'markdown'
): Promise<QueueFileCandidate[]> {
  const root = resolveProjectPath(projectPath);
  const baseDir = folder === 'main' ? root : path.join(root, 'markdown');
  const keyPrefix = folder === 'main' ? `${projectId}/` : `markdown/${projectId}/`;
  const candidates: QueueFileCandidate[] = [];

  const walk = async (currentPath: string) => {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = normalizeRelativePath(path.relative(baseDir, absolutePath));

      if (folder === 'main' && entry.isDirectory() && isProtectedMainRelativePath(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (folder === 'main' && isProtectedMainRelativePath(relativePath)) {
        continue;
      }

      if (!relativePath || relativePath.startsWith('../')) {
        continue;
      }

      const stats = await fs.stat(absolutePath);
      candidates.push({
        key: `${keyPrefix}${relativePath}`,
        folder,
        fingerprint: `delete-local:${buildLocalFingerprint(stats.size, stats.mtimeMs)}`,
        size: stats.size,
        lastModified: new Date(stats.mtimeMs).toISOString(),
        eTag: '',
      });
    }
  };

  try {
    await walk(baseDir);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  return candidates;
}

async function fetchQueueCandidates(
  apiHookUrl: string,
  apiHookApiKey: string,
  projectPath: string,
  projectId: string,
  sqlite: Database.Database
): Promise<QueueFileCandidate[]> {
  const targetPrefix = projectId;
  const markdownPrefix = `markdown/${projectId}`;

  const [mainManifest, markdownManifest] = await Promise.all([
    fetchManifest(apiHookUrl, apiHookApiKey, targetPrefix, 'main folder'),
    fetchManifest(apiHookUrl, apiHookApiKey, markdownPrefix, 'markdown folder'),
  ]);

  const normalize = (entries: ManifestEntry[], folder: 'main' | 'markdown'): QueueFileCandidate[] => (
    entries.map((entry) => ({
      key: entry.key,
      folder,
      fingerprint: buildFingerprint(entry),
      size: entry.size,
      lastModified: entry.lastModified,
      eTag: entry.eTag,
    }))
  );

  const remoteCandidates = [...normalize(mainManifest, 'main'), ...normalize(markdownManifest, 'markdown')];
  const [localMain, localMarkdown] = await Promise.all([
    scanLocalFolderCandidates(projectPath, projectId, 'main'),
    scanLocalFolderCandidates(projectPath, projectId, 'markdown'),
  ]);
  const localKeySet = new Set([...localMain, ...localMarkdown].map((candidate) => candidate.key));
  const remoteKeys = new Set(remoteCandidates.map((candidate) => candidate.key));
  const staleLocalCandidates = [...localMain, ...localMarkdown].filter((candidate) => !remoteKeys.has(candidate.key));
  const staleByKey = new Map(staleLocalCandidates.map((candidate) => [candidate.key, candidate]));
  const readDoneStateStmt = sqlite.prepare(`
    SELECT fingerprint
    FROM file_sync_state
    WHERE file_key = ? AND status = 'done'
  `);
  const staleByFingerprint = new Map<string, string[]>();
  for (const staleCandidate of staleLocalCandidates) {
    const row = readDoneStateStmt.get(staleCandidate.key) as { fingerprint?: string } | undefined;
    const knownFingerprint = row?.fingerprint?.trim();
    if (!knownFingerprint) continue;

    const bucketKey = `${staleCandidate.folder}:${knownFingerprint}`;
    const bucket = staleByFingerprint.get(bucketKey) ?? [];
    bucket.push(staleCandidate.key);
    staleByFingerprint.set(bucketKey, bucket);
  }

  for (const remoteCandidate of remoteCandidates) {
    if (localKeySet.has(remoteCandidate.key)) continue;

    const bucketKey = `${remoteCandidate.folder}:${remoteCandidate.fingerprint}`;
    const bucket = staleByFingerprint.get(bucketKey);
    if (!bucket || bucket.length === 0) continue;

    const sourceKey = bucket.shift();
    if (!sourceKey) continue;

    remoteCandidate.sourceKey = sourceKey;
    staleByKey.delete(sourceKey);
  }

  return [...remoteCandidates, ...staleByKey.values()];
}

function enqueueInDb(
  sqlite: Database.Database,
  projectId: string,
  candidates: QueueFileCandidate[]
): { jobId: string; counts: QueueCounts } {
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

  const updateJobCountsStmt = sqlite.prepare(`
    UPDATE pull_jobs
    SET total_files = ?, enqueued_files = ?, skipped_files = ?, status = ?, finished_at = ?
    WHERE id = ?
  `);

  const tx = sqlite.transaction(() => {
    insertJobStmt.run(jobId, projectId, now);

    let enqueuedFiles = 0;
    let skippedFiles = 0;

    for (const candidate of candidates) {
      const existing = readStateStmt.get(candidate.key) as { status: string; fingerprint: string } | undefined;

      if (existing?.status === 'pulling') {
        skippedFiles += 1;
        insertJobFileStmt.run(
          jobId,
          candidate.key,
          candidate.folder,
          candidate.fingerprint,
          'skipped',
          'Skipped: file currently pulling',
          now
        );
        continue;
      }

      if (existing?.status === 'done' && existing.fingerprint === candidate.fingerprint) {
        skippedFiles += 1;
        insertJobFileStmt.run(
          jobId,
          candidate.key,
          candidate.folder,
          candidate.fingerprint,
          'skipped',
          'Skipped: already done with same fingerprint',
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
        'queued',
        null,
        now
      );
    }

    const totalFiles = candidates.length;
    const status: QueueJobStatus = enqueuedFiles === 0 ? 'completed' : 'queued';
    updateJobCountsStmt.run(totalFiles, enqueuedFiles, skippedFiles, status, enqueuedFiles === 0 ? now : null, jobId);

    return { totalFiles, enqueuedFiles, skippedFiles };
  });

  const counts = tx() as QueueCounts;
  return { jobId, counts };
}

export async function enqueueProjectPullSync(projectPath: string, fallbackProjectId: string) {
  const hookEnv = await readHookEnv(projectPath, fallbackProjectId);
  const sqlite = await ensurePullQueueDb(projectPath);

  try {
    const candidates = await fetchQueueCandidates(
      hookEnv.apiHookUrl,
      hookEnv.apiHookApiKey,
      projectPath,
      hookEnv.projectId,
      sqlite
    );
    const { jobId, counts } = enqueueInDb(sqlite, hookEnv.projectId, candidates);
    return {
      jobId,
      counts,
      dbPath: getPullQueueDbPath(projectPath),
      projectId: hookEnv.projectId,
    };
  } finally {
    sqlite.close();
  }
}

function getLocalPath(projectPath: string, key: string, projectId: string, folder: 'main' | 'markdown'): string {
  const mainPrefix = `${projectId}/`;
  const markdownPrefix = `markdown/${projectId}/`;

  if (folder === 'main') {
    const relative = key.startsWith(mainPrefix) ? key.slice(mainPrefix.length) : key;
    return path.join(projectPath, relative);
  }

  const markdownRelative = key.startsWith(markdownPrefix) ? key.slice(markdownPrefix.length) : key;
  return path.join(projectPath, 'markdown', markdownRelative);
}

async function downloadFile(url: string, destination: string) {
  const dir = path.dirname(destination);
  if (dir !== '.' && dir !== process.cwd()) {
    await fs.mkdir(dir, { recursive: true });
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= DOWNLOAD_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, DOWNLOAD_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        const retryableStatus = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
        const httpError = new Error(`HTTP ${response.status} ${response.statusText}`);
        if (!retryableStatus || attempt === DOWNLOAD_MAX_RETRIES) {
          throw httpError;
        }
        lastError = httpError;
      } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(destination, buffer);
        clearTimeout(timeout);
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown fetch error';
      lastError = error instanceof Error ? error : new Error(message);

      if (attempt === DOWNLOAD_MAX_RETRIES) {
        clearTimeout(timeout);
        break;
      }
    } finally {
      clearTimeout(timeout);
    }

    const delayMs = DOWNLOAD_RETRY_BASE_DELAY_MS * attempt;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Download failed after ${DOWNLOAD_MAX_RETRIES} attempts: ${lastError?.message || 'Unknown error'}`);
}

async function deleteLocalFileByKey(
  projectPath: string,
  fileKey: string,
  projectId: string,
  folder: 'main' | 'markdown'
): Promise<void> {
  const projectRoot = resolveProjectPath(projectPath);
  const destination = getLocalPath(projectPath, fileKey, projectId, folder);
  const resolvedDestination = path.resolve(destination);
  if (resolvedDestination !== projectRoot && !resolvedDestination.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`Refusing to delete path outside project: ${resolvedDestination}`);
  }

  if (folder === 'main') {
    const mainPrefix = `${projectId}/`;
    const relativePath = fileKey.startsWith(mainPrefix) ? fileKey.slice(mainPrefix.length) : fileKey;
    if (isProtectedMainRelativePath(relativePath)) {
      return;
    }
  }

  await fs.unlink(resolvedDestination).catch((error: any) => {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  });
}

async function moveLocalFileByKey(
  projectPath: string,
  sourceKey: string,
  targetKey: string,
  projectId: string,
  folder: 'main' | 'markdown'
): Promise<boolean> {
  const projectRoot = resolveProjectPath(projectPath);
  const sourcePath = path.resolve(getLocalPath(projectPath, sourceKey, projectId, folder));
  const targetPath = path.resolve(getLocalPath(projectPath, targetKey, projectId, folder));

  if (sourcePath !== projectRoot && !sourcePath.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`Refusing to move source outside project: ${sourcePath}`);
  }
  if (targetPath !== projectRoot && !targetPath.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`Refusing to move target outside project: ${targetPath}`);
  }

  if (folder === 'main') {
    const mainPrefix = `${projectId}/`;
    const sourceRelative = sourceKey.startsWith(mainPrefix) ? sourceKey.slice(mainPrefix.length) : sourceKey;
    const targetRelative = targetKey.startsWith(mainPrefix) ? targetKey.slice(mainPrefix.length) : targetKey;
    if (isProtectedMainRelativePath(sourceRelative) || isProtectedMainRelativePath(targetRelative)) {
      return false;
    }
  }

  const sourceExists = await fs.access(sourcePath).then(() => true).catch(() => false);
  if (!sourceExists) return false;

  const targetExists = await fs.access(targetPath).then(() => true).catch(() => false);
  if (targetExists) return false;

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error: any) {
    if (error?.code !== 'EXDEV') {
      throw error;
    }
    await fs.copyFile(sourcePath, targetPath);
    await fs.unlink(sourcePath);
  }

  return true;
}

interface PendingJob {
  id: string;
  projectId: string;
  requestedAt: number;
}

function getFirstQueuedJob(sqlite: Database.Database): PendingJob | null {
  const row = sqlite.prepare(`
    SELECT id, project_id as projectId, requested_at as requestedAt
    FROM pull_jobs
    WHERE status = 'queued'
    ORDER BY requested_at ASC
    LIMIT 1
  `).get() as PendingJob | undefined;

  return row || null;
}

function markJobRunning(sqlite: Database.Database, jobId: string): boolean {
  const now = Date.now();
  const result = sqlite.prepare(`
    UPDATE pull_jobs
    SET status = 'running', started_at = ?, error = NULL
    WHERE id = ? AND status = 'queued'
  `).run(now, jobId);

  return result.changes > 0;
}

function finishJob(sqlite: Database.Database, jobId: string, status: QueueJobStatus, error: string | null): void {
  sqlite.prepare(`
    UPDATE pull_jobs
    SET status = ?, finished_at = ?, error = ?
    WHERE id = ?
  `).run(status, Date.now(), error, jobId);
}

function markJobFileStatus(
  sqlite: Database.Database,
  jobId: string,
  fileKey: string,
  status: QueueFileStatus,
  lastError: string | null,
  incrementAttempt = false
): void {
  const attemptSql = incrementAttempt ? 'attempt_count = attempt_count + 1,' : '';
  sqlite.prepare(`
    UPDATE pull_job_files
    SET status = ?, ${attemptSql} last_error = ?, updated_at = ?
    WHERE job_id = ? AND file_key = ?
  `).run(status, lastError, Date.now(), jobId, fileKey);
}

function upsertFileState(
  sqlite: Database.Database,
  fileKey: string,
  folder: 'main' | 'markdown',
  status: 'pulling' | 'done' | 'failed',
  fingerprint: string,
  size: number,
  lastModified: string,
  eTag: string,
  jobId: string
): void {
  sqlite.prepare(`
    INSERT INTO file_sync_state (
      file_key, folder, status, fingerprint, size, last_modified, etag, last_job_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_key) DO UPDATE SET
      folder = excluded.folder,
      status = excluded.status,
      fingerprint = excluded.fingerprint,
      size = excluded.size,
      last_modified = excluded.last_modified,
      etag = excluded.etag,
      last_job_id = excluded.last_job_id,
      updated_at = excluded.updated_at
  `).run(fileKey, folder, status, fingerprint, size, lastModified, eTag, jobId, Date.now());
}

function removeFileState(sqlite: Database.Database, fileKey: string): void {
  sqlite.prepare(`
    DELETE FROM file_sync_state
    WHERE file_key = ?
  `).run(fileKey);
}

function shouldSkipByState(
  sqlite: Database.Database,
  fileKey: string,
  fingerprint: string
): { skip: boolean; reason: string | null } {
  const row = sqlite.prepare(`
    SELECT status, fingerprint
    FROM file_sync_state
    WHERE file_key = ?
  `).get(fileKey) as { status: 'pulling' | 'done' | 'failed'; fingerprint: string } | undefined;

  if (!row) {
    return { skip: false, reason: null };
  }

  if (row.status === 'pulling') {
    return { skip: true, reason: 'Skipped while pulling by another job' };
  }

  if (row.status === 'done' && row.fingerprint === fingerprint) {
    return { skip: true, reason: 'Skipped: done with same fingerprint' };
  }

  return { skip: false, reason: null };
}

async function processJob(projectPath: string, projectId: string, job: PendingJob): Promise<void> {
  const sqlite = await openExistingPullQueueDb(projectPath);
  if (!sqlite) {
    return;
  }

  try {
    if (!markJobRunning(sqlite, job.id)) {
      return;
    }

    const hookEnv = await readHookEnv(projectPath, projectId);
    const candidates = await fetchQueueCandidates(
      hookEnv.apiHookUrl,
      hookEnv.apiHookApiKey,
      projectPath,
      hookEnv.projectId,
      sqlite
    );
    const manifestMap = new Map(candidates.map((entry) => [entry.key, entry]));

    const jobFiles = sqlite.prepare(`
      SELECT file_key as fileKey, folder, fingerprint
      FROM pull_job_files
      WHERE job_id = ? AND status IN ('queued','pulling')
      ORDER BY id ASC
    `).all(job.id) as Array<{ fileKey: string; folder: 'main' | 'markdown'; fingerprint: string }>;

    const fileBatches = chunkArray(jobFiles, CONCURRENCY_PROBE_BATCH_SIZE);
    for (const [batchIndex, batchRows] of fileBatches.entries()) {
      const batchProbeBytes = batchRows.reduce((sum, row) => {
        const candidate = manifestMap.get(row.fileKey);
        return sum + (candidate?.size || 0);
      }, 0);
      const chosenConcurrency = selectDownloadConcurrency(batchProbeBytes, batchRows.length);
      log.info({
        jobId: job.id,
        projectId,
        totalFileCount: jobFiles.length,
        batchIndex,
        batchFileCount: batchRows.length,
        batchProbeBytes,
        chosenConcurrency,
      }, 'MinIO pull job concurrency selected for batch');

      const limit = createConcurrencyLimit(chosenConcurrency);
      await Promise.all(batchRows.map((row) =>
        limit(async () => {
        const candidate = manifestMap.get(row.fileKey);
        if (!candidate) {
          markJobFileStatus(sqlite, job.id, row.fileKey, 'skipped', 'Skipped: file missing in latest manifest');
          return;
        }

        const shouldSkip = shouldSkipByState(sqlite, row.fileKey, candidate.fingerprint);
        if (shouldSkip.skip) {
          markJobFileStatus(sqlite, job.id, row.fileKey, 'skipped', shouldSkip.reason);
          return;
        }

        markJobFileStatus(sqlite, job.id, row.fileKey, 'pulling', null);
        upsertFileState(
          sqlite,
          row.fileKey,
          row.folder,
          'pulling',
          candidate.fingerprint,
          candidate.size,
          candidate.lastModified,
          candidate.eTag,
          job.id
        );

        try {
          if (row.fingerprint.startsWith('delete-local:')) {
            await deleteLocalFileByKey(projectPath, row.fileKey, hookEnv.projectId, row.folder);
            markJobFileStatus(sqlite, job.id, row.fileKey, 'done', null);
            upsertFileState(
              sqlite,
              row.fileKey,
              row.folder,
              'done',
              row.fingerprint,
              candidate.size,
              candidate.lastModified,
              candidate.eTag,
              job.id
            );
            return;
          }

          if (candidate.sourceKey) {
            const moved = await moveLocalFileByKey(projectPath, candidate.sourceKey, row.fileKey, hookEnv.projectId, row.folder);
            if (moved) {
              const remoteDate = new Date(candidate.lastModified);
              const movedPath = getLocalPath(projectPath, row.fileKey, hookEnv.projectId, row.folder);
              await fs.utimes(movedPath, remoteDate, remoteDate).catch(() => undefined);

              markJobFileStatus(sqlite, job.id, row.fileKey, 'done', null);
              removeFileState(sqlite, candidate.sourceKey);
              upsertFileState(
                sqlite,
                row.fileKey,
                row.folder,
                'done',
                candidate.fingerprint,
                candidate.size,
                candidate.lastModified,
                candidate.eTag,
                job.id
              );
              return;
            }
          }

          const manifestEntry = await fetchManifest(
            hookEnv.apiHookUrl,
            hookEnv.apiHookApiKey,
            row.folder === 'main' ? hookEnv.projectId : `markdown/${hookEnv.projectId}`,
            row.folder
          );
          const latest = manifestEntry.find((entry) => entry.key === row.fileKey);
          if (!latest) {
            markJobFileStatus(sqlite, job.id, row.fileKey, 'skipped', 'Skipped: file removed before download');
            return;
          }

          const destination = getLocalPath(projectPath, latest.key, hookEnv.projectId, row.folder);
          await downloadFile(latest.url, destination);

          const remoteDate = new Date(latest.lastModified);
          await fs.utimes(destination, remoteDate, remoteDate).catch(() => undefined);

          markJobFileStatus(sqlite, job.id, row.fileKey, 'done', null);
          upsertFileState(
            sqlite,
            latest.key,
            row.folder,
            'done',
            buildFingerprint(latest),
            latest.size,
            latest.lastModified,
            latest.eTag,
            job.id
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown download error';
          markJobFileStatus(sqlite, job.id, row.fileKey, 'failed', message, true);
          upsertFileState(
            sqlite,
            row.fileKey,
            row.folder,
            'failed',
            row.fingerprint,
            candidate.size,
            candidate.lastModified,
            candidate.eTag,
            job.id
          );
        }
      })
      ));
    }

    const summary = sqlite.prepare(`
      SELECT
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedCount,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as doneCount,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skippedCount
      FROM pull_job_files
      WHERE job_id = ?
    `).get(job.id) as { failedCount: number | null; doneCount: number | null; skippedCount: number | null };

    const failed = Number(summary.failedCount || 0);
    const done = Number(summary.doneCount || 0);
    const skipped = Number(summary.skippedCount || 0);

    if (failed > 0 && done === 0 && skipped === 0) {
      finishJob(sqlite, job.id, 'failed', `All files failed (${failed})`);
    } else if (failed > 0) {
      finishJob(sqlite, job.id, 'partial', `Some files failed (${failed})`);
    } else {
      finishJob(sqlite, job.id, 'completed', null);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown worker error';
    finishJob(sqlite, job.id, 'failed', message);
  } finally {
    sqlite.close();
  }
}

async function findRunnableProjects(): Promise<Array<{ id: string; path: string }>> {
  const projects = await db
    .select({ id: schema.projects.id, path: schema.projects.path })
    .from(schema.projects)
    .orderBy(asc(schema.projects.createdAt));

  return projects;
}

export class MinioPullQueueWorker {
  private timer: NodeJS.Timeout | null = null;
  private readonly activeProjectIds = new Set<string>();
  private running = false;
  private recoveredStaleJobs = false;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.recoveredStaleJobs = false;

    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        log.error({ err: error }, 'MinIO pull worker tick failed');
      });
    }, WORKER_POLL_INTERVAL_MS);

    this.timer.unref();
    log.info('MinIO pull queue worker started');
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info('MinIO pull queue worker stopped');
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    if (this.activeProjectIds.size >= WORKER_MAX_PARALLEL_PROJECTS) return;

    if (!this.recoveredStaleJobs) {
      await this.recoverStaleRunningJobs();
      this.recoveredStaleJobs = true;
    }

    const projects = await findRunnableProjects();

    for (const project of projects) {
      if (this.activeProjectIds.size >= WORKER_MAX_PARALLEL_PROJECTS) break;
      if (this.activeProjectIds.has(project.id)) continue;

      let sqlite: Database.Database | null = null;
      try {
        sqlite = await openExistingPullQueueDb(project.path);
        if (!sqlite) {
          continue;
        }
        const nextJob = getFirstQueuedJob(sqlite);
        if (!nextJob) continue;

        this.activeProjectIds.add(project.id);

        void processJob(project.path, project.id, nextJob)
          .catch((error) => {
            log.error({ err: error, projectId: project.id, jobId: nextJob.id }, 'Failed to process pull job');
          })
          .finally(() => {
            this.activeProjectIds.delete(project.id);
          });
      } catch (error) {
        log.error({ err: error, projectId: project.id }, 'Worker failed to inspect project queue');
      } finally {
        if (sqlite) sqlite.close();
      }
    }
  }

  private async recoverStaleRunningJobs(): Promise<void> {
    const projects = await findRunnableProjects();

    for (const project of projects) {
      let sqlite: Database.Database | null = null;
      try {
        sqlite = await openExistingPullQueueDb(project.path);
        if (!sqlite) {
          continue;
        }
        const now = Date.now();

        sqlite.prepare(`
          UPDATE pull_jobs
          SET status = 'failed', finished_at = ?, error = COALESCE(error, 'Worker restarted before job completion')
          WHERE status = 'running'
        `).run(now);

        sqlite.prepare(`
          UPDATE pull_job_files
          SET status = 'failed', last_error = COALESCE(last_error, 'Worker restarted before file completion'), updated_at = ?
          WHERE status = 'pulling'
        `).run(now);

        sqlite.prepare(`
          UPDATE file_sync_state
          SET status = 'failed', updated_at = ?
          WHERE status = 'pulling'
        `).run(now);
      } catch (error) {
        log.warn({ err: error, projectId: project.id }, 'Failed to recover stale pull jobs');
      } finally {
        if (sqlite) sqlite.close();
      }
    }
  }
}

let workerSingleton: MinioPullQueueWorker | null = null;

export function getMinioPullQueueWorker(): MinioPullQueueWorker {
  if (!workerSingleton) {
    workerSingleton = new MinioPullQueueWorker();
  }
  return workerSingleton;
}
