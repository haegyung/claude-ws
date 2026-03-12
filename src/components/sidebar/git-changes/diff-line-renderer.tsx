'use client';

/**
 * Renders a single parsed diff line with syntax highlighting, line numbers,
 * and optional click-to-navigate support. Used by diff-viewer and commit-file-diff-viewer.
 */

import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { highlightCode, type DiffLine } from './diff-syntax-highlight-utils';

interface DiffLineRendererProps {
  line: DiffLine;
  index: number;
  language: string;
  /** Called when user clicks a navigable line (has line numbers). Optional. */
  onLineClick?: (line: DiffLine) => void;
}

export function DiffLineRenderer({ line, index, language, onLineClick }: DiffLineRendererProps) {
  const shouldHighlight =
    line.type === 'addition' || line.type === 'deletion' || line.type === 'context';
  const highlightedContent = shouldHighlight
    ? highlightCode(line.content, language)
    : line.content;
  const canClick = onLineClick && (line.lineNumber?.new || line.lineNumber?.old);

  return (
    <div
      key={index}
      className={cn(
        'flex group',
        line.type === 'addition' && 'bg-teal-500/15',
        line.type === 'deletion' && 'bg-red-500/15',
        line.type === 'header' && 'bg-muted/50 text-muted-foreground',
        line.type === 'hunk' && 'bg-blue-500/10 text-blue-600',
        canClick && 'hover:bg-accent/30 cursor-pointer'
      )}
      onClick={() => canClick && onLineClick?.(line)}
      title={
        canClick
          ? `Click to open file at line ${line.lineNumber?.new || line.lineNumber?.old}`
          : undefined
      }
    >
      {/* Line number column */}
      <div className="flex shrink-0 text-muted-foreground/60 select-none sticky left-0 bg-inherit z-10">
        <span className="w-10 text-right pr-1 border-r border-border/50 bg-background">
          {line.lineNumber?.new ?? line.lineNumber?.old ?? ''}
        </span>
      </div>

      {/* Line content */}
      <pre className="px-2 whitespace-pre">
        {line.type === 'addition' && (
          <span className="text-teal-700 dark:text-teal-400">+ </span>
        )}
        {line.type === 'deletion' && (
          <span className="text-red-700 dark:text-red-400">- </span>
        )}
        {shouldHighlight ? (
          <span dangerouslySetInnerHTML={{ __html: highlightedContent }} />
        ) : (
          line.content
        )}
      </pre>

      {/* External link icon on hover (only when clickable) */}
      {canClick && (
        <ExternalLink className="size-3 opacity-0 group-hover:opacity-50 ml-auto shrink-0 self-center text-muted-foreground" />
      )}
    </div>
  );
}
