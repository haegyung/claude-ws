/**
 * Agent Persistent Question Store - Task-scoped AskUserQuestion data that survives agent cleanup
 *
 * Extracted from agent-manager.ts. Stores pending question payloads keyed by taskId
 * so they remain accessible after the agent attempt completes or is cancelled.
 * Used when CLI auto-handles AskUserQuestion and the attempt ends before user answers.
 */

export interface PersistentQuestionData {
  attemptId: string;
  toolUseId: string;
  questions: unknown[];
  timestamp: number;
  answer?: Record<string, string>;
  answeredAt?: number;
}

/**
 * PersistentQuestionStore - in-memory map of taskId → question data
 */
export class PersistentQuestionStore {
  private store = new Map<string, PersistentQuestionData>();

  /** Persist question data for a task (survives agent cleanup) */
  set(taskId: string, data: PersistentQuestionData): void {
    this.store.set(taskId, data);
  }

  /** Retrieve persisted question data for a task, or null if absent */
  get(taskId: string): PersistentQuestionData | null {
    return this.store.get(taskId) || null;
  }

  /** Store answer for a pending question (idempotent — returns false if no question exists) */
  setAnswer(taskId: string, answer: Record<string, string>): boolean {
    const data = this.store.get(taskId);
    if (!data) return false;
    data.answer = answer;
    data.answeredAt = Date.now();
    this.store.set(taskId, data);
    return true;
  }

  /** Remove persisted question data for a task */
  clear(taskId: string): void {
    this.store.delete(taskId);
  }
}
