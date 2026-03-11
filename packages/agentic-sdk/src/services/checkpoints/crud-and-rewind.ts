/**
 * Checkpoint CRUD service - list, create, rewind, and bulk-backfill conversation state snapshots
 */
import { eq, desc } from 'drizzle-orm';
import * as schema from '../db/database-schema.ts';
import { generateId } from '../lib/nanoid-id-generator.ts';

export function createCheckpointService(db: any) {
  return {
    async list(taskId: string) {
      return db.select().from(schema.checkpoints)
        .where(eq(schema.checkpoints.taskId, taskId))
        .orderBy(schema.checkpoints.createdAt)
        .all();
    },

    async create(data: {
      taskId: string;
      attemptId: string;
      sessionId: string;
      messageCount: number;
      summary?: string;
      gitCommitHash?: string;
    }) {
      const id = generateId('chkpt');
      const checkpoint = {
        id,
        taskId: data.taskId,
        attemptId: data.attemptId,
        sessionId: data.sessionId,
        messageCount: data.messageCount,
        summary: data.summary || null,
        gitCommitHash: data.gitCommitHash || null,
        createdAt: Date.now(),
      };
      await db.insert(schema.checkpoints).values(checkpoint);
      return checkpoint;
    },

    async rewind(taskId: string, checkpointId: string) {
      const checkpoint = await db.select().from(schema.checkpoints)
        .where(eq(schema.checkpoints.id, checkpointId)).get();
      if (!checkpoint) throw new Error(`Checkpoint not found: ${checkpointId}`);

      await db.update(schema.tasks)
        .set({
          rewindSessionId: checkpoint.sessionId,
          rewindMessageUuid: null,
          updatedAt: Date.now(),
        })
        .where(eq(schema.tasks.id, taskId));

      return checkpoint;
    },

    async listWithAttemptInfo(taskId: string) {
      const results = await db
        .select({
          id: schema.checkpoints.id,
          taskId: schema.checkpoints.taskId,
          attemptId: schema.checkpoints.attemptId,
          sessionId: schema.checkpoints.sessionId,
          gitCommitHash: schema.checkpoints.gitCommitHash,
          messageCount: schema.checkpoints.messageCount,
          summary: schema.checkpoints.summary,
          createdAt: schema.checkpoints.createdAt,
          attemptDisplayPrompt: schema.attempts.displayPrompt,
          attemptPrompt: schema.attempts.prompt,
        })
        .from(schema.checkpoints)
        .leftJoin(schema.attempts, eq(schema.checkpoints.attemptId, schema.attempts.id))
        .where(eq(schema.checkpoints.taskId, taskId))
        .orderBy(desc(schema.checkpoints.createdAt));

      return results.map((r: any) => ({
        id: r.id,
        taskId: r.taskId,
        attemptId: r.attemptId,
        sessionId: r.sessionId,
        gitCommitHash: r.gitCommitHash,
        messageCount: r.messageCount,
        summary: r.summary,
        createdAt: r.createdAt,
        attempt: {
          displayPrompt: r.attemptDisplayPrompt,
          prompt: r.attemptPrompt,
        },
      }));
    },

    async backfillFromCompleted() {
      // Get all completed attempts
      const completedAttempts = await db.select().from(schema.attempts)
        .where(eq(schema.attempts.status, 'completed'))
        .all();

      let created = 0;
      let skipped = 0;

      for (const attempt of completedAttempts) {
        if (!attempt.sessionId) {
          skipped++;
          continue;
        }

        // Check if checkpoint already exists for this attempt
        const existing = await db.select().from(schema.checkpoints)
          .where(eq(schema.checkpoints.attemptId, attempt.id))
          .limit(1);

        if (existing.length > 0) {
          skipped++;
          continue;
        }

        // Get logs for this attempt
        const logs = await db.select().from(schema.attemptLogs)
          .where(eq(schema.attemptLogs.attemptId, attempt.id))
          .all();

        // Extract summary from last assistant message
        let summary = '';
        for (let i = logs.length - 1; i >= 0; i--) {
          if (logs[i].type === 'json') {
            try {
              const data = JSON.parse(logs[i].content);
              if (data.type === 'assistant' && data.message?.content) {
                const text = data.message.content
                  .filter((b: { type: string }) => b.type === 'text')
                  .map((b: { text: string }) => b.text)
                  .join(' ');
                summary = text.substring(0, 100) + (text.length > 100 ? '...' : '');
                break;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }

        // Create checkpoint
        await db.insert(schema.checkpoints).values({
          id: generateId('chkpt'),
          taskId: attempt.taskId,
          attemptId: attempt.id,
          sessionId: attempt.sessionId,
          messageCount: logs.filter((l: any) => l.type === 'json').length,
          summary,
          createdAt: attempt.completedAt || attempt.createdAt,
        });

        created++;
      }

      return { created, skipped, total: completedAttempts.length };
    },

    async backfill(taskId: string, items: Array<{
      attemptId: string;
      sessionId: string;
      messageCount: number;
      summary?: string;
      gitCommitHash?: string;
      createdAt?: number;
    }>) {
      const rows = items.map((item) => ({
        id: generateId('chkpt'),
        taskId,
        attemptId: item.attemptId,
        sessionId: item.sessionId,
        messageCount: item.messageCount,
        summary: item.summary || null,
        gitCommitHash: item.gitCommitHash || null,
        createdAt: item.createdAt || Date.now(),
      }));
      if (rows.length > 0) {
        await db.insert(schema.checkpoints).values(rows);
      }
      return rows;
    },
  };
}
