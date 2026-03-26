#!/usr/bin/env tsx
/**
 * Migrate existing projects to current default Claude workspace structure.
 *
 * What it does per project:
 * - Syncs hook templates (`minio-pull-sync.ts`, `minio-push-sync.ts`) with injected project id
 * - Syncs `.claude/settings.json` and `.claude/CLAUDE.md` from template
 * - Removes legacy hook env files (`hook.env`, `.env`, `hook.env.example`, `.env.example`)
 *
 * Usage:
 *   pnpm projects:migrate:defaults
 */

import path from 'path';
import fs from 'fs';
import { config } from 'dotenv';
import { db, schema } from '../src/lib/db';
import { setupProjectDefaults } from '../src/lib/project-utils';

type ProjectTarget = {
  id: string;
  projectPath: string;
  source: 'db' | 'scan';
};

function inferProjectIdFromDirName(dirName: string): string {
  const firstDash = dirName.indexOf('-');
  if (firstDash <= 0) return dirName;
  return dirName.slice(0, firstDash);
}

function removeLegacyHookEnvFiles(projectPath: string): number {
  const hooksDir = path.join(projectPath, '.claude', 'hooks');
  const legacyFiles = ['hook.env', '.env', 'hook.env.example', '.env.example'];
  let removed = 0;

  for (const fileName of legacyFiles) {
    const filePath = path.join(hooksDir, fileName);
    if (!fs.existsSync(filePath)) continue;
    fs.rmSync(filePath, { force: true });
    removed += 1;
  }

  return removed;
}

async function run(): Promise<void> {
  const workspaceRoot = process.env.CLAUDE_WS_USER_CWD || process.cwd();
  config({ path: path.join(workspaceRoot, '.env') });

  const dataDir = process.env.DATA_DIR || path.join(workspaceRoot, 'data');
  const projectsDir = path.join(dataDir, 'projects');

  const targets = new Map<string, ProjectTarget>();

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

  if (fs.existsSync(projectsDir)) {
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectPath = path.resolve(path.join(projectsDir, entry.name));
      if (targets.has(projectPath)) continue;
      targets.set(projectPath, {
        id: inferProjectIdFromDirName(entry.name),
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
  let legacyRemoved = 0;

  for (const target of targets.values()) {
    try {
      if (!fs.existsSync(target.projectPath)) {
        console.log(`[projects:migrate:defaults] SKIP missing path: ${target.projectPath}`);
        skipped++;
        continue;
      }

      await setupProjectDefaults(target.projectPath, target.id, workspaceRoot, { useHookTemplate: true });
      legacyRemoved += removeLegacyHookEnvFiles(target.projectPath);

      console.log(`[projects:migrate:defaults] OK ${target.source} id=${target.id} path=${target.projectPath}`);
      ok++;
    } catch (error) {
      console.error(`[projects:migrate:defaults] FAIL id=${target.id} path=${target.projectPath}`, error);
      failed++;
    }
  }

  console.log(`[projects:migrate:defaults] Done. ok=${ok} skipped=${skipped} failed=${failed} legacyRemoved=${legacyRemoved}`);
  if (failed > 0) process.exit(1);
}

run().catch((error) => {
  console.error('[projects:migrate:defaults] Fatal error', error);
  process.exit(1);
});
