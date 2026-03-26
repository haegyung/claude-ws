import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
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

/** Simple concurrency limiter — avoids p-limit dependency */
function createConcurrencyLimit(concurrency: number) {
    let active = 0;
    const queue: (() => void)[] = [];
    return function limit<T>(fn: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            const run = () => {
                active++;
                fn().then(resolve, reject).finally(() => {
                    active--;
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

// ==========================================
// CONFIGURATION
// ==========================================
let config: {
    apiBaseUrl: string;
    apiHookApiKey: string;
    apiQueueUrl: string;
    apiQueueKey: string;
    projectId: string;
    targetPrefix: string;
};

function initializeRuntimeConfig() {
    loadRootEnv(process.cwd());
    const queuePort = (process.env.PORT || "").trim();
    const apiQueueUrl = (queuePort ? `http://localhost:${queuePort}` : "").trim();

    config = {
        apiBaseUrl: resolveApiHookUrl(PROJECT_ID),
        apiHookApiKey: (process.env.API_HOOK_API_KEY || "").trim(),
        apiQueueUrl,
        apiQueueKey: (process.env.API_ACCESS_KEY || "").trim(),
        projectId: PROJECT_ID,
        targetPrefix: PROJECT_ID,
    };

    if (!config.apiBaseUrl) {
        console.error("❌ Missing API_HOOK_URL in workspace root .env!");
        process.exit(1);
    }
}

// Temporary directory configuration
const TMP_DIR = path.join(process.cwd(), ".claude", "tmp");
const LOCAL_DATA_DIR = ".";
const STATE_FILE = path.join(TMP_DIR, "local-sync-state.json");
const IGNORED_DIRS = [".claude", "temp", "node_modules", ".git", "markdown"];

function buildApiUrl(endpoint: string): string {
    const base = String(config.apiBaseUrl || "").replace(/\/+$/g, "");
    const pathPart = endpoint.replace(/^\/+/g, "");
    return `${base}/${pathPart}`;
}

function buildApiHeaders(baseHeaders: Record<string, string> = {}): HeadersInit {
    const headers: Record<string, string> = { ...baseHeaders };
    if (config.apiHookApiKey) {
        headers["x-api-key"] = config.apiHookApiKey;
    }
    return headers;
}

function toPushEndpoint(baseOrEndpoint: string): string {
    const trimmed = String(baseOrEndpoint || "").trim().replace(/\/+$/g, "");
    if (!trimmed) return "";
    if (/\/api\/sync\/minio\/push$/i.test(trimmed)) return trimmed;
    return `${trimmed}/api/sync/minio/push`;
}

function buildQueueCandidates(): string[] {
    const candidates: string[] = [];
    const push = (value: string) => {
        const endpoint = toPushEndpoint(value);
        if (endpoint && !candidates.includes(endpoint)) {
            candidates.push(endpoint);
        }
    };

    // Queue endpoint is always local: localhost + PORT
    if (config.apiQueueUrl) {
        push(config.apiQueueUrl);
    }

    return candidates;
}

async function enqueuePushJob(): Promise<boolean> {
    const endpoints = buildQueueCandidates();
    if (endpoints.length === 0) return false;

    for (const endpoint of endpoints) {
        try {
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (config.apiQueueKey) {
                headers["x-api-key"] = config.apiQueueKey;
            }

            const response = await fetch(endpoint, {
                method: "POST",
                headers,
                body: JSON.stringify({ projectId: config.projectId }),
            });

            if (response.ok) {
                console.error(`✅ Queue accepted via ${endpoint}`);
                return true;
            }

            console.error(`⚠️ Queue endpoint failed ${endpoint}: HTTP ${response.status}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`⚠️ Queue endpoint unreachable ${endpoint}: ${message}`);
        }
    }

    return false;
}

// Function to create tmp directory
async function ensureTmpDir() {
    await fs.mkdir(TMP_DIR, { recursive: true });
}

export interface ManifestEntry {
    key: string;
    size: number;
    lastModified: string;
    eTag: string;
    url: string;
}

// ==========================================
// Call API to get presigned PUT URL then upload file
// ==========================================
async function uploadFile(s3Key: string, filePath: string) {
    // Step 1: Get presigned PUT URL from API
    const urlRes = await fetch(buildApiUrl("upload-url"), {
        method: "POST",
        headers: buildApiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ key: s3Key }),
    });

    if (!urlRes.ok) {
        console.error(`❌ Failed to get upload URL for ${s3Key}: HTTP ${urlRes.status}`);
        return;
    }

    const { url } = await urlRes.json();
    console.error(`🔗 [Upload Link] - ${s3Key}`);

    // Step 2: Read file and PUT to MinIO via presigned URL
    const fileBuffer = await fs.readFile(filePath);
    console.error(`⏳ Uploading ${filePath} to MinIO...`);

    const response = await fetch(url, { method: "PUT", body: fileBuffer });

    if (response.ok) {
        console.error(`✅ Upload successful: ${s3Key}\n`);
    } else {
        console.error(`❌ Upload error ${s3Key} (HTTP ${response.status}): ${response.statusText}\n`);
    }
}

// ==========================================
// Scan all files in data directory (Recursive)
// ==========================================
async function scanDirectory(dir: string, fileList: string[] = []) {
    try {
        const files = await fs.readdir(dir, { withFileTypes: true });
        for (const file of files) {
            const filePath = path.join(dir, file.name);

            if (file.isDirectory()) {
                // Skip ignored directories
                if (IGNORED_DIRS.includes(file.name)) {
                    console.error(`⏭️  Skipping ignored directory: ${filePath}`);
                    continue;
                }
                await scanDirectory(filePath, fileList);
            } else {
                fileList.push(filePath);
            }
        }
    } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && err.code !== "ENOENT") console.error(`Error reading directory ${dir}:`, err);
    }
    return fileList;
}

// ==========================================
// MAIN SYNC FUNCTION
// ==========================================
async function runCheck() {
    initializeRuntimeConfig();

    // Preferred path: enqueue into server-side push queue (records jobs in push-sync-state.db)
    const enqueued = await enqueuePushJob();
    if (enqueued) {
        return;
    }

    console.error("⚠️ Queue enqueue failed on all endpoints, falling back to direct upload mode.");

    await ensureTmpDir(); // Create tmp directory before running
    console.error(`🔍 Starting to scan files in '${LOCAL_DATA_DIR}' and compare with '${STATE_FILE}'...`);

    // Read state file (created by pull-sync)
    let manifestData: ManifestEntry[] = [];
    try {
        manifestData = JSON.parse(await fs.readFile(STATE_FILE, "utf-8"));
    } catch {
        console.error(`❌ '${STATE_FILE}' not found. Run pull sync first!`);
        return;
    }

    const allFiles = await scanDirectory(LOCAL_DATA_DIR);
    if (allFiles.length === 0) {
        console.error(`❌ Directory '${LOCAL_DATA_DIR}' is completely empty!`);
        return;
    }

    console.error(`\n=================== STEP 2: UPLOAD NEW & CHANGED FILES ===================`);

    // Map key → ManifestEntry for quick lookup
    const manifestMap = new Map<string, ManifestEntry>();
    for (const entry of manifestData) {
        manifestMap.set(entry.key, entry);
    }

    let newFiles = 0;
    let changedFiles = 0;
    let unchangedFiles = 0;

    const MAX_CONCURRENT_CHECKS = 10;
    const limit = createConcurrencyLimit(MAX_CONCURRENT_CHECKS);

    console.error(`Analyzing ${allFiles.length} local files...`);

    const checkTasks = allFiles.map((filePath) =>
        limit(async () => {
            // Get relative path from local data dir, e.g.: "markdown/ronaldo.md"
            const relativePath = path.relative(LOCAL_DATA_DIR, filePath);

            // Add targetPrefix to create full S3 key
            // e.g.: "markdown/ronaldo.md" → "698c42f.../markdown/ronaldo.md"
            const s3Key = config.targetPrefix + "/" + relativePath.split(path.sep).join("/");

            const stats = await fs.stat(filePath);
            const manifestEntry = manifestMap.get(s3Key);

            if (!manifestEntry) {
                console.error(`\n📝 [NEW FILE] ${s3Key}`);
                await uploadFile(s3Key, filePath);
                newFiles++;
            } else if (stats.size !== manifestEntry.size) {
                console.error(`\n🔄 [SIZE CHANGED] ${s3Key} (Local: ${stats.size}, Remote: ${manifestEntry.size})`);
                await uploadFile(s3Key, filePath);
                changedFiles++;
            } else {
                const localMtime = stats.mtime.getTime();
                const s3Mtime = new Date(manifestEntry.lastModified).getTime();

                if (localMtime > s3Mtime + 2000) {
                    console.error(`\n⏳ [TIME CHANGED] ${s3Key}`);
                    await uploadFile(s3Key, filePath);
                    changedFiles++;
                } else {
                    unchangedFiles++;
                }
            }
        })
    );

    await Promise.all(checkTasks);

    console.error(`\n🎉 SYNC CHECK COMPLETE:`);
    console.error(`   - New files   : ${newFiles}`);
    console.error(`   - Changed     : ${changedFiles}`);
    console.error(`   - Unchanged   : ${unchangedFiles}`);
}

runCheck().catch(console.error);
