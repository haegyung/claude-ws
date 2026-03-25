/**
 * Hook Environment Manager
 *
 * Centralized service for managing hook.env files in projects.
 * Provides creation, reading, validation, migration, and healing capabilities.
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { config as dotenvConfig } from 'dotenv';

// ==========================================
// Types & Interfaces
// ==========================================

export interface HookEnvConfig {
  apiHookUrl?: string;
  apiHookApiKey?: string;
  apiAccessKey?: string;
  apiQueueHost?: string;
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

// ==========================================
// Template Generation
// ==========================================

/**
 * Generate hook.env content with optional comments
 */
export function generateHookEnvContent(
  projectId: string,
  config?: Partial<HookEnvConfig>,
  includeComments: boolean = true
): string {
  const values = {
    apiHookUrl: config?.apiHookUrl || '',
    apiHookApiKey: config?.apiHookApiKey || '',
    apiAccessKey: config?.apiAccessKey || '',
    apiQueueHost: config?.apiQueueHost || 'localhost',
    port: config?.port || '',
    projectId: projectId || '__PROJECT_ID__'
  };

  if (!includeComments) {
    // Minimal format without comments
    return `API_HOOK_URL=${values.apiHookUrl}
API_HOOK_API_KEY=${values.apiHookApiKey}
API_ACCESS_KEY=${values.apiAccessKey}
API_QUEUE_HOST=${values.apiQueueHost}
PORT=${values.port}
PROJECT_ID=${values.projectId}
`;
  }

  // Full format with comments
  return `# ================================================
# Claude Workspace - Hook Environment Configuration
# ================================================
# This file configures MinIO sync hooks for this project
# Auto-generated from server .env - DO NOT edit manually unless required

# ----------------------------------
# API Hook Configuration
# ----------------------------------

# API Hook URL (REQUIRED)
# Full URL or use {room_id} placeholder
# Example: https://api.example.com/api/v1/internal/rooms/{room_id}/files/
API_HOOK_URL=${values.apiHookUrl}

# ----------------------------------
# Authentication
# ----------------------------------

# API Hook API Key (OPTIONAL)
# Auto-populated from server API_HOOK_API_KEY
API_HOOK_API_KEY=${values.apiHookApiKey}

# ----------------------------------
# Queue Configuration (Push Sync Only)
# ----------------------------------

# Queue Access Key (OPTIONAL)
# Auto-populated from server API_ACCESS_KEY
API_ACCESS_KEY=${values.apiAccessKey}

# Queue Host (OPTIONAL, default: localhost)
# Auto-populated from server API_QUEUE_HOST
API_QUEUE_HOST=${values.apiQueueHost}

# Server Port (OPTIONAL)
# Auto-populated from server PORT
PORT=${values.port}

# ----------------------------------
# Project Identification
# ----------------------------------

# Project ID (AUTO-GENERATED)
# Unique identifier for this project
PROJECT_ID=${values.projectId}
`;
}

// ==========================================
// Server Environment Configuration
// ==========================================

/**
 * Read hook environment configuration from server's process.env
 */
export async function getHookEnvConfigFromServerEnv(
  projectId?: string
): Promise<Partial<HookEnvConfig>> {
  return {
    apiHookUrl: process.env.API_HOOK_URL,
    apiHookApiKey: process.env.API_HOOK_API_KEY?.trim(),
    apiAccessKey: process.env.API_ACCESS_KEY?.trim(),
    apiQueueHost: process.env.API_QUEUE_HOST || 'localhost',
    port: process.env.PORT,
    projectId: projectId || '__PROJECT_ID__'
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

  // Generate content from config or server env
  const finalConfig = config || await getHookEnvConfigFromServerEnv(projectId);
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

  // Parse environment variables
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

  // Extract values
  return {
    apiHookUrl: map.get('API_HOOK_URL') || '',
    apiHookApiKey: map.get('API_HOOK_API_KEY') || '',
    apiAccessKey: map.get('API_ACCESS_KEY') || '',
    apiQueueHost: map.get('API_QUEUE_HOST') || 'localhost',
    port: map.get('PORT') || '',
    projectId: map.get('PROJECT_ID') || fallbackProjectId || '__PROJECT_ID__'
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
  requiredVars: string[] = ['API_HOOK_URL']
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
    const config = await readHookEnv(projectPath);

    // Check required variables
    for (const varName of requiredVars) {
      const value = config[varName as keyof HookEnvConfig];
      if (!value || value.trim() === '') {
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

  // Read legacy .env
  const content = await fs.readFile(legacyPath, 'utf-8');

  // Write to hook.env
  await fs.writeFile(hookEnvPath, content, 'utf-8');

  // Optionally, you could delete the legacy file here
  // await fs.unlink(legacyPath);

  return { migrated: true, from: legacyPath, to: hookEnvPath };
}

/**
 * Upgrade existing hook.env with missing variables
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
    // File doesn't exist, create it
    await ensureHookEnv(projectPath, projectId);
    return { upgraded: true, addedVars: ['all'] };
  }

  // Read current content
  const currentContent = await fs.readFile(hookEnvPath, 'utf-8');

  // Parse current variables
  const currentVars = new Set<string>();
  for (const line of currentContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      currentVars.add(trimmed.slice(0, idx).trim());
    }
  }

  // Get server config
  const serverConfig = await getHookEnvConfigFromServerEnv(projectId);

  // Variables that should be present
  const requiredVars = [
    'API_HOOK_URL',
    'API_HOOK_API_KEY',
    'API_ACCESS_KEY',
    'API_QUEUE_HOST',
    'PORT',
    'PROJECT_ID'
  ];

  // Find missing variables
  const missingVars = requiredVars.filter(v => !currentVars.has(v));

  if (missingVars.length === 0) {
    return { upgraded: false, addedVars: [] };
  }

  // Append missing variables
  const appendLines: string[] = [];

  for (const varName of missingVars) {
    const key = varName as keyof HookEnvConfig;
    const value = serverConfig[key] || '';

    if (varName === 'PROJECT_ID') {
      appendLines.push(`PROJECT_ID=${projectId || serverConfig.projectId || '__PROJECT_ID__'}`);
    } else if (varName === 'API_QUEUE_HOST') {
      appendLines.push(`API_QUEUE_HOST=${value || 'localhost'}`);
    } else {
      appendLines.push(`${varName}=${value || ''}`);
    }
  }

  // Append to file
  const newContent = currentContent.trimEnd() + '\n\n# Added by upgrade\n' + appendLines.join('\n') + '\n';
  await fs.writeFile(hookEnvPath, newContent, 'utf-8');

  return { upgraded: true, addedVars: missingVars };
}
