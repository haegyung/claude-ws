/**
 * Claude SDK Provider - Uses @anthropic-ai/claude-agent-sdk query()
 *
 * Orchestrator: delegates MCP loading, model alias resolution, and query
 * option construction to focused sub-modules. Owns session lifecycle,
 * AskUserQuestion promise coordination, and event emission.
 *
 * Sub-modules:
 * - MCP config loader  → claude-sdk-mcp-config-loader.ts
 * - Model alias utils  → claude-sdk-model-alias-and-server-command-utils.ts
 * - Query opts builder → claude-sdk-query-options-builder.ts
 */

import { EventEmitter } from 'events';
import { existsSync, mkdirSync } from 'fs';
import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import { adaptSDKMessage, isValidSDKMessage, type SDKResultMessage } from '../sdk-event-adapter';
import { createLogger } from '../logger';
import { loadMCPConfig, getMCPToolWildcards } from './claude-sdk-mcp-config-loader';
import { resolveModel } from './claude-sdk-model-alias-and-server-command-utils';
import { buildQueryOptions, buildCanUseToolCallback } from './claude-sdk-query-options-builder';
import type { Provider, ProviderSession, ProviderStartOptions, ProviderEventData, ProviderId } from './types';

const log = createLogger('SDKProvider');

interface PendingQuestion {
  toolUseId: string;
  resolve: (answer: { questions: unknown[]; answers: Record<string, string> } | null) => void;
}

class SDKSession implements ProviderSession {
  readonly providerId: ProviderId = 'claude-sdk';
  sessionId: string | undefined;
  outputFormat?: string;
  queryRef?: Query;
  constructor(readonly attemptId: string, readonly controller: AbortController, outputFormat?: string) {
    this.outputFormat = outputFormat;
  }
  cancel(): void {
    if (this.queryRef) { try { this.queryRef.close(); } catch { this.controller.abort(); } }
    else { this.controller.abort(); }
  }
}

export class ClaudeSDKProvider extends EventEmitter implements Provider {
  readonly id: ProviderId = 'claude-sdk';
  private sessions = new Map<string, SDKSession>();
  private pendingQuestions = new Map<string, PendingQuestion>();
  private pendingQuestionData = new Map<string, { toolUseId: string; questions: unknown[]; timestamp: number }>();

  resolveModel(displayModelId: string): string { return resolveModel(displayModelId); }

  async start(options: ProviderStartOptions): Promise<ProviderSession> {
    const { attemptId, projectPath, prompt, sessionOptions, maxTurns, model, systemPromptAppend, outputFormat } = options;
    const controller = new AbortController();
    const session = new SDKSession(attemptId, controller, outputFormat);
    this.sessions.set(attemptId, session);
    this.runQuery(session, projectPath, prompt, sessionOptions, maxTurns, model, systemPromptAppend);
    return session;
  }

  private makeCanUseTool(attemptId: string) {
    return buildCanUseToolCallback(
      attemptId,
      () => this.pendingQuestions.has(attemptId),
      (toolUseId, questions) => {
        this.pendingQuestionData.set(attemptId, { toolUseId, questions, timestamp: Date.now() });
        this.emit('question', { attemptId, toolUseId, questions });
      },
      (toolUseId) => new Promise<{ questions: unknown[]; answers: Record<string, string> } | null>(resolve => {
        this.pendingQuestions.set(attemptId, { toolUseId, resolve });
      }).then(answer => {
        this.pendingQuestions.delete(attemptId);
        this.pendingQuestionData.delete(attemptId);
        return answer;
      }),
    );
  }

  private async runQuery(
    session: SDKSession, projectPath: string, prompt: string,
    sessionOptions?: { resume?: string; resumeSessionAt?: string },
    maxTurns?: number, model?: string, systemPromptAppend?: string,
  ): Promise<void> {
    const { attemptId, controller } = session;
    try {
      // Ensure projectPath (used as cwd for SDK subprocess) exists — spawn throws
      // misleading "executable not found" ENOENT if cwd is missing
      if (!existsSync(projectPath)) {
        log.warn({ projectPath, attemptId }, 'Project path missing, creating directory');
        mkdirSync(projectPath, { recursive: true });
      }

      const mcpConfig = loadMCPConfig(projectPath);
      const mcpToolWildcards = mcpConfig?.mcpServers ? getMCPToolWildcards(mcpConfig.mcpServers) : [];
      const effectiveModel = model ? this.resolveModel(model) : 'opus';

      const opts = buildQueryOptions({
        projectPath, model: effectiveModel, sessionOptions, maxTurns,
        mcpServers: mcpConfig?.mcpServers, mcpToolWildcards, controller,
        canUseToolCallback: this.makeCanUseTool(attemptId),
      });

      log.info({
        endpoint: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
        prompt: prompt.substring(0, 200) + (prompt.length > 200 ? '...' : ''),
        model: opts.model, cwd: opts.cwd,
      }, 'SDK Query starting');

      const response = query({ prompt, options: opts });
      session.queryRef = response;

      for await (const message of response) {
        if (controller.signal.aborted) break;
        try {
          if (!isValidSDKMessage(message)) continue;
          const adapted = adaptSDKMessage(message);
          if (adapted.sessionId) session.sessionId = adapted.sessionId;
          this.emit('message', {
            attemptId, output: adapted.output, sessionId: adapted.sessionId,
            checkpointUuid: adapted.checkpointUuid, backgroundShell: adapted.backgroundShell,
            resultMessage: message.type === 'result' ? message as SDKResultMessage : undefined,
            usageEvent: adapted.usageEvent,
            rawMessage: message,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown message error';
          log.error({ err, message: msg }, 'Message processing error');
          if (!msg.includes('Unexpected end of JSON')) this.emit('stderr', { attemptId, content: `Warning: ${msg}` });
        }
      }

      this.cleanupPendingQuestions(attemptId);
      this.sessions.delete(attemptId);
      this.emit('complete', { attemptId, sessionId: session.sessionId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      const wasResuming = !!sessionOptions?.resume;
      log.error({ err: error, message: errorMessage, attemptId }, 'SDK Error - Query failed');
      if (wasResuming && !controller.signal.aborted) {
        log.warn({ attemptId }, 'Resume failed, retrying without resume');
        this.sessions.set(attemptId, session);
        return this.runQuery(session, projectPath, prompt, undefined, maxTurns, model, systemPromptAppend);
      }
      const isPromptTooLong = errorMessage.toLowerCase().includes('prompt is too long') ||
                              errorMessage.toLowerCase().includes('request too large');
      this.cleanupPendingQuestions(attemptId);
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

  hasPendingQuestion(attemptId: string): boolean { return this.pendingQuestions.has(attemptId); }

  getPendingQuestionData(attemptId: string): { toolUseId: string; questions: unknown[]; timestamp: number } | null {
    return this.pendingQuestionData.get(attemptId) || null;
  }

  cancelSession(attemptId: string): boolean {
    const session = this.sessions.get(attemptId);
    if (!session) return false;
    this.cleanupPendingQuestions(attemptId);
    session.cancel();
    this.sessions.delete(attemptId);
    return true;
  }

  private cleanupPendingQuestions(attemptId: string): void {
    const pending = this.pendingQuestions.get(attemptId);
    if (pending) { pending.resolve(null); this.pendingQuestions.delete(attemptId); this.pendingQuestionData.delete(attemptId); }
  }

  override on<K extends keyof ProviderEventData>(event: K, listener: (data: ProviderEventData[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override emit<K extends keyof ProviderEventData>(event: K, data: ProviderEventData[K]): boolean {
    return super.emit(event, data);
  }
}
