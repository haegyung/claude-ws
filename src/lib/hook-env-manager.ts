/**
 * Hook Environment Manager
 *
 * Centralized service for managing hook.env files in projects.
 * Provides creation, reading, validation, migration, and healing capabilities.
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { config as dotenvConfig, parse as parseDotenv } from 'dotenv';
import { resolveApiHookUrl } from './api-hook-url';

// ==========================================
// Types & Interfaces
// ==========================================

export interface HookEnvConfig {
  apiHookUrl?: string;
  apiHookApiKey?: string;
  apiAccessKey?: string;
  port?: string;
  projectId?: string;
}

export interface HookEnvValidationResult {
  valid: boolean;
  exists: boolean;
  missingVars: string[];
  errors: string[];
  path: string;
}

let rootEnvLoaded = false;

// ==========================================
// Path Utilities
// ==========================================

/**
 * Get the hook.env file path for a project
 */
export function getHookEnvPath(projectPath: string): string {
  return path.join(projectPath, '.claude', 'hooks', 'hook.env');
}

/**
 * Get the legacy .env file path for a project
 */
export function getLegacyEnvPath(projectPath: string): string {
  return path.join(projectPath, '.claude', 'hooks', '.env');
}

function parseHookEnvMap(content: string): Map<string, string> {
  const map = new Map<string, string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const idx = line.indexOf('=');
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, '');
    map.set(key, value);
  }

  return map;
}

function findWorkspaceRoot(startPath: string = process.cwd()): string {
  const explicitRoot = process.env.CLAUDE_WS_USER_CWD;
  if (explicitRoot) {
    const explicitEnvPath = path.join(explicitRoot, '.env');
    if (existsSync(explicitEnvPath)) {
      return explicitRoot;
    }
  }

  let current = path.resolve(startPath);

  while (true) {
    const envPath = path.join(current, '.env');
    if (existsSync(envPath)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }

    current = parent;
  }

  return explicitRoot || process.cwd();
}

export function loadRootEnvForHooks(startPath: string = process.cwd()): string | null {
  if (rootEnvLoaded) {
    return null;
  }

  const workspaceRoot = findWorkspaceRoot(startPath);
  const envPath = path.join(workspaceRoot, '.env');

  if (!existsSync(envPath)) {
    rootEnvLoaded = true;
    return null;
  }

  dotenvConfig({ path: envPath, override: false });
  rootEnvLoaded = true;
  return envPath;
}

// ==========================================
// Template Generation
// ==========================================

/**
 * Generate hook.env content with optional comments
 */
export function generateHookEnvContent(
  projectId: string,
  _config?: Partial<HookEnvConfig>,
  includeComments: boolean = true
): string {
  const normalizedProjectId = projectId || '__PROJECT_ID__';

  if (!includeComments) {
    return `PROJECT_ID=${normalizedProjectId}\n`;
  }

  return `# ================================================
# Claude Workspace - Hook Environment Configuration
# ================================================
# This file is intentionally minimal.
# Sync configuration is loaded from workspace root .env.

# Project ID (REQUIRED)
# Unique identifier for this project
PROJECT_ID=${normalizedProjectId}
`;
}

// ==========================================
// Server Environment Configuration
// ==========================================

/**
 * Read hook environment configuration from server's process.env
 */
export async function getHookEnvConfigFromServerEnv(
  projectId?: string,
  projectPath?: string,
): Promise<Partial<HookEnvConfig>> {
  loadRootEnvForHooks(projectPath || process.cwd());
  const resolvedProjectId = (projectId || process.env.PROJECT_ID || '__PROJECT_ID__').trim();

  return {
    apiHookUrl: resolveApiHookUrl(undefined, undefined, resolvedProjectId),
    apiHookApiKey: process.env.API_HOOK_API_KEY?.trim(),
    apiAccessKey: process.env.API_ACCESS_KEY?.trim(),
    port: process.env.PORT,
    projectId: resolvedProjectId
  };
}

// ==========================================
// Core Operations
// ==========================================

/**
 * Ensure hook.env exists for a project
 * Creates it with proper configuration if missing
 *
 * @param projectPath - Absolute path to project
 * @param projectId - Project ID for template
 * @param config - Optional configuration values
 * @returns Path to hook.env file
 */
export async function ensureHookEnv(
  projectPath: string,
  projectId?: string,
  config?: Partial<HookEnvConfig>
): Promise<string> {
  const hooksDir = path.join(projectPath, '.claude', 'hooks');
  const hookEnvPath = getHookEnvPath(projectPath);

  // Create hooks directory if it doesn't exist
  await fs.mkdir(hooksDir, { recursive: true });

  // Check if hook.env already exists
  if (existsSync(hookEnvPath)) {
    return hookEnvPath;
  }

  // Generate minimal content
  const finalConfig = config || await getHookEnvConfigFromServerEnv(projectId, projectPath);
  const content = generateHookEnvContent(
    finalConfig.projectId || projectId || '__PROJECT_ID__',
    finalConfig,
    true
  );

  // Write hook.env file
  await fs.writeFile(hookEnvPath, content, 'utf-8');

  return hookEnvPath;
}

/**
 * Read and parse hook.env file
 *
 * @param projectPath - Absolute path to project
 * @param fallbackProjectId - Fallback project ID if not found in file
 * @returns Parsed configuration
 */
export async function readHookEnv(
  projectPath: string,
  fallbackProjectId?: string
): Promise<HookEnvConfig> {
  const hookEnvPath = getHookEnvPath(projectPath);

  if (!existsSync(hookEnvPath)) {
    throw new Error(`hook.env not found at ${hookEnvPath}`);
  }

  // Read file
  const content = await fs.readFile(hookEnvPath, 'utf-8');
  const map = parseHookEnvMap(content);

  loadRootEnvForHooks(projectPath);
  const projectId = map.get('PROJECT_ID') || fallbackProjectId || '__PROJECT_ID__';

  // Extract values
  return {
    apiHookUrl: resolveApiHookUrl(map, undefined, projectId),
    apiHookApiKey: (process.env.API_HOOK_API_KEY || '').trim(),
    apiAccessKey: (process.env.API_ACCESS_KEY || '').trim(),
    port: (process.env.PORT || '').trim(),
    projectId
  };
}

/**
 * Validate hook.env file
 *
 * @param projectPath - Absolute path to project
 * @param requiredVars - List of required variable names
 * @returns Validation result
 */
export async function validateHookEnv(
  projectPath: string,
  requiredVars: string[] = ['PROJECT_ID']
): Promise<HookEnvValidationResult> {
  const hookEnvPath = getHookEnvPath(projectPath);
  const result: HookEnvValidationResult = {
    valid: true,
    exists: false,
    missingVars: [],
    errors: [],
    path: hookEnvPath
  };

  // Check if file exists
  if (!existsSync(hookEnvPath)) {
    result.exists = false;
    result.valid = false;
    result.missingVars = requiredVars;
    result.errors.push('hook.env file does not exist');
    return result;
  }

  result.exists = true;

  // Try to read and parse
  try {
    const content = await fs.readFile(hookEnvPath, 'utf-8');
    const map = parseHookEnvMap(content);

    for (const varName of requiredVars) {
      const value = (map.get(varName) || '').trim();
      if (!value) {
        result.missingVars.push(varName);
        result.valid = false;
      }
    }

    if (!result.valid) {
      result.errors.push(`Missing required variables: ${result.missingVars.join(', ')}`);
    }
  } catch (error: any) {
    result.valid = false;
    result.errors.push(error.message || 'Failed to read hook.env');
  }

  return result;
}

/**
 * Migrate legacy .env to hook.env
 *
 * @param projectPath - Absolute path to project
 * @returns Migration result
 */
export async function migrateLegacyEnv(
  projectPath: string
): Promise<{ migrated: boolean; from: string; to: string }> {
  const legacyPath = getLegacyEnvPath(projectPath);
  const hookEnvPath = getHookEnvPath(projectPath);

  // If hook.env already exists, no migration needed
  if (existsSync(hookEnvPath)) {
    return { migrated: false, from: legacyPath, to: hookEnvPath };
  }

  // If legacy .env doesn't exist, no migration needed
  if (!existsSync(legacyPath)) {
    return { migrated: false, from: legacyPath, to: hookEnvPath };
  }

  const legacyContent = await fs.readFile(legacyPath, 'utf-8');
  const parsed = parseDotenv(legacyContent);
  const projectId = (parsed.PROJECT_ID || '').trim() || '__PROJECT_ID__';

  await fs.writeFile(hookEnvPath, generateHookEnvContent(projectId, undefined, true), 'utf-8');

  return { migrated: true, from: legacyPath, to: hookEnvPath };
}

/**
 * Upgrade existing hook.env to current minimal format
 *
 * @param projectPath - Absolute path to project
 * @param projectId - Project ID
 * @returns Upgrade result
 */
export async function upgradeHookEnv(
  projectPath: string,
  projectId?: string
): Promise<{ upgraded: boolean; addedVars: string[] }> {
  const hookEnvPath = getHookEnvPath(projectPath);

  if (!existsSync(hookEnvPath)) {
    await ensureHookEnv(projectPath, projectId);
    return { upgraded: true, addedVars: ['PROJECT_ID'] };
  }

  const currentContent = await fs.readFile(hookEnvPath, 'utf-8');
  const currentVars = parseHookEnvMap(currentContent);
  const finalProjectId =
    (currentVars.get('PROJECT_ID') || '').trim() ||
    (projectId || '').trim() ||
    '__PROJECT_ID__';

  const desiredContent = generateHookEnvContent(finalProjectId, undefined, true);

  if (currentContent === desiredContent) {
    return { upgraded: false, addedVars: [] };
  }

  await fs.writeFile(hookEnvPath, desiredContent, 'utf-8');
  return { upgraded: true, addedVars: ['PROJECT_ID'] };
}
