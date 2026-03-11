/**
 * Project CRUD service - list, get, create, update, delete projects in SQLite via Drizzle ORM
 */
import { eq, desc } from 'drizzle-orm';
import * as schema from '../db/database-schema.ts';
import { generateId } from '../lib/nanoid-id-generator.ts';

export function createProjectService(db: any) {
  return {
    async list() {
      return db.select().from(schema.projects).orderBy(desc(schema.projects.createdAt)).all();
    },

    async getById(id: string) {
      return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
    },

    async getByPath(path: string) {
      return db.select().from(schema.projects).where(eq(schema.projects.path, path)).get();
    },

    async create(data: { name: string; path: string }) {
      const id = generateId('proj');
      const project = { id, ...data, createdAt: Date.now() };
      await db.insert(schema.projects).values(project);
      return project;
    },

    async update(id: string, data: Partial<{ name: string; path: string }>) {
      await db.update(schema.projects).set(data).where(eq(schema.projects.id, id));
      return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
    },

    async remove(id: string) {
      await db.delete(schema.projects).where(eq(schema.projects.id, id));
    },
  };
}
