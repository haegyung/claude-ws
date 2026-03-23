/**
 * CLI Process Spawner for Claude CLI Provider
 *
 * Builds the argument list and spawns the Claude CLI child process
 * with the correct stdio, env, and working directory configuration.
 * Extracted from ClaudeCLIProvider.start() to reduce that method's size.
 */

import { spawn, type ChildProcess } from 'child_process';
import { createLogger } from '../logger';

const log = createLogger('CLIProvider:Spawner');

export interface SpawnCLIOptions {
  claudePath: string;
  projectPath: string;
  model?: string;
  sessionResume?: string;
  maxTurns?: number;
  systemPromptAppend?: string;
  attemptId: string;
}

/**
 * Spawn the Claude CLI child process with stream-json I/O.
 * Returns the ChildProcess ready for stdin writes and stdout/stderr listeners.
 */
export function spawnCLIProcess(opts: SpawnCLIOptions): ChildProcess {
  const { claudePath, projectPath, model, sessionResume, maxTurns, systemPromptAppend, attemptId } = opts;

  const args: string[] = [
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
  ];

  if (model) args.push('--model', model);
  if (sessionResume) args.push('--resume', sessionResume);
  if (maxTurns) args.push('--max-turns', String(maxTurns));
  if (systemPromptAppend) args.push('--append-system-prompt', systemPromptAppend);

  // Normalize path for Windows
  const normalizedProjectPath = process.platform === 'win32'
    ? projectPath.replace(/\//g, '\\')
    : projectPath;

  log.info({ claudePath, argsCount: args.length, attemptId }, 'Spawning CLI process');

  // Strip SDK-specific env vars so CLI uses its own auth and model config, not the custom endpoint
  const { ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL,
    ANTHROPIC_DEFAULT_OPUS_MODEL, ANTHROPIC_DEFAULT_SONNET_MODEL, ANTHROPIC_DEFAULT_HAIKU_MODEL,
    ...cleanEnv } = process.env;

  return spawn(claudePath, args, {
    cwd: normalizedProjectPath,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...cleanEnv,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      TERM: 'dumb',
      PATH: process.platform === 'win32'
        ? (process.env.PATH || '').split(';').filter(p => {
            const lp = p.toLowerCase().trim().replace(/\//g, '\\');
            return !lp.startsWith('c:\\windows') &&
              !lp.startsWith('c:\\program files (x86)\\windows kits');
          }).join(';')
        : `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`,
    },
  });
}

/**
 * Write the initial user prompt to the child process stdin as a stream-json message.
 */
export function sendInitialPrompt(child: ChildProcess, prompt: string): void {
  const msg = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: prompt }] },
  });
  child.stdin?.write(msg + '\n');
}
