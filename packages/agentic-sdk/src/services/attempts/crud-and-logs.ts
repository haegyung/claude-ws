/**
 * Attempt CRUD service - create/update attempts and manage streaming attempt_logs entries
 */
import { eq } from 'drizzle-orm';
import * as schema from '../db/database-schema.ts';
import { generateId } from '../lib/nanoid-id-generator.ts';

export function createAttemptService(db: any) {
  return {
    async getById(id: string) {
      const attempt = await db.select().from(schema.attempts)
        .where(eq(schema.attempts.id, id)).get();
      if (!attempt) return null;
      const logs = await db.select().from(schema.attemptLogs)
        .where(eq(schema.attemptLogs.attemptId, id))
        .orderBy(schema.attemptLogs.createdAt)
        .all();
      return { ...attempt, logs };
    },

    async create(data: {
      taskId: string;
      prompt: string;
      displayPrompt?: string;
      outputFormat?: string;
      outputSchema?: string;
    }) {
      const id = generateId('atmp');
      const attempt = {
        id,
        taskId: data.taskId,
        prompt: data.prompt,
        displayPrompt: data.displayPrompt || null,
        outputFormat: data.outputFormat || null,
        outputSchema: data.outputSchema || null,
        status: 'running' as const,
        createdAt: Date.now(),
      };
      await db.insert(schema.attempts).values(attempt);
      return attempt;
    },

    async updateStatus(
      id: string,
      status: string,
      extras?: {
        sessionId?: string;
        completedAt?: number;
        totalTokens?: number;
        inputTokens?: number;
        outputTokens?: number;
        cacheCreationTokens?: number;
        cacheReadTokens?: number;
        totalCostUSD?: string;
        numTurns?: number;
        durationMs?: number;
        contextUsed?: number;
        contextLimit?: number;
        contextPercentage?: number;
      }
    ) {
      const updates: any = { status, ...extras };
      if (status === 'completed' && !updates.completedAt) {
        updates.completedAt = Date.now();
      }
      await db.update(schema.attempts).set(updates).where(eq(schema.attempts.id, id));
      return db.select().from(schema.attempts).where(eq(schema.attempts.id, id)).get();
    },

    async addLog(attemptId: string, type: 'stdout' | 'stderr' | 'json', content: string) {
      await db.insert(schema.attemptLogs).values({
        attemptId,
        type,
        content,
        createdAt: Date.now(),
      });
    },

    async getLogs(attemptId: string) {
      return db.select().from(schema.attemptLogs)
        .where(eq(schema.attemptLogs.attemptId, attemptId))
        .orderBy(schema.attemptLogs.createdAt)
        .all();
    },

    async getFiles(attemptId: string) {
      return db.select().from(schema.attemptFiles)
        .where(eq(schema.attemptFiles.attemptId, attemptId))
        .orderBy(schema.attemptFiles.createdAt)
        .all();
    },

    async getStatus(id: string) {
      const row = await db
        .select({ id: schema.attempts.id, status: schema.attempts.status, completedAt: schema.attempts.completedAt })
        .from(schema.attempts)
        .where(eq(schema.attempts.id, id))
        .get();
      return row || null;
    },

    async cancel(id: string) {
      await db.update(schema.attempts)
        .set({ status: 'cancelled', completedAt: Date.now() })
        .where(eq(schema.attempts.id, id));
    },
  };
}
