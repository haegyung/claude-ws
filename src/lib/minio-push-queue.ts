import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { asc } from 'drizzle-orm';
import { db, schema } from './db';
import { createLogger } from './logger';
import { buildApiHookEndpoint, resolveApiHookUrl } from './api-hook-url';

const log = createLogger('MinioPushQueue');

export type PushJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'partial';
export type PushFileStatus = 'queued' | 'pushing' | 'deleting' | 'done' | 'failed' | 'skipped';
export type PushOperation = 'upload' | 'delete';

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

interface LocalFileCandidate {
  key: string;
  absolutePath: string;
  size: number;
  lastModified: number;
  fingerprint: string;
}

interface QueueOperationCandidate {
  operation: PushOperation;
  key: string;
  localPath: string | null;
  size: number;
  lastModified: number;
  fingerprint: string;
}

interface PendingJob {
  id: string;
  projectId: string;
  requestedAt: number;
}

interface QueueCounts {
  totalFiles: number;
  enqueuedFiles: number;
  skippedFiles: number;
}

const PUSH_DB_FILE = 'push-sync-state.db';
const WORKER_POLL_INTERVAL_MS = 1500;
const WORKER_MAX_PARALLEL_PROJECTS = 3;
const MAX_CONCURRENT_OPERATIONS = 5;
const CONCURRENCY_PROBE_BATCH_SIZE = 5;
const MIN_CONCURRENT_OPERATIONS = 1;
const REQUEST_TIMEOUT_MS = 20_000;
const REQUEST_MAX_RETRIES = 3;
const REQUEST_RETRY_BASE_DELAY_MS = 700;
const FILE_MODIFIED_SKEW_MS = 2_000;
const MB = 1024 * 1024;
const IGNORED_DIRS = new Set(['.claude', 'temp', 'tmp', 'node_modules', '.git', 'markdown']);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildFingerprint(size: number, lastModified: number): string {
  return `${size}:${lastModified}`;
}

function createConcurrencyLimit(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = () => {
        active += 1;
        fn()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            const next = queue.shift();
            if (next) next();
          });
      };

      if (active < concurrency) {
        run();
      } else {
        queue.push(run);
      }
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

function selectOperationConcurrency(totalBytes: number, fileCount: number): number {
  if (fileCount <= 0) return MIN_CONCURRENT_OPERATIONS;

  const averageBytes = totalBytes / fileCount;

  if (averageBytes >= 120 * MB) return 1;
  if (averageBytes >= 60 * MB) return 2;

  if (totalBytes >= 2 * 1024 * MB) return 1; // >= 2GB
  if (totalBytes >= 800 * MB) return 2;      // >= 800MB
  if (totalBytes >= 300 * MB) return 3;      // >= 300MB
  if (totalBytes >= 120 * MB) return 4;      // >= 120MB

  return MAX_CONCURRENT_OPERATIONS;
}

function resolveProjectPath(projectPath: string): string {
  if (path.isAbsolute(projectPath)) return projectPath;
  const userCwd = process.env.CLAUDE_WS_USER_CWD || process.cwd();
  return path.resolve(userCwd, projectPath);
}

function getPushQueueDbPath(projectPath: string): string {
  const resolvedProjectPath = resolveProjectPath(projectPath);
  return path.join(resolvedProjectPath, '.claude', 'hooks', PUSH_DB_FILE);
}

const PUSH_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS push_jobs (
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

  CREATE TABLE IF NOT EXISTS push_job_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN ('upload','delete')),
    file_key TEXT NOT NULL,
    local_path TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    last_modified INTEGER NOT NULL DEFAULT 0,
    fingerprint TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','pushing','deleting','done','failed','skipped')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (job_id) REFERENCES push_jobs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS push_sync_state (
    file_key TEXT PRIMARY KEY,
    operation TEXT NOT NULL CHECK(operation IN ('upload','delete')),
    status TEXT NOT NULL CHECK(status IN ('pushing','deleting','done','failed')),
    fingerprint TEXT NOT NULL,
    size INTEGER NOT NULL,
    last_modified INTEGER NOT NULL,
    last_job_id TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_push_jobs_status_requested_at ON push_jobs(status, requested_at);
  CREATE INDEX IF NOT EXISTS idx_push_job_files_job_status ON push_job_files(job_id, status);
  CREATE INDEX IF NOT EXISTS idx_push_sync_state_status_updated_at ON push_sync_state(status, updated_at);
`;

async function ensurePushQueueDb(projectPath: string): Promise<Database.Database> {
  const resolvedProjectPath = resolveProjectPath(projectPath);
  const hooksDir = path.join(resolvedProjectPath, '.claude', 'hooks');
  await fs.mkdir(hooksDir, { recursive: true });

  const sqlite = new Database(getPushQueueDbPath(projectPath));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(PUSH_SCHEMA_SQL);
  return sqlite;
}

async function openExistingPushQueueDb(projectPath: string): Promise<Database.Database | null> {
  const dbPath = getPushQueueDbPath(projectPath);
  if (!fsSync.existsSync(dbPath)) return null;

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(PUSH_SCHEMA_SQL);
  return sqlite;
}

async function readHookEnv(projectPath: string, fallbackProjectId: string): Promise<HookEnv> {
  const envPath = path.join(projectPath, '.claude', 'hooks', '.env');
  const content = await fs.readFile(envPath, 'utf-8');

  const values = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const idx = line.indexOf('=');
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, '');
    values.set(key, value);
  }

  const apiHookUrl = resolveApiHookUrl(values);
  if (!apiHookUrl) {
    throw new Error('Missing API_HOOK_URL in project hook .env and process env');
  }
  const apiHookApiKey = values.get('API_HOOK_API_KEY')?.trim()
    || process.env.API_HOOK_API_KEY?.trim()
    || '';

  const projectId = values.get('PROJECT_ID')?.trim() || fallbackProjectId;
  return { apiHookUrl, apiHookApiKey, projectId };
}

function buildApiHeaders(apiHookApiKey: string, baseHeaders: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...baseHeaders };
  if (apiHookApiKey) {
    headers['x-api-key'] = apiHookApiKey;
  }
  return headers;
}

async function requestJsonWithRetry(
  url: string,
  init: RequestInit,
  label: string,
): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= REQUEST_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const retryableStatus = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
        const error = new Error(`${label} failed: HTTP ${response.status} ${response.statusText}`);
        if (!retryableStatus || attempt === REQUEST_MAX_RETRIES) {
          throw error;
        }
        lastError = error;
      } else {
        const payload = await response.json();
        clearTimeout(timeout);
        return payload;
      }
    } catch (error) {
      if (error instanceof Error) {
        lastError = error;
      } else {
        lastError = new Error('Unknown request error');
      }

      if (attempt === REQUEST_MAX_RETRIES) {
        clearTimeout(timeout);
        break;
      }

      log.warn({ attempt, err: lastError, url, label }, 'Request failed; retrying');
      await delay(REQUEST_RETRY_BASE_DELAY_MS * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`${label} failed after ${REQUEST_MAX_RETRIES} attempts: ${lastError?.message || 'Unknown error'}`);
}

async function requestWithoutJsonWithRetry(
  url: string,
  init: RequestInit,
  label: string,
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= REQUEST_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const retryableStatus = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
        const error = new Error(`${label} failed: HTTP ${response.status} ${response.statusText}`);
        if (!retryableStatus || attempt === REQUEST_MAX_RETRIES) {
          throw error;
        }
        lastError = error;
      } else {
        clearTimeout(timeout);
        return;
      }
    } catch (error) {
      if (error instanceof Error) {
        lastError = error;
      } else {
        lastError = new Error('Unknown request error');
      }

      if (attempt === REQUEST_MAX_RETRIES) {
        clearTimeout(timeout);
        break;
      }

      log.warn({ attempt, err: lastError, url, label }, 'Request failed; retrying');
      await delay(REQUEST_RETRY_BASE_DELAY_MS * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`${label} failed after ${REQUEST_MAX_RETRIES} attempts: ${lastError?.message || 'Unknown error'}`);
}

async function fetchManifest(apiHookUrl: string, apiHookApiKey: string, folder: string): Promise<ManifestEntry[]> {
  const url = buildApiHookEndpoint(apiHookUrl, `manifest?folder=${encodeURIComponent(folder)}`);
  const payload = await requestJsonWithRetry(
    url,
    { method: 'GET', headers: buildApiHeaders(apiHookApiKey) },
    `Manifest fetch (${folder})`
  ) as {
    status?: string;
    data?: unknown;
    message?: string;
  };

  if (payload.status !== 'success' || !Array.isArray(payload.data)) {
    throw new Error(`Invalid manifest response for ${folder}: ${payload.message || 'Invalid payload'}`);
  }

  return payload.data as ManifestEntry[];
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

async function scanLocalFiles(projectPath: string, projectId: string): Promise<Map<string, LocalFileCandidate>> {
  const root = resolveProjectPath(projectPath);
  const result = new Map<string, LocalFileCandidate>();

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = path.relative(root, absolutePath);
      const normalized = normalizeRelativePath(relativePath);

      if (!normalized || normalized.startsWith('../')) {
        continue;
      }

      const stats = await fs.stat(absolutePath);
      const key = `${projectId}/${normalized}`;
      result.set(key, {
        key,
        absolutePath,
        size: stats.size,
        lastModified: Math.floor(stats.mtimeMs),
        fingerprint: buildFingerprint(stats.size, Math.floor(stats.mtimeMs)),
      });
    }
  }

  await walk(root);
  return result;
}

function isIgnoredRelativePath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath).replace(/^\/+/, '');
  return [...IGNORED_DIRS].some((ignored) => normalized === ignored || normalized.startsWith(`${ignored}/`));
}

function buildQueueCandidates(
  projectId: string,
  localFiles: Map<string, LocalFileCandidate>,
  remoteManifest: ManifestEntry[],
): QueueOperationCandidate[] {
  const candidates: QueueOperationCandidate[] = [];
  const remoteMap = new Map(remoteManifest.map((entry) => [entry.key, entry]));

  for (const localFile of localFiles.values()) {
    const remote = remoteMap.get(localFile.key);
    if (!remote) {
      candidates.push({
        operation: 'upload',
        key: localFile.key,
        localPath: localFile.absolutePath,
        size: localFile.size,
        lastModified: localFile.lastModified,
        fingerprint: localFile.fingerprint,
      });
      continue;
    }

    const remoteMtime = new Date(remote.lastModified).getTime();
    const changedBySize = localFile.size !== remote.size;
    const changedByTime = localFile.lastModified > remoteMtime + FILE_MODIFIED_SKEW_MS;

    if (changedBySize || changedByTime) {
      candidates.push({
        operation: 'upload',
        key: localFile.key,
        localPath: localFile.absolutePath,
        size: localFile.size,
        lastModified: localFile.lastModified,
        fingerprint: localFile.fingerprint,
      });
    }
  }

  const projectPrefix = `${projectId}/`;
  for (const remote of remoteManifest) {
    if (localFiles.has(remote.key)) continue;

    const relativePath = remote.key.startsWith(projectPrefix)
      ? remote.key.slice(projectPrefix.length)
      : remote.key;

    if (!relativePath || isIgnoredRelativePath(relativePath)) {
      continue;
    }

    candidates.push({
      operation: 'delete',
      key: remote.key,
      localPath: null,
      size: remote.size,
      lastModified: new Date(remote.lastModified).getTime() || 0,
      fingerprint: `delete:${remote.eTag || `${remote.size}:${remote.lastModified}`}`,
    });
  }

  return candidates;
}

function enqueueInDb(
  sqlite: Database.Database,
  projectId: string,
  candidates: QueueOperationCandidate[],
): { jobId: string; counts: QueueCounts } {
  const now = Date.now();
  const jobId = randomUUID();

  const readStateStmt = sqlite.prepare(`
    SELECT operation, status, fingerprint
    FROM push_sync_state
    WHERE file_key = ?
  `);

  const insertJobStmt = sqlite.prepare(`
    INSERT INTO push_jobs (
      id, project_id, status, requested_at, total_files, enqueued_files, skipped_files
    ) VALUES (?, ?, 'queued', ?, 0, 0, 0)
  `);

  const insertJobFileStmt = sqlite.prepare(`
    INSERT INTO push_job_files (
      job_id, operation, file_key, local_path, size, last_modified, fingerprint,
      status, attempt_count, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `);

  const updateJobStmt = sqlite.prepare(`
    UPDATE push_jobs
    SET total_files = ?, enqueued_files = ?, skipped_files = ?, status = ?, finished_at = ?
    WHERE id = ?
  `);

  const tx = sqlite.transaction(() => {
    insertJobStmt.run(jobId, projectId, now);

    let enqueuedFiles = 0;
    let skippedFiles = 0;

    for (const candidate of candidates) {
      const state = readStateStmt.get(candidate.key) as
        | { operation: PushOperation; status: 'pushing' | 'deleting' | 'done' | 'failed'; fingerprint: string }
        | undefined;

      if (state?.status === 'pushing' || state?.status === 'deleting') {
        skippedFiles += 1;
        insertJobFileStmt.run(
          jobId,
          candidate.operation,
          candidate.key,
          candidate.localPath,
          candidate.size,
          candidate.lastModified,
          candidate.fingerprint,
          'skipped',
          `Skipped: file currently ${state.status}`,
          now,
        );
        continue;
      }

      if (state?.status === 'done' && state.operation === candidate.operation && state.fingerprint === candidate.fingerprint) {
        skippedFiles += 1;
        insertJobFileStmt.run(
          jobId,
          candidate.operation,
          candidate.key,
          candidate.localPath,
          candidate.size,
          candidate.lastModified,
          candidate.fingerprint,
          'skipped',
          'Skipped: already synced with same fingerprint',
          now,
        );
        continue;
      }

      enqueuedFiles += 1;
      insertJobFileStmt.run(
        jobId,
        candidate.operation,
        candidate.key,
        candidate.localPath,
        candidate.size,
        candidate.lastModified,
        candidate.fingerprint,
        'queued',
        null,
        now,
      );
    }

    const totalFiles = candidates.length;
    const status: PushJobStatus = enqueuedFiles === 0 ? 'completed' : 'queued';
    updateJobStmt.run(totalFiles, enqueuedFiles, skippedFiles, status, enqueuedFiles === 0 ? now : null, jobId);

    return { totalFiles, enqueuedFiles, skippedFiles };
  });

  const counts = tx() as QueueCounts;
  return { jobId, counts };
}

export async function enqueueProjectPushSync(projectPath: string, fallbackProjectId: string) {
  const hookEnv = await readHookEnv(projectPath, fallbackProjectId);
  const [remoteManifest, localFiles] = await Promise.all([
    fetchManifest(hookEnv.apiHookUrl, hookEnv.apiHookApiKey, hookEnv.projectId),
    scanLocalFiles(projectPath, hookEnv.projectId),
  ]);

  const candidates = buildQueueCandidates(hookEnv.projectId, localFiles, remoteManifest);
  const sqlite = await ensurePushQueueDb(projectPath);

  try {
    const { jobId, counts } = enqueueInDb(sqlite, hookEnv.projectId, candidates);
    return {
      jobId,
      counts,
      dbPath: getPushQueueDbPath(projectPath),
      projectId: hookEnv.projectId,
    };
  } finally {
    sqlite.close();
  }
}

function getFirstQueuedJob(sqlite: Database.Database): PendingJob | null {
  const row = sqlite.prepare(`
    SELECT id, project_id as projectId, requested_at as requestedAt
    FROM push_jobs
    WHERE status = 'queued'
    ORDER BY requested_at ASC
    LIMIT 1
  `).get() as PendingJob | undefined;

  return row || null;
}

function markJobRunning(sqlite: Database.Database, jobId: string): boolean {
  const result = sqlite.prepare(`
    UPDATE push_jobs
    SET status = 'running', started_at = ?, error = NULL
    WHERE id = ? AND status = 'queued'
  `).run(Date.now(), jobId);

  return result.changes > 0;
}

function finishJob(sqlite: Database.Database, jobId: string, status: PushJobStatus, error: string | null): void {
  sqlite.prepare(`
    UPDATE push_jobs
    SET status = ?, finished_at = ?, error = ?
    WHERE id = ?
  `).run(status, Date.now(), error, jobId);
}

function markJobFileStatus(
  sqlite: Database.Database,
  jobId: string,
  fileKey: string,
  status: PushFileStatus,
  lastError: string | null,
  incrementAttempt = false,
): void {
  const attemptSql = incrementAttempt ? 'attempt_count = attempt_count + 1,' : '';
  sqlite.prepare(`
    UPDATE push_job_files
    SET status = ?, ${attemptSql} last_error = ?, updated_at = ?
    WHERE job_id = ? AND file_key = ?
  `).run(status, lastError, Date.now(), jobId, fileKey);
}

function upsertPushState(
  sqlite: Database.Database,
  fileKey: string,
  operation: PushOperation,
  status: 'pushing' | 'deleting' | 'done' | 'failed',
  fingerprint: string,
  size: number,
  lastModified: number,
  jobId: string,
): void {
  sqlite.prepare(`
    INSERT INTO push_sync_state (
      file_key, operation, status, fingerprint, size, last_modified, last_job_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_key) DO UPDATE SET
      operation = excluded.operation,
      status = excluded.status,
      fingerprint = excluded.fingerprint,
      size = excluded.size,
      last_modified = excluded.last_modified,
      last_job_id = excluded.last_job_id,
      updated_at = excluded.updated_at
  `).run(fileKey, operation, status, fingerprint, size, lastModified, jobId, Date.now());
}

async function getUploadUrl(apiHookUrl: string, apiHookApiKey: string, key: string): Promise<string> {
  const payload = await requestJsonWithRetry(
    buildApiHookEndpoint(apiHookUrl, 'upload-url'),
    {
      method: 'POST',
      headers: buildApiHeaders(apiHookApiKey, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ key }),
    },
    `Upload URL (${key})`,
  ) as { url?: string };

  if (!payload.url) {
    throw new Error(`Missing upload URL for key ${key}`);
  }

  return payload.url;
}

async function uploadByPresignedUrl(url: string, localPath: string): Promise<void> {
  const buffer = await fs.readFile(localPath);
  await requestWithoutJsonWithRetry(
    url,
    {
      method: 'PUT',
      body: buffer,
    },
    `Upload file (${localPath})`,
  );
}

async function deleteByApiEndpoint(apiHookUrl: string, apiHookApiKey: string, key: string): Promise<void> {
  const encodedKey = encodeURIComponent(key);
  const deleteUrl = buildApiHookEndpoint(apiHookUrl, `delete?key=${encodedKey}`);
  await requestWithoutJsonWithRetry(
    deleteUrl,
    { method: 'DELETE', headers: buildApiHeaders(apiHookApiKey) },
    `Delete file (${key})`
  );
}

async function processJob(projectPath: string, projectId: string, job: PendingJob): Promise<void> {
  const sqlite = await openExistingPushQueueDb(projectPath);
  if (!sqlite) return;

  try {
    if (!markJobRunning(sqlite, job.id)) {
      return;
    }

    const hookEnv = await readHookEnv(projectPath, projectId);

    const jobFiles = sqlite.prepare(`
      SELECT file_key as fileKey, operation, local_path as localPath, size, last_modified as lastModified, fingerprint
      FROM push_job_files
      WHERE job_id = ? AND status IN ('queued','pushing','deleting')
      ORDER BY id ASC
    `).all(job.id) as Array<{
      fileKey: string;
      operation: PushOperation;
      localPath: string | null;
      size: number;
      lastModified: number;
      fingerprint: string;
    }>;

    const fileBatches = chunkArray(jobFiles, CONCURRENCY_PROBE_BATCH_SIZE);

    for (const [batchIndex, batchRows] of fileBatches.entries()) {
      const batchProbeBytes = batchRows.reduce((sum, row) => sum + (row.size || 0), 0);
      const chosenConcurrency = selectOperationConcurrency(batchProbeBytes, batchRows.length);

      log.info({
        jobId: job.id,
        projectId,
        totalFileCount: jobFiles.length,
        batchIndex,
        batchFileCount: batchRows.length,
        batchProbeBytes,
        chosenConcurrency,
      }, 'MinIO push job concurrency selected for batch');

      const limit = createConcurrencyLimit(chosenConcurrency);
      await Promise.all(batchRows.map((row) => limit(async () => {
        const inProgressStatus: PushFileStatus = row.operation === 'upload' ? 'pushing' : 'deleting';
        markJobFileStatus(sqlite, job.id, row.fileKey, inProgressStatus, null);
        upsertPushState(sqlite, row.fileKey, row.operation, inProgressStatus, row.fingerprint, row.size, row.lastModified, job.id);

        try {
          if (row.operation === 'upload') {
            if (!row.localPath) {
              throw new Error('Missing local path for upload operation');
            }

            const fileExists = await fs.access(row.localPath).then(() => true).catch(() => false);
            if (!fileExists) {
              throw new Error(`Local file not found: ${row.localPath}`);
            }

            const uploadUrl = await getUploadUrl(hookEnv.apiHookUrl, hookEnv.apiHookApiKey, row.fileKey);
            await uploadByPresignedUrl(uploadUrl, row.localPath);
          } else {
            await deleteByApiEndpoint(hookEnv.apiHookUrl, hookEnv.apiHookApiKey, row.fileKey);
          }

          markJobFileStatus(sqlite, job.id, row.fileKey, 'done', null);
          upsertPushState(sqlite, row.fileKey, row.operation, 'done', row.fingerprint, row.size, row.lastModified, job.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown push operation error';
          markJobFileStatus(sqlite, job.id, row.fileKey, 'failed', message, true);
          upsertPushState(sqlite, row.fileKey, row.operation, 'failed', row.fingerprint, row.size, row.lastModified, job.id);
        }
      })));
    }

    const summary = sqlite.prepare(`
      SELECT
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedCount,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as doneCount,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skippedCount
      FROM push_job_files
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
  return db
    .select({ id: schema.projects.id, path: schema.projects.path })
    .from(schema.projects)
    .orderBy(asc(schema.projects.createdAt));
}

export class MinioPushQueueWorker {
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
        log.error({ err: error }, 'MinIO push worker tick failed');
      });
    }, WORKER_POLL_INTERVAL_MS);

    this.timer.unref();
    log.info('MinIO push queue worker started');
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info('MinIO push queue worker stopped');
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
        sqlite = await openExistingPushQueueDb(project.path);
        if (!sqlite) continue;

        const nextJob = getFirstQueuedJob(sqlite);
        if (!nextJob) continue;

        this.activeProjectIds.add(project.id);

        void processJob(project.path, project.id, nextJob)
          .catch((error) => {
            log.error({ err: error, projectId: project.id, jobId: nextJob.id }, 'Failed to process push job');
          })
          .finally(() => {
            this.activeProjectIds.delete(project.id);
          });
      } catch (error) {
        log.error({ err: error, projectId: project.id }, 'Push worker failed to inspect project queue');
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
        sqlite = await openExistingPushQueueDb(project.path);
        if (!sqlite) continue;

        const now = Date.now();

        sqlite.prepare(`
          UPDATE push_jobs
          SET status = 'failed', finished_at = ?, error = COALESCE(error, 'Worker restarted before job completion')
          WHERE status = 'running'
        `).run(now);

        sqlite.prepare(`
          UPDATE push_job_files
          SET status = 'failed', last_error = COALESCE(last_error, 'Worker restarted before file completion'), updated_at = ?
          WHERE status IN ('pushing','deleting')
        `).run(now);

        sqlite.prepare(`
          UPDATE push_sync_state
          SET status = 'failed', updated_at = ?
          WHERE status IN ('pushing','deleting')
        `).run(now);
      } catch (error) {
        log.warn({ err: error, projectId: project.id }, 'Failed to recover stale push jobs');
      } finally {
        if (sqlite) sqlite.close();
      }
    }
  }
}

let workerSingleton: MinioPushQueueWorker | null = null;

export function getMinioPushQueueWorker(): MinioPushQueueWorker {
  if (!workerSingleton) {
    workerSingleton = new MinioPushQueueWorker();
  }
  return workerSingleton;
}
