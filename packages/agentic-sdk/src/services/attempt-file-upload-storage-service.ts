/**
 * Upload service - save, list, get, and delete file attachments for attempts stored in data/uploads/
 */
import { eq } from 'drizzle-orm';
import fs from 'fs/promises';
import path from 'path';
import * as schema from '../db/database-schema.ts';
import { generateId } from '../lib/nanoid-id-generator.ts';

export function createUploadService(db: any, uploadsDir: string) {
  return {
    async list(attemptId: string) {
      return db.select().from(schema.attemptFiles)
        .where(eq(schema.attemptFiles.attemptId, attemptId))
        .orderBy(schema.attemptFiles.createdAt)
        .all();
    },

    async save(
      attemptId: string,
      file: { filename: string; originalName: string; mimeType: string; size: number; buffer: Buffer }
    ) {
      const id = generateId('file');
      const storedName = `${id}_${file.filename}`;
      const dest = path.join(uploadsDir, storedName);

      await fs.mkdir(uploadsDir, { recursive: true });
      await fs.writeFile(dest, file.buffer);

      const record = {
        id,
        attemptId,
        filename: storedName,
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
        createdAt: Date.now(),
      };
      await db.insert(schema.attemptFiles).values(record);
      return record;
    },

    async getById(id: string) {
      return db.select().from(schema.attemptFiles)
        .where(eq(schema.attemptFiles.id, id))
        .get();
    },

    async remove(id: string) {
      const record = await db.select().from(schema.attemptFiles)
        .where(eq(schema.attemptFiles.id, id))
        .get();
      if (record) {
        const filePath = path.join(uploadsDir, record.filename);
        await fs.unlink(filePath).catch(() => { /* file may already be deleted */ });
        await db.delete(schema.attemptFiles).where(eq(schema.attemptFiles.id, id));
      }
    },
  };
}
