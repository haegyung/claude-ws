/**
 * Process temp uploads into attempt-specific storage and cleanup orphaned tmp files.
 * Called when an attempt is created with tempIds from the tmp upload flow.
 */
import { mkdir, rename, readdir, stat, unlink, writeFile } from 'fs/promises';
import { join, extname } from 'path';
import * as schema from '../../db/database-schema';
import { generateId } from '../../lib/nanoid-id-generator';
import { getContentTypeForExtension } from '../../lib/content-type-map';

export interface ProcessedFile {
  id: string;
  filename: string;
  originalName: string;
  absolutePath: string;
  mimeType: string;
  size: number;
}

/**
 * Move temp files from uploads/tmp/ to uploads/{attemptId}/ and insert DB records.
 * Returns metadata for each successfully processed file.
 */
export async function processAttachments(
  db: any,
  uploadsDir: string,
  attemptId: string,
  tempIds: string[]
): Promise<ProcessedFile[]> {
  if (tempIds.length === 0) return [];

  const tmpDir = join(uploadsDir, 'tmp');
  const attemptDir = join(uploadsDir, attemptId);
  await mkdir(attemptDir, { recursive: true });

  const results: ProcessedFile[] = [];

  for (const tempId of tempIds) {
    try {
      const tempFiles = await readdir(tmpDir);
      const tempFile = tempFiles.find((f) => f.startsWith(tempId));
      if (!tempFile) continue;

      const tempPath = join(tmpDir, tempFile);
      const fileId = generateId('file');
      const ext = extname(tempFile);
      const newFilename = `${fileId}${ext}`;
      const newPath = join(attemptDir, newFilename);

      // Move file from temp to attempt directory
      await rename(tempPath, newPath);

      const stats = await stat(newPath);
      const mimeType = getContentTypeForExtension(ext);

      // Extract original name: pattern is {tempId}-{timestamp}.{ext}
      const extClean = ext.startsWith('.') ? ext.slice(1) : ext;
      const originalName = extClean ? `attachment.${extClean}` : 'attachment';

      // Store path relative to uploadsDir including attemptId subdirectory
      const storedFilename = `${attemptId}/${newFilename}`;
      await db.insert(schema.attemptFiles).values({
        id: fileId,
        attemptId,
        filename: storedFilename,
        originalName,
        mimeType,
        size: stats.size,
      });

      results.push({ id: fileId, filename: newFilename, originalName, absolutePath: newPath, mimeType, size: stats.size });
    } catch {
      // Skip individual file failures
    }
  }

  return results;
}

/**
 * Delete orphaned temp files older than 1 hour from uploads/tmp/.
 * Returns the number of files cleaned up.
 */
export async function cleanupOrphanedTempFiles(uploadsDir: string): Promise<number> {
  const tmpDir = join(uploadsDir, 'tmp');
  try {
    const tempFiles = await readdir(tmpDir);
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    let cleaned = 0;

    for (const file of tempFiles) {
      try {
        const filePath = join(tmpDir, file);
        const stats = await stat(filePath);
        if (stats.mtimeMs < oneHourAgo) {
          await unlink(filePath);
          cleaned++;
        }
      } catch {
        // Skip individual file cleanup failures
      }
    }

    return cleaned;
  } catch {
    return 0;
  }
}

// ---- Constants for tmp upload validation ----
const ALLOWED_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain', 'text/markdown',
  'text/x-typescript', 'text/typescript', 'application/typescript',
  'text/javascript', 'application/javascript', 'application/json',
  'text/css', 'text/html', 'text/xml', 'application/xml',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024;  // 10MB per file
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB total

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_').replace(/\.{2,}/g, '.').slice(0, 100);
}

export interface TmpUploadResult {
  tempId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
}

/**
 * Save files to uploads/tmp/ directory. Returns metadata for each saved file.
 * Validates size limits. Does NOT require DB.
 */
export async function saveTmpFiles(
  uploadsDir: string,
  files: Array<{ buffer: Buffer; filename: string; mimetype: string }>
): Promise<TmpUploadResult[]> {
  const totalSize = files.reduce((sum, f) => sum + f.buffer.length, 0);
  if (totalSize > MAX_TOTAL_SIZE) {
    throw new Error('Total size exceeds 50MB limit');
  }

  const tmpDir = join(uploadsDir, 'tmp');
  await mkdir(tmpDir, { recursive: true });

  const results: TmpUploadResult[] = [];
  for (const file of files) {
    if (file.buffer.length > MAX_FILE_SIZE) {
      throw new Error(`File too large: ${(file.buffer.length / 1024 / 1024).toFixed(1)}MB (max 10MB)`);
    }

    const tempId = generateId('tmp');
    const safeName = sanitizeFilename(file.filename);
    const ext = extname(safeName).toLowerCase();
    const storedFilename = `${tempId}-${Date.now()}${ext || ''}`;

    await writeFile(join(tmpDir, storedFilename), file.buffer);

    results.push({
      tempId,
      filename: storedFilename,
      originalName: file.filename,
      mimeType: file.mimetype,
      size: file.buffer.length,
    });
  }

  return results;
}

/**
 * Find a file by ID across tmp/ and attempt directories.
 * Returns the file path and filename, or null if not found.
 */
export async function findUploadedFile(
  uploadsDir: string,
  fileId: string
): Promise<{ path: string; filename: string } | null> {
  // Check tmp directory first
  const tmpDir = join(uploadsDir, 'tmp');
  try {
    const tmpFiles = await readdir(tmpDir);
    const tmpFile = tmpFiles.find(f => f.startsWith(fileId));
    if (tmpFile) return { path: join(tmpDir, tmpFile), filename: tmpFile };
  } catch { /* tmp dir may not exist */ }

  // Check attempt directories
  try {
    const dirs = await readdir(uploadsDir);
    for (const dir of dirs) {
      if (dir === 'tmp') continue;
      const dirPath = join(uploadsDir, dir);
      const dirStat = await stat(dirPath);
      if (!dirStat.isDirectory()) continue;
      const files = await readdir(dirPath);
      const found = files.find(f => f.startsWith(fileId));
      if (found) return { path: join(dirPath, found), filename: found };
    }
  } catch { /* uploads dir may not exist */ }

  return null;
}

/**
 * Delete a file from the tmp/ directory only (pending uploads).
 * Returns true if deleted, false if not found.
 */
export async function deleteTmpFile(uploadsDir: string, fileId: string): Promise<boolean> {
  const tmpDir = join(uploadsDir, 'tmp');
  try {
    const tmpFiles = await readdir(tmpDir);
    const tmpFile = tmpFiles.find(f => f.startsWith(fileId));
    if (!tmpFile) return false;
    await unlink(join(tmpDir, tmpFile));
    return true;
  } catch {
    return false;
  }
}
