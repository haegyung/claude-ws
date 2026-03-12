/**
 * Shared syntax highlighting utilities for diff viewers.
 * Used by diff-viewer.tsx and commit-file-diff-viewer.tsx.
 */

import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';

// Register supported languages once at module level
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('java', java);

/** Map file extension to highlight.js language identifier */
export function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    css: 'css', scss: 'css', html: 'html', json: 'json', md: 'markdown',
  };
  return langMap[ext] || 'typescript';
}

/** Highlight code using highlight.js; falls back to HTML-escaped plain text on error */
export function highlightCode(code: string, language: string): string {
  try {
    const result = hljs.highlight(code, { language, ignoreIllegals: true });
    return result.value;
  } catch {
    return code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

/** Parsed diff line with type and optional line numbers */
export interface DiffLine {
  type: 'addition' | 'deletion' | 'context' | 'header' | 'hunk';
  content: string;
  lineNumber?: { old?: number; new?: number };
}

/**
 * Parse raw git diff text into typed DiffLine array.
 * Handles extended headers (new file, deleted file, etc.).
 */
export function parseDiffText(rawDiff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLineNum = 0;
  let newLineNum = 0;

  for (const line of rawDiff.split('\n')) {
    if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file')
    ) {
      lines.push({ type: 'header', content: line });
    } else if (line.startsWith('---') || line.startsWith('+++')) {
      lines.push({ type: 'header', content: line });
    } else if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match) {
        oldLineNum = parseInt(match[1], 10);
        newLineNum = parseInt(match[2], 10);
      }
      lines.push({ type: 'hunk', content: line });
    } else if (line.startsWith('+')) {
      lines.push({ type: 'addition', content: line.slice(1), lineNumber: { new: newLineNum++ } });
    } else if (line.startsWith('-')) {
      lines.push({ type: 'deletion', content: line.slice(1), lineNumber: { old: oldLineNum++ } });
    } else {
      lines.push({
        type: 'context',
        content: line.startsWith(' ') ? line.slice(1) : line,
        lineNumber: { old: oldLineNum++, new: newLineNum++ },
      });
    }
  }

  return lines;
}
