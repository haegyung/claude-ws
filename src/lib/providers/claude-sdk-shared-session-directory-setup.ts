/**
 * Shared Session Directory Setup
 *
 * Symlinks SDK's projects/ directory to ~/.claude/projects/ so both
 * SDK and CLI providers share the same session files. This enables
 * cross-provider session resume when switching models.
 *
 * Only the projects/ subdirectory is shared — auth tokens and MCP
 * configs remain isolated in the SDK's config dir.
 */

import {
  existsSync, lstatSync, mkdirSync, readlinkSync,
  readdirSync, renameSync, rmSync, symlinkSync,
} from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { createLogger } from '../logger';

const log = createLogger('SharedSessionDir');

/**
 * Ensure SDK and CLI share the same projects/ directory for session files.
 * Creates a symlink from {isolatedConfigDir}/projects → ~/.claude/projects/
 * so that session resume works across provider switches.
 *
 * Idempotent — safe to call on every startup.
 * On failure: logs warning and continues (sessions stay isolated, no crash).
 */
export function ensureSharedProjectsDir(isolatedConfigDir: string): void {
  const sdkProjectsDir = join(isolatedConfigDir, 'projects');
  const cliProjectsDir = join(homedir(), '.claude', 'projects');

  // Ensure parent dirs exist (isolatedConfigDir may not exist on fresh install)
  try {
    mkdirSync(isolatedConfigDir, { recursive: true });
    mkdirSync(cliProjectsDir, { recursive: true });
  } catch (err) {
    log.warn({ err }, `Failed to create CLI projects dir ${cliProjectsDir} — skipping symlink setup`);
    return;
  }

  // Check current state of SDK projects dir
  try {
    const stats = lstatSync(sdkProjectsDir);

    if (stats.isSymbolicLink()) {
      // Verify symlink points to the correct target
      const currentTarget = readlinkSync(sdkProjectsDir);
      if (resolve(currentTarget) === resolve(cliProjectsDir)) return; // Correct — idempotent no-op
      // Stale/wrong symlink — remove and recreate below
      rmSync(sdkProjectsDir);
    } else if (stats.isDirectory()) {
      // Real directory exists — migrate contents then remove
      migrateExistingSdkSessions(sdkProjectsDir, cliProjectsDir);
      rmSync(sdkProjectsDir, { recursive: true, force: true });
    }
  } catch {
    // Doesn't exist — expected on fresh install, proceed to create symlink
  }

  // Create symlink: sdkProjectsDir → cliProjectsDir
  try {
    symlinkSync(cliProjectsDir, sdkProjectsDir);
    log.info(`Symlinked ${sdkProjectsDir} → ${cliProjectsDir}`);
  } catch (err) {
    log.warn({ err }, 'Failed to create projects symlink — sessions will not share across providers');
  }
}

/**
 * Move session files from SDK isolated dir to shared CLI dir.
 * Preserves project subdirectory structure.
 * On conflict (file already exists at destination): skip, keep CLI version.
 */
function migrateExistingSdkSessions(sdkDir: string, cliDir: string): void {
  try {
    const entries = readdirSync(sdkDir, { withFileTypes: true });
    let migratedCount = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const srcProjectDir = join(sdkDir, entry.name);
      const destProjectDir = join(cliDir, entry.name);
      mkdirSync(destProjectDir, { recursive: true });

      const sessionFiles = readdirSync(srcProjectDir, { withFileTypes: true });
      for (const fileEntry of sessionFiles) {
        if (!fileEntry.isFile()) continue; // Only migrate files, skip subdirs
        const src = join(srcProjectDir, fileEntry.name);
        const dest = join(destProjectDir, fileEntry.name);
        // Skip if destination already exists (CLI version is authoritative)
        if (!existsSync(dest)) {
          renameSync(src, dest);
          migratedCount++;
        }
      }
    }

    if (migratedCount > 0) {
      log.info(`Migrated ${migratedCount} SDK session file(s) to ${cliDir}`);
    }
  } catch (err) {
    log.warn({ err }, 'Failed to migrate SDK sessions — continuing without migration');
  }
}
