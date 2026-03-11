/**
 * File MIME type and language detection constants and helpers.
 * Self-contained: no Next.js or @/ imports.
 */
import path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Language mapping by extension (must match CodeMirror language keys)
export const LANGUAGE_MAP: Record<string, string | null> = {
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

export const BINARY_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.zip', '.tar', '.gz', '.rar',
  '.exe', '.dll', '.so', '.dylib',
  '.woff', '.woff2', '.ttf', '.eot',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
];

export const EXCLUDED_DIRS = ['node_modules', '.git', '.next', 'dist', 'build', '.turbo'];
export const EXCLUDED_FILES = ['.DS_Store', 'Thumbs.db'];

// Max file size: 10MB
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Canonical MIME type mapping (self-contained, no @/ imports)
export const CONTENT_TYPE_MAP: Record<string, string> = {
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

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

export function getContentTypeForExtension(ext: string): string {
  const key = (ext.startsWith('.') ? ext.slice(1) : ext).toLowerCase();
  return CONTENT_TYPE_MAP[key] || 'application/octet-stream';
}

export function detectLanguage(filePath: string): string | null {
  const fileName = path.basename(filePath);
  const specialFiles: Record<string, string | null> = {
    'Dockerfile': null, 'Makefile': null,
    '.eslintrc': 'json', '.prettierrc': 'json',
    'tsconfig.json': 'json', 'package.json': 'json',
  };
  return specialFiles[fileName] !== undefined ? specialFiles[fileName] : null;
}
