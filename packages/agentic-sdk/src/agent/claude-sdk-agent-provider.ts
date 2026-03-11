/**
 * Claude SDK agent provider — wraps @anthropic-ai/claude-agent-sdk query() with MCP config loading,
 * AskUserQuestion handling, model alias mapping, and abort management.
 * Uses ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN from env config (no CLI fallback).
 */

import { EventEmitter } from 'events';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import { adaptSDKMessage, isValidSDKMessage } from './claude-sdk-message-to-output-adapter';
import type { SDKResultMessage } from './claude-sdk-message-to-output-adapter';
import { createLogger } from '../lib/pino-logger';

const log = createLogger('SDKProvider');

// --- MCP config types ---

interface MCPStdioServerConfig { type?: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
interface MCPHttpServerConfig { type: 'http'; url: string; headers?: Record<string, string> }
interface MCPSSEServerConfig { type: 'sse'; url: string; headers?: Record<string, string> }
type MCPServerConfig = MCPStdioServerConfig | MCPHttpServerConfig | MCPSSEServerConfig;
interface MCPConfig { mcpServers?: Record<string, MCPServerConfig> }

function loadSingleMCPConfig(configPath: string): Record<string, MCPServerConfig> | null {
  if (!existsSync(configPath)) return null;
  try {
    const content = readFileSync(configPath, 'utf-8');
    let config = JSON.parse(content) as MCPConfig;
    if (!config.mcpServers) {
      const keys = Object.keys(config);
      const looksLikeServers = keys.some(k => {
        const v = (config as Record<string, unknown>)[k];
        return v && typeof v === 'object' && ('command' in v || 'url' in v || 'type' in v);
      });
      if (looksLikeServers) config = { mcpServers: config as unknown as Record<string, MCPServerConfig> };
    }
    return config.mcpServers || null;
  } catch (err) {
    log.warn({ err, path: configPath }, 'Failed to parse MCP config');
    return null;
  }
}

function interpolateEnvVars(servers: Record<string, MCPServerConfig>): void {
  for (const serverConfig of Object.values(servers)) {
    if ('env' in serverConfig && serverConfig.env) {
      for (const [k, v] of Object.entries(serverConfig.env)) {
        if (typeof v === 'string' && v.startsWith('${') && v.endsWith('}')) {
          serverConfig.env[k] = process.env[v.slice(2, -1)] || '';
        }
      }
    }
    if ('headers' in serverConfig && serverConfig.headers) {
      for (const [k, v] of Object.entries(serverConfig.headers)) {
        if (typeof v === 'string' && v.includes('${')) {
          serverConfig.headers[k] = v.replace(/\$\{([^}]+)\}/g, (_, e) => process.env[e] || '');
        }
      }
    }
  }
}

function loadMCPConfig(projectPath: string): MCPConfig | null {
  const claudeConfigPath = join(homedir(), '.claude.json');
  let userServers: Record<string, MCPServerConfig> | null = null;

  if (existsSync(claudeConfigPath)) {
    try {
      const config = JSON.parse(readFileSync(claudeConfigPath, 'utf-8'));
      if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
        userServers = config.mcpServers;
      }
      if (config.projects?.[projectPath]?.mcpServers) {
        userServers = { ...(userServers || {}), ...config.projects[projectPath].mcpServers };
      }
    } catch (err) {
      log.warn({ err }, 'Failed to parse ~/.claude.json');
    }
  }

  const projectServers = loadSingleMCPConfig(join(projectPath, '.mcp.json'));
  const merged = { ...(userServers || {}), ...(projectServers || {}) };
  if (Object.keys(merged).length === 0) return null;
  interpolateEnvVars(merged);
  return { mcpServers: merged };
}

// --- Model alias mapping ---

const MODEL_ALIAS_MAP: Record<string, string> = {
  'claude-opus-4-6': 'opus',
  'claude-sonnet-4-5-20250929': 'sonnet',
  'claude-haiku-4-5-20251001': 'haiku',
  'claude-3-5-sonnet-20241022': 'sonnet',
};

// --- Pending question types ---

interface QuestionAnswer { questions: unknown[]; answers: Record<string, string> }
interface PendingQuestion { toolUseId: string; resolve: (answer: QuestionAnswer | null) => void }

// --- Session ---

interface SDKSession {
  attemptId: string;
  sessionId?: string;
  queryRef?: Query;
  controller: AbortController;
}

// --- Provider ---

export class AgentProvider extends EventEmitter {
  private sessions = new Map<string, SDKSession>();
  private pendingQuestions = new Map<string, PendingQuestion>();
  private pendingQuestionData = new Map<string, { toolUseId: string; questions: unknown[]; timestamp: number }>();

  constructor(private config: {
    anthropicBaseUrl?: string;
    anthropicAuthToken?: string;
    anthropicModel?: string;
    anthropicDefaultOpusModel?: string;
    anthropicDefaultSonnetModel?: string;
    anthropicDefaultHaikuModel?: string;
  }) {
    super();
  }

  resolveModel(modelId: string): string {
    return MODEL_ALIAS_MAP[modelId] || modelId;
  }

  async start(options: {
    attemptId: string; projectPath: string; prompt: string;
    model?: string; sessionOptions?: { resume?: string; resumeSessionAt?: string };
    maxTurns?: number;
  }): Promise<void> {
    const { attemptId } = options;
    const controller = new AbortController();
    const session: SDKSession = { attemptId, controller };
    this.sessions.set(attemptId, session);
    // Run async — events emitted as messages arrive
    this.runQuery(session, options).catch(() => {});
  }

  private async runQuery(
    session: SDKSession,
    options: { attemptId: string; projectPath: string; prompt: string; model?: string; sessionOptions?: { resume?: string; resumeSessionAt?: string }; maxTurns?: number }
  ): Promise<void> {
    const { attemptId, projectPath, prompt, sessionOptions, maxTurns, model } = options;
    const { controller } = session;

    try {
      const mcpConfig = loadMCPConfig(projectPath);
      const mcpWildcards = mcpConfig?.mcpServers ? Object.keys(mcpConfig.mcpServers).map(n => `mcp__${n}__*`) : [];
      // Use custom model from env if configured, otherwise resolve alias
      const defaultModel = this.config.anthropicModel || 'opus';
      const effectiveModel = model ? this.resolveModel(model) : defaultModel;

      // Set env vars on process.env so the SDK subprocess inherits them
      if (this.config.anthropicBaseUrl) process.env.ANTHROPIC_BASE_URL = this.config.anthropicBaseUrl;
      if (this.config.anthropicAuthToken) {
        process.env.ANTHROPIC_AUTH_TOKEN = this.config.anthropicAuthToken;
        process.env.ANTHROPIC_API_KEY = this.config.anthropicAuthToken;
      }
      delete process.env.CLAUDECODE;
      delete process.env.CLAUDE_CODE_ENTRYPOINT;

      const queryOptions = {
        cwd: projectPath,
        model: effectiveModel,
        permissionMode: 'bypassPermissions' as const,
        settingSources: ['user', 'project'] as ('user' | 'project')[],
        ...(mcpConfig?.mcpServers ? { mcpServers: mcpConfig.mcpServers } : {}),
        allowedTools: [
          'Skill', 'Task', 'Read', 'Write', 'Edit', 'NotebookEdit',
          'Bash', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'TodoWrite', 'AskUserQuestion',
          ...mcpWildcards,
        ],
        ...(sessionOptions?.resume ? { resume: sessionOptions.resume } : {}),
        ...(sessionOptions?.resumeSessionAt ? { resumeSessionAt: sessionOptions.resumeSessionAt } : {}),
        ...(maxTurns ? { maxTurns } : {}),
        abortController: controller,
        canUseTool: async (toolName: string, input: Record<string, unknown>) => {
          if (toolName === 'AskUserQuestion') {
            if (this.pendingQuestions.has(attemptId)) return { behavior: 'deny' as const, message: 'Duplicate question' };
            const toolUseId = `ask-${Date.now()}`;
            const questions = (input.questions as unknown[]) || [];
            this.pendingQuestionData.set(attemptId, { toolUseId, questions, timestamp: Date.now() });
            this.emit('question', { attemptId, toolUseId, questions });
            const answer = await new Promise<QuestionAnswer | null>(resolve => {
              this.pendingQuestions.set(attemptId, { toolUseId, resolve });
            });
            this.pendingQuestions.delete(attemptId);
            this.pendingQuestionData.delete(attemptId);
            if (!answer || Object.keys(answer.answers).length === 0) return { behavior: 'deny' as const, message: 'User cancelled' };
            return { behavior: 'allow' as const, updatedInput: answer as unknown as Record<string, unknown> };
          }
          return { behavior: 'allow' as const, updatedInput: input };
        },
      };

      log.info({ model: effectiveModel, cwd: projectPath, resume: sessionOptions?.resume }, 'SDK query starting');

      const response = query({
        prompt,
        options: {
          ...queryOptions,
          systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const, append: '' },
          stderr: (data: string) => { log.error({ stderr: data.slice(0, 500), attemptId }, 'Claude stderr'); },
        },
      });

      session.queryRef = response;

      for await (const message of response) {
        if (controller.signal.aborted) break;
        try {
          if (!isValidSDKMessage(message)) continue;
          const adapted = adaptSDKMessage(message);
          if (adapted.sessionId) session.sessionId = adapted.sessionId;
          this.emit('message', {
            attemptId,
            output: adapted.output,
            sessionId: adapted.sessionId,
            backgroundShell: adapted.backgroundShell,
            resultMessage: message.type === 'result' ? message as SDKResultMessage : undefined,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          log.error({ err, msg }, 'Message processing error');
          if (!msg.includes('Unexpected end of JSON')) {
            this.emit('stderr', { attemptId, content: `Warning: ${msg}` });
          }
        }
      }

      this.cleanupPending(attemptId);
      this.sessions.delete(attemptId);
      this.emit('complete', { attemptId, sessionId: session.sessionId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      const wasResuming = !!sessionOptions?.resume;

      log.error({ err: error, attemptId }, 'SDK query failed');

      if (wasResuming && !controller.signal.aborted) {
        log.warn({ attemptId }, 'Resume failed, retrying without resume');
        this.sessions.set(attemptId, session);
        return this.runQuery(session, { ...options, sessionOptions: undefined });
      }

      const isPromptTooLong = errorMessage.toLowerCase().includes('prompt is too long') ||
        errorMessage.toLowerCase().includes('request too large');

      this.cleanupPending(attemptId);
      this.sessions.delete(attemptId);
      this.emit('error', { attemptId, error: errorMessage, errorName, isPromptTooLong, wasResuming });
    }
  }

  answerQuestion(attemptId: string, toolUseId: string | undefined, questions: unknown[], answers: Record<string, string>): boolean {
    const pending = this.pendingQuestions.get(attemptId);
    if (!pending) return false;
    if (toolUseId && pending.toolUseId !== toolUseId) {
      log.warn({ attemptId, expected: pending.toolUseId, received: toolUseId }, 'Rejecting stale answer');
      return false;
    }
    pending.resolve({ questions, answers });
    this.pendingQuestions.delete(attemptId);
    this.pendingQuestionData.delete(attemptId);
    this.emit('questionResolved', { attemptId });
    return true;
  }

  cancelQuestion(attemptId: string): boolean {
    const pending = this.pendingQuestions.get(attemptId);
    if (!pending) return false;
    pending.resolve(null);
    this.pendingQuestions.delete(attemptId);
    this.pendingQuestionData.delete(attemptId);
    this.emit('questionResolved', { attemptId });
    return true;
  }

  hasPendingQuestion(attemptId: string): boolean {
    return this.pendingQuestions.has(attemptId);
  }

  getPendingQuestionData(attemptId: string): { toolUseId: string; questions: unknown[]; timestamp: number } | null {
    return this.pendingQuestionData.get(attemptId) || null;
  }

  cancelSession(attemptId: string): boolean {
    const session = this.sessions.get(attemptId);
    if (!session) return false;
    this.cleanupPending(attemptId);
    try { session.queryRef?.close(); } catch { session.controller.abort(); }
    this.sessions.delete(attemptId);
    return true;
  }

  private cleanupPending(attemptId: string): void {
    const pending = this.pendingQuestions.get(attemptId);
    if (pending) {
      pending.resolve(null);
      this.pendingQuestions.delete(attemptId);
      this.pendingQuestionData.delete(attemptId);
    }
  }
}
