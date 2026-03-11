/**
 * Filesystem service - safe read/write/delete operations within a project path with path-traversal protection
 */
import fs from 'fs/promises';
import path from 'path';

function resolveSafe(projectPath: string, filePath: string): string {
  const resolved = path.resolve(projectPath, filePath);
  if (!resolved.startsWith(path.resolve(projectPath))) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }
  return resolved;
}

export function createFileService() {
  return {
    async listFiles(projectPath: string, subPath?: string) {
      const dir = subPath ? resolveSafe(projectPath, subPath) : path.resolve(projectPath);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        path: path.join(subPath || '', e.name),
      }));
    },

    async getFileContent(projectPath: string, filePath: string) {
      const resolved = resolveSafe(projectPath, filePath);
      return fs.readFile(resolved, 'utf-8');
    },

    async writeFile(projectPath: string, filePath: string, content: string) {
      const resolved = resolveSafe(projectPath, filePath);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, content, 'utf-8');
    },

    async deleteFile(projectPath: string, filePath: string) {
      const resolved = resolveSafe(projectPath, filePath);
      await fs.unlink(resolved);
    },
  };
}
