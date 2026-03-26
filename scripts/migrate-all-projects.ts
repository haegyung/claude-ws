#!/usr/bin/env tsx
/**
 * Migrate All Projects Script
 *
 * Migrate tất cả projects theo chuẩn mới:
 * 1. hook.env chỉ còn PROJECT_ID
 * 2. Đồng bộ hook templates
 * 3. Ghi đè .claude/settings.json từ template mới
 *
 * Usage:
 *   pnpm migrate-all-projects           # Dry run
 *   pnpm migrate-all-projects --force   # Execute migration
 */

import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { parse as parseDotenv } from 'dotenv';
import { db, schema } from '../src/lib/db';

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
  status: 'success' | 'error' | 'skipped' | 'upgraded' | 'recreated';
  error?: string;
}

interface MigrationReport {
  totalProjects: number;
  processed: number;
  upgraded: number;
  recreated: number;
  skipped: number;
  errors: number;
  results: MigrationResult[];
}

const TEMPLATE_HOOK_FILES = ['minio-pull-sync.ts', 'minio-push-sync.ts', 'hook.env.example'] as const;

function inferProjectIdFromDirName(dirName: string): string {
  const firstDash = dirName.indexOf('-');
  if (firstDash <= 0) return dirName;
  return dirName.slice(0, firstDash);
}

function getProjectIdFromHookEnv(projectPath: string): string | null {
  const hookEnvPath = path.join(projectPath, '.claude', 'hooks', 'hook.env');
  const legacyEnvPath = path.join(projectPath, '.claude', 'hooks', '.env');
  const envPath = fsSync.existsSync(hookEnvPath) ? hookEnvPath : legacyEnvPath;
  if (!fsSync.existsSync(envPath)) return null;

  try {
    const parsed = parseDotenv(fsSync.readFileSync(envPath, 'utf-8'));
    const projectId = (parsed.PROJECT_ID || '').trim();
    return projectId || null;
  } catch {
    return null;
  }
}

function generateHookEnvContent(projectId: string): string {
  return `# ================================================
# Claude Workspace - Hook Environment Configuration
# ================================================
# This file is intentionally minimal.
# Sync configuration is loaded from workspace root .env.

# Project ID (REQUIRED)
# Unique identifier for this project
PROJECT_ID=${projectId}
`;
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

      const existingProjectId = getProjectIdFromHookEnv(absPath);
      const inferredId = existingProjectId || inferProjectIdFromDirName(entry.name);
      targets.set(absPath, {
        id: inferredId,
        name: entry.name,
        path: absPath,
        source: 'scan',
      });
    }
  }

  return [...targets.values()];
}

async function readIfExists(filePath: string): Promise<string | null> {
  if (!fsSync.existsSync(filePath)) return null;
  return fs.readFile(filePath, 'utf-8');
}

async function syncFileFromTemplate(templatePath: string, destinationPath: string): Promise<boolean> {
  const templateContent = await fs.readFile(templatePath, 'utf-8');
  const currentContent = await readIfExists(destinationPath);
  if (currentContent === templateContent) return false;

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, templateContent, 'utf-8');
  return true;
}

async function getProjectDiffs(projectPath: string, projectId: string, workspaceRoot: string): Promise<string[]> {
  const diffs: string[] = [];
  const hooksDir = path.join(projectPath, '.claude', 'hooks');
  const claudeDir = path.join(projectPath, '.claude');
  const templateHooksDir = path.join(workspaceRoot, 'src', 'hooks', 'template', 'hooks');
  const settingsTemplatePath = path.join(workspaceRoot, 'src', 'hooks', 'template', 'settings.json');

  const desiredHookEnv = generateHookEnvContent(projectId);
  const hookEnvPath = path.join(hooksDir, 'hook.env');
  const currentHookEnv = await readIfExists(hookEnvPath);
  if (currentHookEnv !== desiredHookEnv) {
    diffs.push('rewrite-hook-env');
  }

  for (const fileName of TEMPLATE_HOOK_FILES) {
    const templatePath = path.join(templateHooksDir, fileName);
    const projectPathForFile = path.join(hooksDir, fileName);
    if (!fsSync.existsSync(templatePath)) continue;

    const [templateContent, projectContent] = await Promise.all([
      fs.readFile(templatePath, 'utf-8'),
      readIfExists(projectPathForFile),
    ]);

    if (templateContent !== projectContent) {
      diffs.push(`sync-template:${fileName}`);
    }
  }

  const currentSettings = await readIfExists(path.join(claudeDir, 'settings.json'));
  const templateSettings = await fs.readFile(settingsTemplatePath, 'utf-8');
  if (currentSettings !== templateSettings) {
    diffs.push('sync-settings');
  }

  const legacyHookEnv = path.join(hooksDir, '.env');
  if (fsSync.existsSync(legacyHookEnv)) {
    diffs.push('remove-legacy:.env');
  }

  const legacyEnvExample = path.join(hooksDir, '.env.example');
  if (fsSync.existsSync(legacyEnvExample)) {
    diffs.push('remove-legacy:.env.example');
  }

  return diffs;
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
      result.actions.push('No changes needed - already up to date');
      return result;
    }

    if (!execute) {
      result.status = 'upgraded';
      for (const diff of diffs) {
        result.actions.push(`[DRY RUN] Would ${diff}`);
      }
      return result;
    }

    const hooksDir = path.join(target.path, '.claude', 'hooks');
    const claudeDir = path.join(target.path, '.claude');
    const templateHooksDir = path.join(workspaceRoot, 'src', 'hooks', 'template', 'hooks');
    const settingsTemplatePath = path.join(workspaceRoot, 'src', 'hooks', 'template', 'settings.json');

    await fs.mkdir(hooksDir, { recursive: true });
    await fs.mkdir(claudeDir, { recursive: true });

    const hookEnvPath = path.join(hooksDir, 'hook.env');
    const hookEnvContent = generateHookEnvContent(target.id);
    const previousHookEnv = await readIfExists(hookEnvPath);
    await fs.writeFile(hookEnvPath, hookEnvContent, 'utf-8');
    if (previousHookEnv === null) {
      result.actions.push('Created hook.env (PROJECT_ID only)');
      result.status = 'recreated';
    } else {
      result.actions.push('Rewrote hook.env to minimal format');
      if (result.status !== 'recreated') result.status = 'upgraded';
    }

    for (const fileName of TEMPLATE_HOOK_FILES) {
      const changed = await syncFileFromTemplate(
        path.join(templateHooksDir, fileName),
        path.join(hooksDir, fileName),
      );
      if (changed) {
        result.actions.push(`Synced template: ${fileName}`);
        if (result.status !== 'recreated') result.status = 'upgraded';
      }
    }

    const settingsChanged = await syncFileFromTemplate(
      settingsTemplatePath,
      path.join(claudeDir, 'settings.json'),
    );
    if (settingsChanged) {
      result.actions.push('Overwrote .claude/settings.json from template');
      if (result.status !== 'recreated') result.status = 'upgraded';
    }

    const legacyHookEnvPath = path.join(hooksDir, '.env');
    if (fsSync.existsSync(legacyHookEnvPath)) {
      await fs.unlink(legacyHookEnvPath);
      result.actions.push('Removed legacy .claude/hooks/.env');
      if (result.status !== 'recreated') result.status = 'upgraded';
    }

    const legacyEnvExamplePath = path.join(hooksDir, '.env.example');
    if (fsSync.existsSync(legacyEnvExamplePath)) {
      await fs.unlink(legacyEnvExamplePath);
      result.actions.push('Removed legacy .claude/hooks/.env.example');
      if (result.status !== 'recreated') result.status = 'upgraded';
    }

    if (result.actions.length === 0) {
      result.status = 'skipped';
      result.actions.push('No changes needed - already up to date');
    }
  } catch (error: any) {
    result.status = 'error';
    result.error = error?.message || String(error);
  }

  return result;
}

function generateReport(report: MigrationReport, dryRun: boolean): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════════');
  lines.push(`         All Projects Migration${dryRun ? ' - DRY RUN' : ' - EXECUTE'}          `);
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`Total Projects:    ${report.totalProjects}`);
  lines.push(`Processed:         ${report.processed}`);
  lines.push(`Recreated:         ${report.recreated}`);
  lines.push(`Upgraded:          ${report.upgraded}`);
  lines.push(`Skipped:           ${report.skipped}`);
  lines.push(`Errors:            ${report.errors}`);
  lines.push('');
  lines.push('───────────────────────────────────────────────────────────');
  lines.push('');

  for (const result of report.results) {
    const icon = result.status === 'success' || result.status === 'upgraded' || result.status === 'recreated'
      ? '✅'
      : result.status === 'skipped' ? '⏭️ ' : '❌';

    lines.push(`${icon} ${result.projectName} (${result.projectId})`);
    lines.push(`   Path: ${result.projectPath}`);

    for (const action of result.actions) {
      lines.push(`   • ${action}`);
    }

    if (result.error) {
      lines.push(`   ERROR: ${result.error}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const isForce = args.includes('--force');
  const isDryRun = !isForce;
  const isVerbose = args.includes('--verbose');
  const workspaceRoot = process.env.CLAUDE_WS_USER_CWD || process.cwd();

  console.log('');
  console.log('🚀 Claude Workspace - All Projects Migration');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  if (isDryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be made');
    console.log('    Use --force to execute migration');
    console.log('');
  } else {
    console.log('🔧 EXECUTION MODE - Changes will be applied');
    console.log('');
  }

  const targets = await getAllProjectTargets(workspaceRoot);

  const report: MigrationReport = {
    totalProjects: targets.length,
    processed: 0,
    recreated: 0,
    upgraded: 0,
    skipped: 0,
    errors: 0,
    results: [],
  };

  console.log(`Found ${targets.length} projects`);
  console.log('');

  for (const target of targets) {
    if (isVerbose) {
      console.log(`Processing: ${target.name} (${target.id})...`);
    }

    const result = await migrateProject(target, isForce, workspaceRoot);
    report.results.push(result);
    report.processed++;

    if (result.status === 'error') {
      report.errors++;
    } else if (result.status === 'skipped') {
      report.skipped++;
    } else if (result.status === 'recreated') {
      report.recreated++;
    } else if (result.status === 'upgraded') {
      report.upgraded++;
    }

    if (isVerbose) {
      for (const action of result.actions) {
        console.log(`  ${action}`);
      }
      if (result.error) {
        console.log(`  ERROR: ${result.error}`);
      }
    }
  }

  console.log('');
  console.log(generateReport(report, isDryRun));

  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 Summary');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Total Projects:      ${report.totalProjects}`);
  console.log(`Recreated:           ${report.recreated}`);
  console.log(`Upgraded:            ${report.upgraded}`);
  console.log(`Skipped:             ${report.skipped}`);
  console.log(`Errors:              ${report.errors}`);
  console.log('');

  if (isDryRun) {
    console.log('⚠️  This was a DRY RUN');
    console.log('    Run with --force to apply changes');
    console.log('    pnpm migrate-all-projects --force');
    console.log('');
  } else {
    console.log('✅ Migration completed!');
    console.log('');
  }

  if (report.errors > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
