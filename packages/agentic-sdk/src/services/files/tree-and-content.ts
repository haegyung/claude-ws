/**
 * File tree and content service - recursive directory tree listing with git status overlay,
 * file content reading with language/binary detection, and secure file writing.
 * Self-contained: no Next.js or @/ imports.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

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

export interface FileContentResult {
  content: string | null;
  language: string | null;
  size: number;
  isBinary: boolean;
  mimeType: string;
  mtime: number;
}

interface GitStatusResult {
  fileStatus: Map<string, GitFileStatusCode>;
  untrackedDirs: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Language mapping by extension (must match CodeMirror language keys)
const LANGUAGE_MAP: Record<string, string | null> = {
  '.js': 'javascript', '.jsx': 'jsx', '.ts': 'typescript', '.tsx': 'tsx',
  '.mjs': 'javascript', '.cjs': 'javascript',
  '.html': 'html', '.htm': 'html', '.css': 'css', '.scss': 'css',
  '.sass': 'css', '.less': 'css',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.xml': 'xml',
  '.toml': null, '.env': null, '.gitignore': null, '.dockerignore': null,
  '.md': 'markdown', '.mdx': 'markdown',
  '.sh': null, '.bash': null, '.zsh': null,
  '.py': 'python', '.go': null, '.rs': 'rust', '.sql': 'sql',
  '.php': 'php', '.java': 'java',
  '.c': 'cpp', '.cpp': 'cpp', '.cc': 'cpp', '.h': 'cpp', '.hpp': 'cpp',
  '.txt': null, '.log': null,
};

const BINARY_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.zip', '.tar', '.gz', '.rar',
  '.exe', '.dll', '.so', '.dylib',
  '.woff', '.woff2', '.ttf', '.eot',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
];

const EXCLUDED_DIRS = ['node_modules', '.git', '.next', 'dist', 'build', '.turbo'];
const EXCLUDED_FILES = ['.DS_Store', 'Thumbs.db'];

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Canonical MIME type mapping (self-contained, no @/ imports)
// ---------------------------------------------------------------------------

const CONTENT_TYPE_MAP: Record<string, string> = {
  json: 'application/json', xml: 'application/xml', yaml: 'text/yaml',
  yml: 'text/yaml', csv: 'text/csv', txt: 'text/plain',
  html: 'text/html', htm: 'text/html', css: 'text/css',
  js: 'application/javascript', jsx: 'application/javascript',
  mjs: 'application/javascript', cjs: 'application/javascript',
  ts: 'application/typescript', tsx: 'application/typescript',
  md: 'text/markdown', mdx: 'text/markdown',
  scss: 'text/css', sass: 'text/css', less: 'text/css',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword', pdf: 'application/pdf',
  zip: 'application/zip', tar: 'application/x-tar', gz: 'application/gzip',
  rar: 'application/vnd.rar',
  exe: 'application/vnd.microsoft.portable-executable',
  dll: 'application/vnd.microsoft.portable-executable',
  so: 'application/octet-stream', dylib: 'application/octet-stream',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
  ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2',
  ttf: 'font/ttf', eot: 'application/vnd.ms-fontobject',
  mp4: 'video/mp4', webm: 'video/webm', avi: 'video/x-msvideo',
  mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav',
};

function getContentTypeForExtension(ext: string): string {
  const key = (ext.startsWith('.') ? ext.slice(1) : ext).toLowerCase();
  return CONTENT_TYPE_MAP[key] || 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectLanguage(filePath: string): string | null {
  const fileName = path.basename(filePath);
  const specialFiles: Record<string, string | null> = {
    'Dockerfile': null, 'Makefile': null,
    '.eslintrc': 'json', '.prettierrc': 'json',
    'tsconfig.json': 'json', 'package.json': 'json',
  };
  return specialFiles[fileName] !== undefined ? specialFiles[fileName] : null;
}

async function getGitStatusMap(cwd: string): Promise<GitStatusResult> {
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

function buildFileTree(
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

export function createFileTreeAndContentService() {
  return {
    /**
     * Build a recursive file tree for the given directory with git status overlay.
     */
    async listDirectoryTree(
      basePath: string,
      opts?: { depth?: number; showHidden?: boolean }
    ): Promise<FileTreeResult> {
      const resolvedPath = path.resolve(basePath);
      if (!fs.existsSync(resolvedPath)) throw new Error('Path does not exist');
      const stats = fs.statSync(resolvedPath);
      if (!stats.isDirectory()) throw new Error('Path is not a directory');
      const depth = opts?.depth ?? 10;
      const showHidden = opts?.showHidden ?? true;
      const gitStatus = await getGitStatusMap(resolvedPath);
      const entries = buildFileTree(resolvedPath, resolvedPath, depth, showHidden, gitStatus);
      return { entries, basePath: resolvedPath };
    },

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
