#!/usr/bin/env tsx
/**
 * Migrate all projects to the current hook template contract.
 *
 * What it does:
 * 1. Sync `minio-pull-sync.ts`, `minio-push-sync.ts`, `.claude/settings.json`
 * 2. Inject project id into hook scripts (via setupProjectDefaults)
 * 3. Remove legacy hook env files (`hook.env`, `.env`, `hook.env.example`, `.env.example`)
 *
 * Usage:
 *   pnpm migrate-all-projects           # Dry run
 *   pnpm migrate-all-projects --force   # Execute migration
 */

import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { db, schema } from '../src/lib/db';
import { setupProjectDefaults } from '../src/lib/project-utils';

interface ProjectTarget {
  id: string;
  name: string;
  path: string;
  source: 'db' | 'scan';
}

interface MigrationResult {
  projectId: string;
  projectName: string;
  projectPath: string;
  actions: string[];
  status: 'success' | 'error' | 'skipped' | 'updated';
  error?: string;
}

interface MigrationReport {
  totalProjects: number;
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
  results: MigrationResult[];
}

function inferProjectIdFromDirName(dirName: string): string {
  const firstDash = dirName.indexOf('-');
  if (firstDash <= 0) return dirName;
  return dirName.slice(0, firstDash);
}

async function getAllProjectTargets(workspaceRoot: string): Promise<ProjectTarget[]> {
  const dataDir = process.env.DATA_DIR || path.join(workspaceRoot, 'data');
  const projectsDir = path.join(dataDir, 'projects');
  const targets = new Map<string, ProjectTarget>();

  const dbProjects = db.select({
    id: schema.projects.id,
    name: schema.projects.name,
    path: schema.projects.path,
  }).from(schema.projects).all();

  for (const project of dbProjects) {
    const absPath = path.resolve(project.path);
    targets.set(absPath, {
      id: project.id,
      name: project.name || project.id,
      path: absPath,
      source: 'db',
    });
  }

  if (fsSync.existsSync(projectsDir)) {
    const entries = fsSync.readdirSync(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const absPath = path.resolve(path.join(projectsDir, entry.name));
      if (targets.has(absPath)) continue;

      targets.set(absPath, {
        id: inferProjectIdFromDirName(entry.name),
        name: entry.name,
        path: absPath,
        source: 'scan',
      });
    }
  }

  return [...targets.values()];
}

async function fileContent(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

function expectedPullContent(template: string, projectId: string): string {
  return template.replace(/__PROJECT_ID__/g, projectId);
}

function expectedPushContent(template: string, projectId: string): string {
  return template.replace(/__PROJECT_ID__/g, projectId);
}

async function getProjectDiffs(projectPath: string, projectId: string, workspaceRoot: string): Promise<string[]> {
  const diffs: string[] = [];
  const hooksDir = path.join(projectPath, '.claude', 'hooks');
  const claudeDir = path.join(projectPath, '.claude');
  const templateDir = path.join(workspaceRoot, 'src', 'hooks', 'template');
  const templateHooksDir = path.join(templateDir, 'hooks');

  const pullTemplate = await fileContent(path.join(templateHooksDir, 'minio-pull-sync.ts'));
  const pushTemplate = await fileContent(path.join(templateHooksDir, 'minio-push-sync.ts'));
  const settingsTemplate = await fileContent(path.join(templateDir, 'settings.json'));

  const expectedPull = expectedPullContent(pullTemplate, projectId);
  const expectedPush = expectedPushContent(pushTemplate, projectId);

  const pullPath = path.join(hooksDir, 'minio-pull-sync.ts');
  const pushPath = path.join(hooksDir, 'minio-push-sync.ts');
  const settingsPath = path.join(claudeDir, 'settings.json');

  if (!fsSync.existsSync(pullPath) || fsSync.readFileSync(pullPath, 'utf-8') !== expectedPull) {
    diffs.push('sync:minio-pull-sync.ts');
  }
  if (!fsSync.existsSync(pushPath) || fsSync.readFileSync(pushPath, 'utf-8') !== expectedPush) {
    diffs.push('sync:minio-push-sync.ts');
  }
  if (!fsSync.existsSync(settingsPath) || fsSync.readFileSync(settingsPath, 'utf-8') !== settingsTemplate) {
    diffs.push('sync:.claude/settings.json');
  }
  for (const legacyName of ['hook.env', '.env', 'hook.env.example', '.env.example']) {
    if (fsSync.existsSync(path.join(hooksDir, legacyName))) {
      diffs.push(`remove:${legacyName}`);
    }
  }

  return diffs;
}

async function removeLegacyHookFiles(projectPath: string): Promise<string[]> {
  const hooksDir = path.join(projectPath, '.claude', 'hooks');
  const removed: string[] = [];
  for (const fileName of ['hook.env', '.env', 'hook.env.example', '.env.example']) {
    const filePath = path.join(hooksDir, fileName);
    if (!fsSync.existsSync(filePath)) continue;
    await fs.rm(filePath, { force: true });
    removed.push(fileName);
  }
  return removed;
}

async function migrateProject(target: ProjectTarget, execute: boolean, workspaceRoot: string): Promise<MigrationResult> {
  const result: MigrationResult = {
    projectId: target.id,
    projectName: target.name,
    projectPath: target.path,
    actions: [],
    status: 'success',
  };

  try {
    if (!fsSync.existsSync(target.path)) {
      result.status = 'skipped';
      result.actions.push('Path does not exist');
      return result;
    }

    const diffs = await getProjectDiffs(target.path, target.id, workspaceRoot);
    if (diffs.length === 0) {
      result.status = 'skipped';
      result.actions.push('No changes needed');
      return result;
    }

    if (!execute) {
      result.status = 'updated';
      for (const diff of diffs) {
        result.actions.push(`[DRY RUN] Would ${diff}`);
      }
      return result;
    }

    await setupProjectDefaults(target.path, target.id, workspaceRoot, { useHookTemplate: true });
    result.actions.push('Synced hook templates + settings');

    const removed = await removeLegacyHookFiles(target.path);
    for (const fileName of removed) {
      result.actions.push(`Removed legacy ${fileName}`);
    }

    result.status = 'updated';
    return result;
  } catch (error: any) {
    result.status = 'error';
    result.error = error?.message || String(error);
    result.actions.push(`Failed: ${result.error}`);
    return result;
  }
}

function printReport(report: MigrationReport, execute: boolean): void {
  console.log('\n' + '='.repeat(80));
  console.log(`📊 MIGRATION REPORT ${execute ? '(EXECUTED)' : '(DRY RUN)'}`);
  console.log('='.repeat(80));
  console.log(`Total projects: ${report.totalProjects}`);
  console.log(`Processed: ${report.processed}`);
  console.log(`Updated: ${report.updated}`);
  console.log(`Skipped: ${report.skipped}`);
  console.log(`Errors: ${report.errors}`);
  console.log('='.repeat(80) + '\n');

  for (const result of report.results) {
    const statusIcon = result.status === 'error'
      ? '❌'
      : result.status === 'updated'
        ? '🔄'
        : result.status === 'skipped'
          ? '⏭️'
          : '✅';

    console.log(`${statusIcon} ${result.projectName} (${result.projectId})`);
    console.log(`   Path: ${result.projectPath}`);
    for (const action of result.actions) {
      console.log(`   - ${action}`);
    }
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    console.log('');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--force');
  const workspaceRoot = process.env.CLAUDE_WS_USER_CWD || process.cwd();

  console.log('🚀 Starting project migration...');
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`Workspace: ${workspaceRoot}\n`);

  const targets = await getAllProjectTargets(workspaceRoot);
  if (targets.length === 0) {
    console.log('No projects found.');
    return;
  }

  console.log(`Found ${targets.length} projects to process.\n`);

  const report: MigrationReport = {
    totalProjects: targets.length,
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    results: [],
  };

  for (const target of targets) {
    const result = await migrateProject(target, execute, workspaceRoot);
    report.results.push(result);
    report.processed += 1;

    if (result.status === 'updated') report.updated += 1;
    if (result.status === 'skipped') report.skipped += 1;
    if (result.status === 'error') report.errors += 1;
  }

  printReport(report, execute);

  if (!execute) {
    console.log('🔎 Dry run completed. Re-run with --force to apply changes.');
    return;
  }

  if (report.errors > 0) {
    console.error(`\n⚠️ Migration completed with ${report.errors} error(s).`);
    process.exit(1);
  }

  console.log('\n✅ Migration completed successfully.');
}

main().catch((error) => {
  console.error('\n❌ Migration failed with fatal error:', error);
  process.exit(1);
});
