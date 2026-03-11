/**
 * File content read/write service - secure file reading with binary/language detection
 * and secure file writing with path traversal protection.
 * Self-contained: no Next.js or @/ imports.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  LANGUAGE_MAP,
  BINARY_EXTENSIONS,
  MAX_FILE_SIZE,
  getContentTypeForExtension,
  detectLanguage,
} from './mime-and-language-constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileContentResult {
  content: string | null;
  language: string | null;
  size: number;
  isBinary: boolean;
  mimeType: string;
  mtime: number;
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createFileContentReadWriteService() {
  return {
    /**
     * Read file content with security checks, binary detection, and language detection.
     * Throws descriptive errors for caller to map to HTTP status codes.
     */
    getFileContentSync(basePath: string, filePath: string): FileContentResult {
      const fullPath = path.resolve(basePath, filePath);
      const normalizedBase = path.resolve(basePath);
      const home = os.homedir();
      if (!normalizedBase.startsWith(home + path.sep) && normalizedBase !== home) {
        throw new Error('Access denied: base path outside home directory');
      }
      if (!fullPath.startsWith(normalizedBase)) {
        throw new Error('Invalid path: directory traversal detected');
      }
      if (!fs.existsSync(fullPath)) throw new Error('File not found');
      const stats = fs.statSync(fullPath);
      if (!stats.isFile()) throw new Error('Path is not a file');
      if (stats.size > MAX_FILE_SIZE) throw new Error('File too large');
      const ext = path.extname(fullPath).toLowerCase();
      const mtimeMs = stats.mtimeMs;
      if (BINARY_EXTENSIONS.includes(ext)) {
        return { content: null, language: null, size: stats.size, isBinary: true, mimeType: getContentTypeForExtension(ext), mtime: mtimeMs };
      }
      const content = fs.readFileSync(fullPath, 'utf-8');
      const language = LANGUAGE_MAP[ext] !== undefined ? LANGUAGE_MAP[ext] : detectLanguage(fullPath);
      return { content, language, size: stats.size, isBinary: false, mimeType: getContentTypeForExtension(ext), mtime: mtimeMs };
    },

    /**
     * Write text content to an existing file with security checks.
     * Does not allow creating new files or writing to binary files.
     * Throws descriptive errors for caller to map to HTTP status codes.
     */
    saveFileContentSync(basePath: string, filePath: string, content: string): { success: boolean; size: number } {
      const fullPath = path.resolve(basePath, filePath);
      const normalizedBase = path.resolve(basePath);
      const home = os.homedir();
      if (!normalizedBase.startsWith(home + path.sep) && normalizedBase !== home) {
        throw new Error('Access denied: base path outside home directory');
      }
      if (!fullPath.startsWith(normalizedBase)) {
        throw new Error('Invalid path: directory traversal detected');
      }
      if (!fs.existsSync(fullPath)) throw new Error('File not found');
      const stats = fs.statSync(fullPath);
      if (!stats.isFile()) throw new Error('Path is not a file');
      const ext = path.extname(fullPath).toLowerCase();
      if (BINARY_EXTENSIONS.includes(ext)) throw new Error('Cannot write to binary files');
      fs.writeFileSync(fullPath, content, 'utf-8');
      const newStats = fs.statSync(fullPath);
      return { success: true, size: newStats.size };
    },

    isBinaryExtension(ext: string): boolean {
      return BINARY_EXTENSIONS.includes(ext);
    },

    getLanguageForFile(filePath: string): string | null {
      const ext = path.extname(filePath).toLowerCase();
      return LANGUAGE_MAP[ext] !== undefined ? LANGUAGE_MAP[ext] : detectLanguage(filePath);
    },

    getContentType(ext: string): string {
      return getContentTypeForExtension(ext);
    },
  };
}
