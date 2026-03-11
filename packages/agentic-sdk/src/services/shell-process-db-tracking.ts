/**
 * Shell process DB tracking service - list, create, update status of shell process records (no actual spawning)
 */
import { eq, desc } from 'drizzle-orm';
import * as schema from '../db/database-schema.ts';
import { generateId } from '../lib/nanoid-id-generator.ts';

export function createShellService(db: any) {
  return {
    async list(projectId: string) {
      return db.select().from(schema.shells)
        .where(eq(schema.shells.projectId, projectId))
        .orderBy(desc(schema.shells.createdAt))
        .all();
    },

    async create(data: {
      projectId: string;
      attemptId?: string;
      command: string;
      cwd: string;
      pid?: number;
    }) {
      const id = generateId('sh');
      const record = {
        id,
        projectId: data.projectId,
        attemptId: data.attemptId || null,
        command: data.command,
        cwd: data.cwd,
        pid: data.pid || null,
        status: 'running' as const,
        createdAt: Date.now(),
      };
      await db.insert(schema.shells).values(record);
      return record;
    },

    async updateStatus(
      id: string,
      status: string,
      extras?: { exitCode?: number; exitSignal?: string; stoppedAt?: number }
    ) {
      const updates: any = { status };
      if (extras?.exitCode !== undefined) updates.exitCode = extras.exitCode;
      if (extras?.exitSignal !== undefined) updates.exitSignal = extras.exitSignal;
      updates.stoppedAt = extras?.stoppedAt ?? Date.now();
      await db.update(schema.shells).set(updates).where(eq(schema.shells.id, id));
      return db.select().from(schema.shells).where(eq(schema.shells.id, id)).get();
    },

    async getById(id: string) {
      return db.select().from(schema.shells).where(eq(schema.shells.id, id)).get();
    },
  };
}
