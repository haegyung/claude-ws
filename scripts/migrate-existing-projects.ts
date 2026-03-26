#!/usr/bin/env tsx
/**
 * Migrate existing projects to current default Claude workspace structure.
 *
 * What it does per project:
 * - Ensures `.claude/hooks` and `.claude/commands` exist
 * - Syncs hook templates (`minio-pull-sync.ts`, `minio-push-sync.ts`)
 * - Ensures `.claude/hooks/hook.env.example`, `.claude/settings.json`, `.claude/CLAUDE.md`
 * - Creates `.claude/hooks/hook.env` when missing
 *
 * Usage:
 *   pnpm projects:migrate:defaults
 */

import path from 'path';
import fs from 'fs';
import { config, parse as parseDotenv } from 'dotenv';
import { db, schema } from '../src/lib/db';
import { setupProjectDefaults } from '../src/lib/project-utils';

type ProjectTarget = {
  id: string;
  projectPath: string;
  source: 'db' | 'scan';
};

function inferProjectIdFromDirName(dirName: string): string {
  // Folders may be: "<projectId>" or "<projectId>-<name>"
  const firstDash = dirName.indexOf('-');
  if (firstDash <= 0) return dirName;
  return dirName.slice(0, firstDash);
}

function getProjectIdFromHookEnv(projectPath: string): string | null {
  const hooksDir = path.join(projectPath, '.claude', 'hooks');
  const hookEnvPath = path.join(hooksDir, 'hook.env');
  const legacyEnvPath = path.join(hooksDir, '.env');
  const envPath = fs.existsSync(hookEnvPath) ? hookEnvPath : legacyEnvPath;
  if (!fs.existsSync(envPath)) return null;

  try {
    const parsed = parseDotenv(fs.readFileSync(envPath, 'utf-8'));
    const projectId = (parsed.PROJECT_ID || '').trim();
    return projectId || null;
  } catch {
    return null;
  }
}

function syncProjectHookEnv(projectPath: string, projectId: string): { updated: boolean; reason: string } {
  const hooksDir = path.join(projectPath, '.claude', 'hooks');
  const envPath = path.join(hooksDir, 'hook.env');
  fs.mkdirSync(hooksDir, { recursive: true });

  const normalized = `# ================================================\n# Claude Workspace - Hook Environment Configuration\n# ================================================\n# This file is intentionally minimal.\n# Sync configuration is loaded from workspace root .env.\n\n# Project ID (REQUIRED)\n# Unique identifier for this project\nPROJECT_ID=${projectId}\n`;
  const content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  if (normalized === content) {
    return { updated: false, reason: 'already-correct' };
  }

  fs.writeFileSync(envPath, normalized, 'utf-8');
  return { updated: true, reason: 'env-repaired' };
}

async function run(): Promise<void> {
  const workspaceRoot = process.env.CLAUDE_WS_USER_CWD || process.cwd();
  config({ path: path.join(workspaceRoot, '.env') });

  const dataDir = process.env.DATA_DIR || path.join(workspaceRoot, 'data');
  const projectsDir = path.join(dataDir, 'projects');

  const targets = new Map<string, ProjectTarget>();

  // 1) Projects tracked in DB
  const dbProjects = db.select({
    id: schema.projects.id,
    path: schema.projects.path,
  }).from(schema.projects).all();

  for (const p of dbProjects) {
    targets.set(path.resolve(p.path), {
      id: p.id,
      projectPath: path.resolve(p.path),
      source: 'db',
    });
  }

  // 2) Extra dirs under data/projects not present in DB
  if (fs.existsSync(projectsDir)) {
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectPath = path.resolve(path.join(projectsDir, entry.name));
      if (targets.has(projectPath)) continue;
      const existingProjectId = getProjectIdFromHookEnv(projectPath);
      targets.set(projectPath, {
        id: existingProjectId || inferProjectIdFromDirName(entry.name),
        projectPath,
        source: 'scan',
      });
    }
  }

  if (targets.size === 0) {
    console.log('[projects:migrate:defaults] No projects found.');
    return;
  }

  console.log(`[projects:migrate:defaults] Found ${targets.size} projects.`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let envRepaired = 0;

  for (const target of targets.values()) {
    try {
      if (!fs.existsSync(target.projectPath)) {
        console.log(`[projects:migrate:defaults] SKIP missing path: ${target.projectPath}`);
        skipped++;
        continue;
      }

      await setupProjectDefaults(target.projectPath, target.id, workspaceRoot);
      const envResult = syncProjectHookEnv(target.projectPath, target.id);
      if (envResult.updated) envRepaired++;
      console.log(`[projects:migrate:defaults] OK ${target.source} id=${target.id} path=${target.projectPath}`);
      ok++;
    } catch (error) {
      console.error(`[projects:migrate:defaults] FAIL id=${target.id} path=${target.projectPath}`, error);
      failed++;
    }
  }

  console.log(`[projects:migrate:defaults] Done. ok=${ok} skipped=${skipped} failed=${failed} envRepaired=${envRepaired}`);
  if (failed > 0) process.exit(1);
}

run().catch((error) => {
  console.error('[projects:migrate:defaults] Fatal error', error);
  process.exit(1);
});
