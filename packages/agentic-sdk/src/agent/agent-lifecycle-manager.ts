/**
 * Agent lifecycle manager — orchestrates agent start, cancel, question answering,
 * and event forwarding from AgentProvider to external consumers via EventEmitter.
 */

import { EventEmitter } from 'events';
import { AgentProvider } from './claude-sdk-agent-provider';
import type { AgentStartOptions, BackgroundShellInfo } from './agent-start-options-and-event-types';
import { createLogger } from '../lib/pino-logger';

const log = createLogger('AgentManager');

interface AgentInstance {
  attemptId: string;
  sessionId?: string;
  startedAt: number;
}

export class AgentManager extends EventEmitter {
  private agents = new Map<string, AgentInstance>();

  constructor(private provider: AgentProvider) {
    super();
    this.wireProviderEvents();
    process.on('exit', () => this.cancelAll());
  }

  private wireProviderEvents(): void {
    this.provider.on('message', (data: {
      attemptId: string;
      output: unknown;
      sessionId?: string;
      backgroundShell?: BackgroundShellInfo;
    }) => {
      const instance = this.agents.get(data.attemptId);
      if (!instance) return;

      if (data.sessionId) instance.sessionId = data.sessionId;

      if (data.backgroundShell) {
        this.emit('backgroundShell', { attemptId: data.attemptId, shell: data.backgroundShell });
      }

      this.emit('json', { attemptId: data.attemptId, data: data.output });
    });

    this.provider.on('question', (data: { attemptId: string; toolUseId: string; questions: unknown[] }) => {
      this.emit('question', data);
    });

    this.provider.on('questionResolved', (data: { attemptId: string }) => {
      this.emit('questionResolved', data);
    });

    this.provider.on('complete', (data: { attemptId: string; sessionId?: string }) => {
      if (data.sessionId) {
        const instance = this.agents.get(data.attemptId);
        if (instance) instance.sessionId = data.sessionId;
      }
      this.agents.delete(data.attemptId);
      this.emit('exit', { attemptId: data.attemptId, code: 0 });
    });

    this.provider.on('error', (data: {
      attemptId: string;
      error: string;
      errorName: string;
      isPromptTooLong?: boolean;
    }) => {
      this.emit('stderr', { attemptId: data.attemptId, content: `${data.errorName}: ${data.error}` });
      if (data.isPromptTooLong) {
        this.emit('promptTooLong', { attemptId: data.attemptId });
      }
      this.agents.delete(data.attemptId);
      this.emit('exit', { attemptId: data.attemptId, code: 1 });
    });

    this.provider.on('stderr', (data: { attemptId: string; content: string }) => {
      this.emit('stderr', data);
    });
  }

  async start(options: AgentStartOptions): Promise<void> {
    const { attemptId } = options;
    if (this.agents.has(attemptId)) {
      log.warn({ attemptId }, 'Agent already running, ignoring duplicate start');
      return;
    }

    this.agents.set(attemptId, { attemptId, startedAt: Date.now() });

    try {
      await this.provider.start({
        attemptId: options.attemptId,
        projectPath: options.projectPath,
        prompt: options.prompt,
        model: options.model,
        sessionOptions: options.sessionOptions,
        maxTurns: options.maxTurns,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      log.error({ attemptId, err: error }, 'Failed to start agent');
      this.agents.delete(attemptId);
      this.emit('stderr', { attemptId, content: msg });
      this.emit('exit', { attemptId, code: 1 });
    }
  }

  cancel(attemptId: string): boolean {
    if (!this.agents.has(attemptId)) return false;
    this.agents.delete(attemptId);
    return this.provider.cancelSession(attemptId);
  }

  cancelAll(): void {
    for (const attemptId of this.agents.keys()) {
      this.provider.cancelSession(attemptId);
    }
    this.agents.clear();
  }

  isRunning(attemptId: string): boolean {
    return this.agents.has(attemptId);
  }

  getSessionId(attemptId: string): string | undefined {
    return this.agents.get(attemptId)?.sessionId;
  }

  answerQuestion(attemptId: string, toolUseId: string | undefined, questions: unknown[], answers: Record<string, string>): boolean {
    return this.provider.answerQuestion(attemptId, toolUseId, questions, answers);
  }

  cancelQuestion(attemptId: string): boolean {
    return this.provider.cancelQuestion(attemptId);
  }

  hasPendingQuestion(attemptId: string): boolean {
    return this.provider.hasPendingQuestion(attemptId);
  }

  getPendingQuestionData(attemptId: string): { toolUseId: string; questions: unknown[]; timestamp: number } | null {
    return this.provider.getPendingQuestionData(attemptId);
  }

  get runningCount(): number {
    return this.agents.size;
  }

  getRunningAttempts(): string[] {
    return Array.from(this.agents.keys());
  }
}
