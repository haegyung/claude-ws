/**
 * Task CRUD service - list, get, create, update, delete, reorder tasks.
 * Read-heavy query methods (conversation history, stats, running attempt) live in
 * task-attempt-and-conversation-queries.ts and are composed in here.
 */
import { eq, and, desc, inArray } from 'drizzle-orm';
import * as schema from '../../db/database-schema';
import { generateId } from '../../lib/nanoid-id-generator';
import { createTaskQueryMethods } from './task-attempt-and-conversation-queries';

export function createTaskService(db: any) {
  const queries = createTaskQueryMethods(db);

  return {
    // --- list / filter ---

    async list(options?: { projectId?: string; projectIds?: string[]; statuses?: string[] }) {
      const conditions: any[] = [];

      if (options?.projectIds && options.projectIds.length > 0) {
        conditions.push(inArray(schema.tasks.projectId, options.projectIds));
      } else if (options?.projectId) {
        conditions.push(eq(schema.tasks.projectId, options.projectId));
      }

      if (options?.statuses && options.statuses.length > 0) {
        conditions.push(inArray(schema.tasks.status, options.statuses as any[]));
      }

      const query = db.select().from(schema.tasks);
      const filtered = conditions.length > 0
        ? query.where(conditions.length === 1 ? conditions[0] : and(...conditions))
        : query;

      return filtered.orderBy(schema.tasks.status, schema.tasks.position).all();
    },

    // --- single record ---

    async getById(id: string) {
      return db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    },

    // --- create ---

    async create(data: { projectId: string; title: string; description?: string; status?: string; pendingFileIds?: string }) {
      const status = data.status || 'todo';
      const existing = await db.select().from(schema.tasks)
        .where(and(eq(schema.tasks.projectId, data.projectId), eq(schema.tasks.status, status as any)))
        .orderBy(desc(schema.tasks.position))
        .limit(1);
      const position = existing.length > 0 ? existing[0].position + 1 : 0;

      const id = generateId('task');
      const now = Date.now();
      const task: any = {
        id,
        projectId: data.projectId,
        title: data.title,
        description: data.description || null,
        status: status as any,
        position,
        createdAt: now,
        updatedAt: now,
      };
      if (data.pendingFileIds) task.pendingFileIds = data.pendingFileIds;
      await db.insert(schema.tasks).values(task);
      return task;
    },

    // --- update ---

    async update(id: string, data: Partial<schema.Task>) {
      const updates = { ...data, updatedAt: Date.now() };
      await db.update(schema.tasks).set(updates).where(eq(schema.tasks.id, id));
      return db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    },

    // --- delete ---

    async remove(id: string) {
      await db.delete(schema.tasks).where(eq(schema.tasks.id, id));
    },

    // --- reorder ---

    async reorder(taskId: string, newPosition: number, newStatus?: string) {
      const updates: any = { position: newPosition, updatedAt: Date.now() };
      if (newStatus) updates.status = newStatus;
      await db.update(schema.tasks).set(updates).where(eq(schema.tasks.id, taskId));
      return db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
    },

    // --- attempt / conversation queries (delegated) ---

    getAttempts: queries.getAttempts,
    getAttemptsAsc: queries.getAttemptsAsc,
    getConversation: queries.getConversation,
    getConversationHistory: queries.getConversationHistory,
    getConversationSummaryForCompact: queries.getConversationSummaryForCompact,
    getRunningAttempt: queries.getRunningAttempt,
    getStats: queries.getStats,
  };
}
