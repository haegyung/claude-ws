/**
 * Checkpoint CRUD service - list, create, rewind, and bulk-backfill conversation state snapshots
 */
import { eq } from 'drizzle-orm';
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
