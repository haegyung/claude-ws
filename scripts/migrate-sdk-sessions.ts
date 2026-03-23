#!/usr/bin/env tsx
/**
 * Migrate existing SDK session files to the shared CLI projects directory.
 *
 * Moves session .jsonl files from {DATA_DIR}/claude-sdk-isolated-config/projects/
 * to ~/.claude/projects/ so both SDK and CLI providers share sessions.
 * Skips files that already exist at destination (CLI version is authoritative).
 *
 * Safe to run multiple times (idempotent).
 *
 * Usage: pnpm migrate:sessions
 */

import {
  existsSync, lstatSync, mkdirSync,
  readdirSync, renameSync, statSync,
} from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { config } from 'dotenv';

config();

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const sdkProjectsDir = resolve(DATA_DIR, 'claude-sdk-isolated-config', 'projects');
const cliProjectsDir = join(homedir(), '.claude', 'projects');

console.log(`SDK projects dir: ${sdkProjectsDir}`);
console.log(`CLI projects dir: ${cliProjectsDir}`);
console.log();

// Check if SDK projects dir exists and is a real directory (not a symlink)
if (!existsSync(sdkProjectsDir)) {
  console.log('SDK projects directory does not exist. Nothing to migrate.');
  process.exit(0);
}

const stats = lstatSync(sdkProjectsDir);
if (stats.isSymbolicLink()) {
  console.log('SDK projects directory is already a symlink. Migration already done.');
  process.exit(0);
}

if (!stats.isDirectory()) {
  console.log('SDK projects path is not a directory. Nothing to migrate.');
  process.exit(0);
}

// Ensure CLI projects dir exists
mkdirSync(cliProjectsDir, { recursive: true });

// Scan and migrate
const projectDirs = readdirSync(sdkProjectsDir, { withFileTypes: true });
let migratedCount = 0;
let skippedCount = 0;

for (const projectEntry of projectDirs) {
  if (!projectEntry.isDirectory()) continue;

  const srcProjectDir = join(sdkProjectsDir, projectEntry.name);
  const destProjectDir = join(cliProjectsDir, projectEntry.name);
  mkdirSync(destProjectDir, { recursive: true });

  const files = readdirSync(srcProjectDir, { withFileTypes: true });
  for (const fileEntry of files) {
    if (!fileEntry.isFile()) continue;

    const src = join(srcProjectDir, fileEntry.name);
    const dest = join(destProjectDir, fileEntry.name);
    const srcSize = statSync(src).size;

    if (existsSync(dest)) {
      console.log(`  SKIP ${projectEntry.name}/${fileEntry.name} (already exists at destination)`);
      skippedCount++;
    } else {
      renameSync(src, dest);
      console.log(`  MOVE ${projectEntry.name}/${fileEntry.name} (${(srcSize / 1024).toFixed(1)}KB)`);
      migratedCount++;
    }
  }
}

console.log();
console.log(`Done. Migrated: ${migratedCount}, Skipped: ${skippedCount}`);

if (migratedCount > 0) {
  console.log();
  console.log('Session files are now in ~/.claude/projects/.');
  console.log('The server will create the symlink on next startup.');
}
