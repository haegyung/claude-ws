/**
 * CLI Session and Pending Question Types for Claude CLI Provider
 *
 * CLISession wraps a spawned Claude CLI child process and tracks:
 * - the child process reference for stdin writes and kill signals
 * - the current pending AskUserQuestion (toolUseId, questions, timestamp)
 *
 * PendingQuestion holds the data needed to answer or cancel an in-flight
 * AskUserQuestion intercepted from CLI stdout.
 */

import { type ChildProcess } from 'child_process';
import type { ProviderId, ProviderSession } from './types';

// --- Pending Question ---

export interface PendingQuestion {
  toolUseId: string;
  questions: unknown[];
  timestamp: number;
}

// --- CLI Session ---

export class CLISession implements ProviderSession {
  readonly providerId: ProviderId = 'claude-cli';
  sessionId: string | undefined;
  outputFormat?: string;
  child: ChildProcess;
  activeBackgroundAgents: number = 0;
  /** Timer ref for background agent wait polling — cleared on cancel */
  backgroundWaitTimer: ReturnType<typeof setInterval> | null = null;
  /** True when AskUserQuestion popup is shown but user hasn't answered yet — delays stdin close */
  waitingForUserAnswer = false;
  private pendingQuestion: PendingQuestion | null = null;

  constructor(
    readonly attemptId: string,
    child: ChildProcess,
    outputFormat?: string,
  ) {
    this.child = child;
    this.outputFormat = outputFormat;
  }

  setPendingQuestion(q: PendingQuestion | null): void {
    this.pendingQuestion = q;
  }

  getPendingQuestion(): PendingQuestion | null {
    return this.pendingQuestion;
  }

  /**
   * Write a tool_result answer to the CLI process stdin.
   * Returns false if stdin is unavailable or already destroyed.
   */
  writeToolResult(toolUseId: string, content: string): boolean {
    if (!this.child.stdin || this.child.stdin.destroyed) return false;
    const msg = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content }],
      },
    });
    return this.child.stdin.write(msg + '\n');
  }

  /**
   * Write a follow-up text message to the CLI process stdin.
   * Used to send AskUserQuestion answers as a "Chat about this" message.
   * Returns false if stdin is unavailable or already destroyed.
   */
  writeUserMessage(text: string): boolean {
    if (!this.child.stdin || this.child.stdin.destroyed) return false;
    const msg = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text }],
      },
    });
    return this.child.stdin.write(msg + '\n');
  }

  cancel(): void {
    if (this.backgroundWaitTimer) {
      clearInterval(this.backgroundWaitTimer);
      this.backgroundWaitTimer = null;
    }
    if (this.child && !this.child.killed) {
      this.child.kill('SIGTERM');
      setTimeout(() => {
        if (this.child && !this.child.killed) {
          this.child.kill('SIGKILL');
        }
      }, 3000);
    }
  }
}
