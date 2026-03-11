/**
 * File tree builder service - recursive directory listing with git status overlay.
 * Self-contained: no Next.js or @/ imports.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { EXCLUDED_DIRS, EXCLUDED_FILES } from './mime-and-language-constants';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GitFileStatusCode = 'M' | 'A' | 'D' | 'R' | 'U';

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileEntry[];
  gitStatus?: GitFileStatusCode;
}

export interface FileTreeResult {
  entries: FileEntry[];
  basePath: string;
}

interface GitStatusResult {
  fileStatus: Map<string, GitFileStatusCode>;
  untrackedDirs: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export async function getGitStatusMap(cwd: string): Promise<GitStatusResult> {
  const fileStatus = new Map<string, GitFileStatusCode>();
  const untrackedDirs: string[] = [];
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd, timeout: 5000 });
    for (const line of stdout.trim().split('\n')) {
      if (!line || line.length < 3) continue;
      const indexStatus = line[0];
      const worktreeStatus = line[1];
      let filePath = line.slice(3).trim();
      if (filePath.includes(' -> ')) filePath = filePath.split(' -> ')[1];
      if (indexStatus === '?' && worktreeStatus === '?') {
        if (filePath.endsWith('/')) untrackedDirs.push(filePath.slice(0, -1));
        else fileStatus.set(filePath, 'U');
        continue;
      }
      const status = indexStatus !== ' ' ? indexStatus : worktreeStatus;
      if (status === 'M' || status === 'A' || status === 'D' || status === 'R') {
        fileStatus.set(filePath, status as GitFileStatusCode);
      } else if (status === 'U') {
        fileStatus.set(filePath, 'U');
      } else {
        fileStatus.set(filePath, 'M');
      }
    }
  } catch {
    // Not a git repo or git command failed
  }
  return { fileStatus, untrackedDirs };
}

export function buildFileTree(
  dirPath: string, basePath: string, maxDepth: number,
  showHidden: boolean, gitStatus: GitStatusResult, currentDepth: number = 0
): FileEntry[] {
  if (currentDepth >= maxDepth) return [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const result: FileEntry[] = [];
    for (const entry of entries) {
      if (!showHidden && entry.name.startsWith('.')) continue;
      if (entry.isDirectory() && EXCLUDED_DIRS.includes(entry.name)) continue;
      if (entry.isFile() && EXCLUDED_FILES.includes(entry.name)) continue;
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(basePath, fullPath);
      if (entry.isDirectory()) {
        const children = buildFileTree(fullPath, basePath, maxDepth, showHidden, gitStatus, currentDepth + 1);
        result.push({
          name: entry.name, path: relativePath, type: 'directory',
          children: children.length > 0 ? children : undefined,
        });
      } else {
        let fileGitStatus = gitStatus.fileStatus.get(relativePath);
        if (!fileGitStatus) {
          const isInUntrackedDir = gitStatus.untrackedDirs.some(dir => relativePath.startsWith(dir + '/'));
          if (isInUntrackedDir) fileGitStatus = 'U';
        }
        result.push({ name: entry.name, path: relativePath, type: 'file', gitStatus: fileGitStatus });
      }
    }
    return result.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createFileTreeBuilderService() {
  return {
    /**
     * Build a recursive file tree for the given directory with git status overlay.
     * Enforces home-directory boundary check.
     */
    async listDirectoryTree(
      basePath: string,
      opts?: { depth?: number; showHidden?: boolean }
    ): Promise<FileTreeResult> {
      const resolvedPath = path.resolve(basePath);
      const home = os.homedir();
      if (!resolvedPath.startsWith(home + path.sep) && resolvedPath !== home) {
        throw new Error('Access denied: path outside home directory');
      }
      if (!fs.existsSync(resolvedPath)) throw new Error('Path does not exist');
      const stats = fs.statSync(resolvedPath);
      if (!stats.isDirectory()) throw new Error('Path is not a directory');
      const depth = opts?.depth ?? 10;
      const showHidden = opts?.showHidden ?? true;
      const gitStatus = await getGitStatusMap(resolvedPath);
      const entries = buildFileTree(resolvedPath, resolvedPath, depth, showHidden, gitStatus);
      return { entries, basePath: resolvedPath };
    },
  };
}
