/**
 * Query Options Builder for Claude SDK Provider
 *
 * Constructs the full options object passed to the SDK query() call, including:
 * - allowed tools list (built-ins + MCP wildcards)
 * - session resume/resumeSessionAt passthrough
 * - checkpoint options
 * - canUseTool callback factory (AskUserQuestion gate + Bash BGPID fix)
 * - subprocess environment (strips proxy/session detection vars)
 * - system prompt preset
 */

import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { checkpointManager } from '../checkpoint-manager';
import { createLogger } from '../logger';
import { isServerCommand } from './claude-sdk-model-alias-and-server-command-utils';
import type { MCPServerConfig } from './claude-sdk-mcp-config-loader';

const log = createLogger('SDKProvider:QueryBuilder');

export interface AskUserQuestionAnswer {
  questions: unknown[];
  answers: Record<string, string>;
}

export type CanUseToolCallback = (toolName: string, input: Record<string, unknown>) => Promise<
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string }
>;

export interface QueryOptionsBuilderParams {
  projectPath: string;
  model: string;
  sessionOptions?: { resume?: string; resumeSessionAt?: string };
  maxTurns?: number;
  systemPromptAppend?: string;
  mcpServers?: Record<string, MCPServerConfig>;
  mcpToolWildcards: string[];
  controller: AbortController;
  canUseToolCallback: CanUseToolCallback;
}

/**
 * Build the options object for SDK query(), minus prompt.
 */
export function buildQueryOptions(params: QueryOptionsBuilderParams) {
  const {
    projectPath, model, sessionOptions, maxTurns,
    mcpServers, mcpToolWildcards, controller, canUseToolCallback,
  } = params;

  const checkpointOptions = checkpointManager.getCheckpointingOptions();

  // SDK has its own bundled cli.js — no need to find an external Claude CLI executable.
  // Use process.execPath (absolute node path) so SDK spawn works under PM2/systemd with nvm.
  const queryOptions = {
    executable: process.execPath as 'node',
    cwd: projectPath,
    model,
    permissionMode: 'bypassPermissions' as const,
    ...(mcpServers ? { mcpServers } : {}),
    allowedTools: [
      'Skill', 'Task',
      'Read', 'Write', 'Edit', 'NotebookEdit',
      'Bash', 'Grep', 'Glob',
      'WebFetch', 'WebSearch',
      'TodoWrite', 'AskUserQuestion',
      ...mcpToolWildcards,
    ],
    ...(sessionOptions?.resume ? { resume: sessionOptions.resume } : {}),
    ...(sessionOptions?.resumeSessionAt ? { resumeSessionAt: sessionOptions.resumeSessionAt } : {}),
    ...checkpointOptions,
    ...(maxTurns ? { maxTurns } : {}),
    abortController: controller,
    canUseTool: canUseToolCallback,
    env: buildIsolatedSubprocessEnv(model),
  };

  log.debug({ model, cwd: projectPath, mcpCount: mcpToolWildcards.length }, 'Query options built');
  return queryOptions;
}

/**
 * Build the canUseTool callback that:
 * 1. Gates AskUserQuestion via a promise resolved by answerQuestion()
 * 2. Injects BGPID capture for server Bash commands
 */
export function buildCanUseToolCallback(
  attemptId: string,
  hasPending: () => boolean,
  registerQuestion: (toolUseId: string, questions: unknown[]) => void,
  waitForAnswer: (toolUseId: string) => Promise<AskUserQuestionAnswer | null>,
): CanUseToolCallback {
  return async (toolName: string, input: Record<string, unknown>) => {
    log.debug({ toolName, attemptId }, 'canUseTool called');

    if (toolName === 'AskUserQuestion') {
      if (hasPending()) {
        return { behavior: 'deny', message: 'Duplicate question' };
      }
      const toolUseId = `ask-${Date.now()}`;
      const questions = (input.questions as unknown[]) || [];
      registerQuestion(toolUseId, questions);

      const answer = await waitForAnswer(toolUseId);

      if (!answer || Object.keys(answer.answers).length === 0) {
        return { behavior: 'deny', message: 'User cancelled' };
      }
      return { behavior: 'allow', updatedInput: answer as unknown as Record<string, unknown> };
    }

    // Bash BGPID fix — intercept server commands missing background PID capture
    if (toolName === 'Bash') {
      const command = input.command as string | undefined;
      if (command && isServerCommand(command) && !command.includes('echo "BGPID:$!"')) {
        if (/>\s*\/tmp\/[^\s]+\.log\s*$/.test(command)) {
          const fixedCommand = command.trim() + ' 2>&1 & echo "BGPID:$!"';
          log.debug({ fixedCommand }, 'Fixed BGPID pattern');
          return { behavior: 'allow', updatedInput: { ...input, command: fixedCommand } };
        }
      }
    }

    return { behavior: 'allow', updatedInput: input };
  };
}

// ─── Isolated Subprocess Environment ─────────────────────────────────────────

/**
 * Vars to strip from subprocess env to prevent the SDK CLI from:
 * - Detecting a nested Claude Code session (CLAUDECODE)
 * - Inheriting Claude Code entrypoint metadata
 * - Loading remote MCP servers via claude.ai auth tokens
 * - Picking up ClaudeKit plugin state
 */
const STRIPPED_ENV_PREFIXES = [
  'CLAUDECODE',           // nested session detection
  'CLAUDE_CODE_ENTRYPOINT', // entrypoint metadata
  'CK_',                  // ClaudeKit plugin vars
];

/**
 * Build a clean env for the SDK subprocess.
 * Keeps all system/LLM vars, strips session/auth/plugin vars,
 * and redirects CLAUDE_CONFIG_DIR to an isolated empty dir
 * so the CLI can't fetch remote MCP servers from claude.ai.
 */
function buildIsolatedSubprocessEnv(model: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(process.env)) {
    // Skip vars that leak session state or plugin config
    if (STRIPPED_ENV_PREFIXES.some(prefix => key.startsWith(prefix))) continue;
    env[key] = value;
  }

  // Override model for the subprocess
  env.ANTHROPIC_MODEL = model;

  // Point CLI config to an isolated dir so it has no auth tokens
  // and cannot fetch remote MCP servers from claude.ai
  // Must be absolute so SDK subprocess (cwd=projectPath) resolves the same location
  const isolatedConfigDir = resolve(
    process.env.DATA_DIR || './data',
    'claude-sdk-isolated-config'
  );
  try { mkdirSync(isolatedConfigDir, { recursive: true }); } catch { /* exists */ }
  env.CLAUDE_CONFIG_DIR = isolatedConfigDir;

  return env;
}
