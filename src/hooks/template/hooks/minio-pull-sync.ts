import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

// Load .env from .claude/hooks/ directory
import { config as dotenvConfig } from "dotenv";
const hooksDir = path.join(process.cwd(), ".claude", "hooks");
dotenvConfig({ path: path.join(hooksDir, ".env") });

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
const config = {
    apiBaseUrl: process.env.API_HOOK_URL as string,
    targetPrefix: "__PROJECT_ID__",
    markdownPrefix: "markdown/__PROJECT_ID__",
};

if (!config.apiBaseUrl) {
    console.error("❌ Missing API_HOOK_URL in .env!");
    process.exit(1);
}

// Temporary directory configuration
const TMP_DIR = path.join(process.cwd(), ".claude", "tmp");
const MANIFEST_FILE = path.join(TMP_DIR, "minio-sync-manifest.json");
const MANIFEST_MARKDOWN_FILE = path.join(TMP_DIR, "minio-sync-markdown-manifest.json");
const LOCAL_DATA_DIR = ".";
const LOCAL_MARKDOWN_DIR = "markdown";
const LOCAL_STATE_FILE = path.join(TMP_DIR, "local-sync-state.json");
const LOCAL_MARKDOWN_STATE_FILE = path.join(TMP_DIR, "local-markdown-sync-state.json");

// List of directories to NEVER delete
// NOTE: Currently unused but kept for future reference
// const PROTECTED_DIRS = [".claude", "temp", "node_modules", ".git"];

// Create temporary directory
async function ensureTmpDir() {
    await fs.mkdir(TMP_DIR, { recursive: true });
}

const USE_MD5_HASH = false;
const MAX_CONCURRENT_DOWNLOADS = 5;

export interface ManifestEntry {
    key: string;
    size: number;
    lastModified: string;
    eTag: string;
    url: string;
}

// ==========================================
// STEP 1: GET MANIFEST FROM API
// ==========================================
async function fetchManifest(folder: string, label: string): Promise<ManifestEntry[]> {
    console.error(`🔍 Calling API to get manifest for '${label}' (${folder})...`);

    const url = `${config.apiBaseUrl}/api/sync/manifest?folder=${encodeURIComponent(folder)}`;
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`API manifest failed for ${label}: HTTP ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    if (json.status !== "success") {
        throw new Error(`API manifest error for ${label}: ${json.message}`);
    }

    const objects: ManifestEntry[] = json.data;
    console.error(`✅ Got ${objects.length} files from ${label}.`);

    return objects;
}

async function generateUrls(): Promise<{
    mainManifest: ManifestEntry[];
    markdownManifest: ManifestEntry[];
}> {
    console.error(`\n=================== STEP 1: FETCH DATA FROM API ===================`);

    const mainManifest = await fetchManifest(config.targetPrefix, "main folder");
    const markdownManifest = await fetchManifest(config.markdownPrefix, "markdown folder");

    // Save manifests for debugging
    await fs.writeFile(MANIFEST_FILE, JSON.stringify(mainManifest, null, 2));
    console.error(`💾 Main manifest saved to: ${MANIFEST_FILE}`);

    await fs.writeFile(MANIFEST_MARKDOWN_FILE, JSON.stringify(markdownManifest, null, 2));
    console.error(`💾 Markdown manifest saved to: ${MANIFEST_MARKDOWN_FILE}`);

    return { mainManifest, markdownManifest };
}

// ==========================================
// STEP 3: SYNC LOCAL
// ==========================================
async function calculateMD5(filePath: string): Promise<string> {
    const hash = crypto.createHash("md5");
    const fileBuffer = await fs.readFile(filePath);
    hash.update(fileBuffer);
    return hash.digest("hex");
}

async function shouldDownload(remote: ManifestEntry, localPath: string): Promise<string | null> {
    try {
        const stats = await fs.stat(localPath);

        if (stats.size !== remote.size) {
            return `Size changed (Local: ${stats.size} != Remote: ${remote.size})`;
        }

        if (USE_MD5_HASH && remote.eTag) {
            const localHash = await calculateMD5(localPath);
            if (localHash !== remote.eTag) return `Content changed (MD5 mismatch)`;
        } else {
            const remoteTime = new Date(remote.lastModified).getTime();
            const localTime = stats.mtime.getTime();
            if (Math.abs(remoteTime - localTime) > 2000 && remoteTime > localTime) {
                return `Remote file is newer (Local from ${stats.mtime.toISOString()})`;
            }
        }

        return null;
    } catch (error: unknown) {
        if (error instanceof Error && 'code' in error && error.code === "ENOENT") return "New file";
        if (error instanceof Error) return `File check error: ${error.message}`;
        return "File check error: Unknown error";
    }
}

async function downloadFile(url: string, destination: string) {
    // Check if destination conflicts with an existing directory
    try {
        const stats = await fs.stat(destination);
        if (stats.isDirectory()) {
            console.error(`⚠️  Skipping: ${destination} (already exists as directory)`);
            return;
        }
    } catch {
        // File doesn't exist, continue with download
    }

    const dir = path.dirname(destination);
    if (dir !== "." && dir !== process.cwd()) {
        await fs.mkdir(dir, { recursive: true });
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(destination, buffer);
}

// ==========================================
// STEP 2: DELETE LOCAL FILES THAT NO LONGER EXIST IN REMOTE
// ==========================================
async function deleteLocalFilesThatNoLongerExistInRemote(
    currentManifest: ManifestEntry[],
    previousStateFile: string,
    localDir: string,
    prefix: string,
    label: string
) {
    console.error(`\n🗑️  Checking for deletions in ${label}...`);

    // Load previous state to detect deletions
    let previousManifest: ManifestEntry[] = [];
    try {
        const previousStateContent = await fs.readFile(previousStateFile, "utf-8");
        previousManifest = JSON.parse(previousStateContent);
    } catch {
        console.error(`ℹ️  No previous state found for ${label}. Skipping deletion check.`);
        return;
    }

    // Build sets for comparison
    const currentRemoteKeys = new Set(currentManifest.map(e => e.key));
    const previousRemoteKeys = new Set(previousManifest.map(e => e.key));

    // Find keys that existed before but don't exist now (deleted on remote)
    const deletedKeys = [...previousRemoteKeys].filter(key => !currentRemoteKeys.has(key));

    if (deletedKeys.length === 0) {
        console.error(`ℹ️  No files deleted on remote in ${label}.`);
        return;
    }

    console.error(`🗑️  Found ${deletedKeys.length} files deleted on remote in ${label}. Cleaning up locally...`);

    let deletedCount = 0;
    let errorCount = 0;

    for (const key of deletedKeys) {
        try {
            // Strip prefix to get local path
            const strippedKey = key.startsWith(prefix + "/")
                ? key.slice(prefix.length + 1)
                : key;
            const localPath = path.join(localDir, strippedKey);

            // Delete the file
            await fs.unlink(localPath);
            console.error(`✅ Deleted local file: ${strippedKey}`);
            deletedCount++;
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            // Ignore ENOENT (file already doesn't exist)
            if (err instanceof Error && 'code' in err && err.code !== "ENOENT") {
                console.error(`❌ Failed to delete ${key}: ${errorMessage}`);
                errorCount++;
            }
        }
    }

    console.error(`🎉 ${label} cleanup complete! Deleted: ${deletedCount}, Errors: ${errorCount}`);
}

// ==========================================
// STEP 3: SYNC LOCAL
// ==========================================
async function syncLocal(
    manifest: ManifestEntry[],
    localDir: string,
    prefix: string,
    stateFile: string,
    label: string
) {
    console.error(`\n=================== STEP 3: SYNC ${label.toUpperCase()} ===================`);
    console.error(`🚀 Starting to sync ${manifest.length} objects to ${localDir}...`);

    // Ensure local directory exists
    if (localDir !== ".") {
        await fs.mkdir(localDir, { recursive: true });
    }

    const stats = { new: 0, updated: 0, skipped: 0, errors: 0 };
    let completed = 0;
    const limit = createConcurrencyLimit(MAX_CONCURRENT_DOWNLOADS);

    const tasks = manifest.map((remote) =>
        limit(async () => {
            // Strip prefix for cleaner local path
            const strippedKey = remote.key.startsWith(prefix + "/")
                ? remote.key.slice(prefix.length + 1)
                : remote.key;
            const localPath = path.join(localDir, strippedKey);
            const reason = await shouldDownload(remote, localPath);

            if (reason) {
                try {
                    await downloadFile(remote.url, localPath);

                    const remoteDate = new Date(remote.lastModified);
                    await fs.utimes(localPath, remoteDate, remoteDate).catch(() => { });

                    console.error(`\n✅ Downloaded: ${remote.key} (${reason})`);
                    if (reason.includes("new")) stats.new++;
                    else stats.updated++;
                } catch (err: unknown) {
                    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                    console.error(`\n❌ DOWNLOAD FAILED ${remote.key}: ${errorMessage}`);
                    stats.errors++;
                }
            } else {
                stats.skipped++;
            }

            completed++;
            process.stdout.write(`\r[${completed}/${manifest.length}] Processing ${label}... `);
        })
    );

    await Promise.all(tasks);

    console.error(`\n💾 Saving sync state to file: ${stateFile}...`);
    await fs.writeFile(stateFile, JSON.stringify(manifest, null, 2));

    console.error(`\n🎉 ${label.toUpperCase()} SYNC COMPLETE!`);
    console.error(`  - New files   : ${stats.new}`);
    console.error(`  - Updated    : ${stats.updated}`);
    console.error(`  - Skipped    : ${stats.skipped}`);
    console.error(`  - Errors     : ${stats.errors}`);
}

// ==========================================
// MAIN EXECUTION
// ==========================================
async function runAll() {
    try {
        await ensureTmpDir();

        // Step 1: Fetch manifests from both folders
        const { mainManifest, markdownManifest } = await generateUrls();

        // Step 2: Check for deletions (main folder ONLY - markdown is pull-only)
        console.error(`\n=================== STEP 2: CLEANUP DELETED FILES ===================`);
        await deleteLocalFilesThatNoLongerExistInRemote(
            mainManifest,
            LOCAL_STATE_FILE,
            LOCAL_DATA_DIR,
            config.targetPrefix,
            "main folder"
        );

        // Markdown folder: SKIP deletion check (pull-only mode)
        console.error(`\nℹ️  Markdown folder deletion check skipped (pull-only, local files preserved)`);

        // Step 3: Sync both folders
        await syncLocal(mainManifest, LOCAL_DATA_DIR, config.targetPrefix, LOCAL_STATE_FILE, "main");
        await syncLocal(markdownManifest, LOCAL_MARKDOWN_DIR, config.markdownPrefix, LOCAL_MARKDOWN_STATE_FILE, "markdown");

        console.error(`\n🎉 ALL SYNC OPERATIONS COMPLETE!`);
    } catch (e) {
        console.error("❌ Main program error:", e);
    }
}

runAll();
