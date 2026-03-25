#!/usr/bin/env tsx
/**
 * Migrate All Projects Script
 *
 * Migrate tất cả projects với các thay đổi mới:
 * 1. Upgrade hook.env với đầy đủ variables
 * 2. Loại bỏ deprecated variables
 * 3. Cập nhật hook templates
 *
 * Usage:
 *   pnpm migrate-all-projects           # Dry run
 *   pnpm migrate-all-projects --force   # Execute migration
 */

import { db } from '../src/lib/db';
import { createProjectService } from '@agentic-sdk/services/project/project-crud';
import {
  ensureHookEnv,
  getHookEnvConfigFromServerEnv,
  getHookEnvPath
} from '../src/lib/hook-env-manager';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

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
  deprecatedRemoved: number;
  results: MigrationResult[];
}

// Deprecated variables to remove
const DEPRECATED_VARS = [
  'API_HOOK_URL_DOMAIN',
  'API_HOOK_URL_LOCAL',
  'API_QUEUE_FALLBACK_URLS'
];

const REQUIRED_VARS = [
  'API_HOOK_URL',
  'API_HOOK_API_KEY',
  'API_ACCESS_KEY',
  'API_QUEUE_HOST',
  'PORT',
  'PROJECT_ID'
] as const;

type RequiredVar = typeof REQUIRED_VARS[number];
const TEMPLATE_HOOK_FILES = ['minio-pull-sync.ts', 'minio-push-sync.ts', 'hook.env.example'] as const;

function getHooksDir(projectPath: string): string {
  return path.join(projectPath, '.claude', 'hooks');
}

async function getTemplateDiffs(projectPath: string): Promise<string[]> {
  const diffs: string[] = [];
  const hooksDir = getHooksDir(projectPath);
  const templateDir = path.join(process.cwd(), 'src', 'hooks', 'template', 'hooks');

  for (const fileName of TEMPLATE_HOOK_FILES) {
    const templatePath = path.join(templateDir, fileName);
    const projectTemplatePath = path.join(hooksDir, fileName);

    if (!existsSync(templatePath)) continue;
    if (!existsSync(projectTemplatePath)) {
      diffs.push(`add-template:${fileName}`);
      continue;
    }

    const [templateContent, projectContent] = await Promise.all([
      fs.readFile(templatePath, 'utf-8'),
      fs.readFile(projectTemplatePath, 'utf-8')
    ]);

    if (templateContent !== projectContent) {
      diffs.push(`update-template:${fileName}`);
    }
  }

  const legacyEnvExample = path.join(hooksDir, '.env.example');
  if (existsSync(legacyEnvExample)) {
    diffs.push('remove-legacy:.env.example');
  }

  return diffs;
}

async function syncHookTemplates(projectPath: string): Promise<string[]> {
  const actions: string[] = [];
  const hooksDir = getHooksDir(projectPath);
  const templateDir = path.join(process.cwd(), 'src', 'hooks', 'template', 'hooks');

  await fs.mkdir(hooksDir, { recursive: true });

  for (const fileName of TEMPLATE_HOOK_FILES) {
    const templatePath = path.join(templateDir, fileName);
    const projectTemplatePath = path.join(hooksDir, fileName);
    if (!existsSync(templatePath)) continue;

    const templateContent = await fs.readFile(templatePath, 'utf-8');
    let shouldWrite = true;

    if (existsSync(projectTemplatePath)) {
      const projectContent = await fs.readFile(projectTemplatePath, 'utf-8');
      shouldWrite = projectContent !== templateContent;
    }

    if (shouldWrite) {
      await fs.writeFile(projectTemplatePath, templateContent, 'utf-8');
      actions.push(`Synced template: ${fileName}`);
    }
  }

  const legacyEnvExample = path.join(hooksDir, '.env.example');
  if (existsSync(legacyEnvExample)) {
    await fs.unlink(legacyEnvExample);
    actions.push('Removed legacy template: .env.example');
  }

  return actions;
}

function parseEnvVars(content: string): Map<string, string> {
  const vars = new Map<string, string>();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;

    vars.set(trimmed.slice(0, idx).trim(), trimmed.slice(idx + 1).trim());
  }

  return vars;
}

/**
 * Remove deprecated variables from hook.env
 */
async function removeDeprecatedVariables(hookEnvPath: string): Promise<boolean> {
  if (!existsSync(hookEnvPath)) {
    return false;
  }

  const content = await fs.readFile(hookEnvPath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const newLines: string[] = [];
  let removed = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check if line contains deprecated variable
    const isDeprecated = DEPRECATED_VARS.some(varName =>
      trimmed.startsWith(varName + '=') ||
      trimmed.startsWith('# ' + varName) ||
      trimmed.includes(varName)
    );

    if (isDeprecated) {
      removed = true;
    } else {
      newLines.push(line);
    }
  }

  if (removed) {
    await fs.writeFile(hookEnvPath, newLines.join('\n'), 'utf-8');
  }

  return removed;
}

/**
 * Check if hook.env needs upgrade
 */
async function checkNeedsUpgrade(hookEnvPath: string): Promise<string[]> {
  if (!existsSync(hookEnvPath)) {
    return ['all']; // File doesn't exist, needs creation
  }

  const content = await fs.readFile(hookEnvPath, 'utf-8');
  const currentVars = parseEnvVars(content);

  // Check for deprecated variables
  const hasDeprecated = DEPRECATED_VARS.some(v => currentVars.has(v));

  const missingVars = REQUIRED_VARS.filter(v => !currentVars.has(v));

  const needsUpgrade: string[] = [];
  if (hasDeprecated) needsUpgrade.push('deprecated');
  if (missingVars.length > 0) needsUpgrade.push('missing:' + missingVars.join(','));

  return needsUpgrade;
}

/**
 * Migrate a single project
 */
async function migrateProject(project: any, execute: boolean): Promise<MigrationResult> {
  const result: MigrationResult = {
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path,
    actions: [],
    status: 'success'
  };

  try {
    const hookEnvPath = getHookEnvPath(project.path);
    const needsUpgrade = await checkNeedsUpgrade(hookEnvPath);
    const templateDiffs = await getTemplateDiffs(project.path);
    const hasTemplateChanges = templateDiffs.length > 0;
    let hasChanges = false;

    if (needsUpgrade.length === 0 && !hasTemplateChanges) {
      result.status = 'skipped';
      result.actions.push('No changes needed - already up to date');
      return result;
    }

    if (!execute) {
      // Dry run - just report what would happen
      if (needsUpgrade.length > 0) {
        result.actions.push(`[DRY RUN] Would upgrade: ${needsUpgrade.join(', ')}`);
      }

      if (needsUpgrade.includes('all')) {
        result.actions.push('[DRY RUN] Would create hook.env with full template');
      } else {
        if (needsUpgrade.includes('deprecated')) {
          result.actions.push(`[DRY RUN] Would remove: ${DEPRECATED_VARS.join(', ')}`);
        }
        const missing = needsUpgrade.find(n => n.startsWith('missing:'));
        if (missing) {
          const vars = missing.replace('missing:', '').split(',');
          result.actions.push(`[DRY RUN] Would add: ${vars.join(', ')}`);
        }
      }
      for (const diff of templateDiffs) {
        if (diff.startsWith('add-template:')) {
          result.actions.push(`[DRY RUN] Would add template ${diff.replace('add-template:', '')}`);
        } else if (diff.startsWith('update-template:')) {
          result.actions.push(`[DRY RUN] Would update template ${diff.replace('update-template:', '')}`);
        } else if (diff === 'remove-legacy:.env.example') {
          result.actions.push('[DRY RUN] Would remove legacy .env.example');
        }
      }
      return result;
    }

    // Execute migration

    // Step 1: Remove deprecated variables
    const deprecatedRemoved = await removeDeprecatedVariables(hookEnvPath);
    if (deprecatedRemoved) {
      result.actions.push(`Removed deprecated variables: ${DEPRECATED_VARS.join(', ')}`);
      hasChanges = true;
    }

    // Step 2: Ensure hook.env exists with all variables
    const serverConfig = await getHookEnvConfigFromServerEnv(project.id);

    // Check if hook.env exists
    if (!existsSync(hookEnvPath)) {
      // Create new hook.env
      await ensureHookEnv(project.path, project.id, serverConfig);
      result.actions.push('Created hook.env with full template');
      result.status = 'recreated';
      hasChanges = true;
    } else {
      // Upgrade existing hook.env
      const currentContent = await fs.readFile(hookEnvPath, 'utf-8');
      const currentVars = parseEnvVars(currentContent);

      // Find missing variables
      const missingVars = REQUIRED_VARS.filter(v => !currentVars.has(v));

      if (missingVars.length > 0) {
        // Append missing variables
        const appendLines: string[] = [];
        const serverValueByEnvVar: Record<RequiredVar, string> = {
          API_HOOK_URL: serverConfig.apiHookUrl || '',
          API_HOOK_API_KEY: serverConfig.apiHookApiKey || '',
          API_ACCESS_KEY: serverConfig.apiAccessKey || '',
          API_QUEUE_HOST: serverConfig.apiQueueHost || 'localhost',
          PORT: serverConfig.port || '',
          PROJECT_ID: project.id
        };

        for (const varName of missingVars) {
          appendLines.push(`${varName}=${serverValueByEnvVar[varName]}`);
        }

        const newContent = currentContent.trimEnd() + '\n\n# Added by migration\n' + appendLines.join('\n') + '\n';
        await fs.writeFile(hookEnvPath, newContent, 'utf-8');

        result.actions.push(`Added missing variables: ${missingVars.join(', ')}`);
        result.status = 'upgraded';
        hasChanges = true;
      }
    }

    const templateActions = await syncHookTemplates(project.path);
    if (templateActions.length > 0) {
      result.actions.push(...templateActions);
      hasChanges = true;
      if (result.status === 'success') {
        result.status = 'upgraded';
      }
    }

    // Step 3: Validate final result using actual env variable names
    const finalContent = await fs.readFile(hookEnvPath, 'utf-8');
    const finalVars = parseEnvVars(finalContent);
    const stillMissing = ['API_HOOK_URL', 'PROJECT_ID'].filter(v => {
      const value = finalVars.get(v)?.trim();
      return !value;
    });

    if (stillMissing.length > 0) {
      result.actions.push(`Warning: Still missing - ${stillMissing.join(', ')}`);
    }

    if (!hasChanges && result.status === 'success') {
      result.status = 'skipped';
      result.actions.push('No changes needed - already up to date');
    }

  } catch (error: any) {
    result.status = 'error';
    result.error = error.message || String(error);
  }

  return result;
}

/**
 * Generate migration report
 */
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
  lines.push(`Deprecated Removed: ${report.deprecatedRemoved}`);
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

/**
 * Main migration function
 */
async function main() {
  const args = process.argv.slice(2);
  const isForce = args.includes('--force');
  const isDryRun = !isForce;
  const isVerbose = args.includes('--verbose');

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

  // Initialize services
  const projectService = createProjectService(db);

  // Get all projects
  const projects = await projectService.list();

  const report: MigrationReport = {
    totalProjects: projects.length,
    processed: 0,
    recreated: 0,
    upgraded: 0,
    skipped: 0,
    errors: 0,
    deprecatedRemoved: 0,
    results: []
  };

  console.log(`Found ${projects.length} projects`);
  console.log('');

  // Process each project
  for (const project of projects) {
    if (isVerbose) {
      console.log(`Processing: ${project.name} (${project.id})...`);
    }

    const result = await migrateProject(project, isForce);
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

      // Check if deprecated variables were removed
      if (result.actions.some(a => a.includes('Removed deprecated'))) {
        report.deprecatedRemoved++;
      }
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

  // Print report
  console.log('');
  console.log(generateReport(report, isDryRun));

  // Summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 Summary');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Total Projects:      ${report.totalProjects}`);
  console.log(`Recreated:           ${report.recreated}`);
  console.log(`Upgraded:            ${report.upgraded}`);
  console.log(`Skipped:             ${report.skipped}`);
  console.log(`Deprecated Removed:  ${report.deprecatedRemoved}`);
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
    console.log('📝 Next steps:');
    console.log('   1. Test hooks on a few projects');
    console.log('   2. Verify hook.env files are correct');
    console.log('   3. Restart server if needed');
    console.log('   4. Monitor for any issues');
    console.log('');
  }

  // Exit with error code if there were errors
  if (report.errors > 0) {
    process.exit(1);
  }
}

// Run migration
main().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
