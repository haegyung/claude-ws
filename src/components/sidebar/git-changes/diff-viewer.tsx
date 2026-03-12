'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Loader2, X, FileCode, Plus, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useActiveProject } from '@/hooks/use-active-project';
import { useSidebarStore } from '@/stores/sidebar-store';
import type { GitDiff } from '@/types';
import {
  getLanguageFromPath,
  parseDiffText,
  type DiffLine,
} from './diff-syntax-highlight-utils';
import { DiffLineRenderer } from './diff-line-renderer';

interface DiffViewerProps {
  filePath: string;
  staged: boolean;
  onClose: () => void;
}

export function DiffViewer({ filePath, staged, onClose }: DiffViewerProps) {
  const activeProject = useActiveProject();
  const { openTab, setPendingEditorPosition } = useSidebarStore();
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeProject?.path) return;

    const fetchKey = `${filePath}:${staged}`;
    if (fetchedKeyRef.current === fetchKey) return;
    fetchedKeyRef.current = fetchKey;

    const fetchDiff = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          path: activeProject.path,
          file: filePath,
          staged: staged.toString(),
        });
        const res = await fetch(`/api/git/diff?${params}`);
        if (!res.ok) throw new Error('Failed to fetch diff');
        const data = await res.json();
        setDiff(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchDiff();
  }, [activeProject?.path, filePath, staged]);

  const fileName = filePath.split('/').pop() || filePath;
  const language = getLanguageFromPath(filePath);

  const parsedLines = useMemo(() => {
    if (!diff?.diff) return [];
    return parseDiffText(diff.diff);
  }, [diff?.diff]);

  const handleLineClick = (line: DiffLine) => {
    if (!line.lineNumber?.new && !line.lineNumber?.old) return;
    openTab(filePath);
    const lineNumber = line.lineNumber.new || line.lineNumber.old;
    if (lineNumber) {
      setPendingEditorPosition({ filePath, lineNumber, column: 0, matchLength: 0 });
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <FileCode className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium truncate" title={filePath}>
            {fileName}
          </span>
          <span className="text-xs text-muted-foreground">
            ({staged ? 'staged' : 'unstaged'})
          </span>
        </div>
        <div className="flex items-center gap-2">
          {diff && (
            <div className="flex items-center gap-2 text-xs">
              <span className="flex items-center gap-0.5 text-teal-600">
                <Plus className="size-3" />
                {diff.additions}
              </span>
              <span className="flex items-center gap-0.5 text-red-600">
                <Minus className="size-3" />
                {diff.deletions}
              </span>
            </div>
          )}
          <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-full text-destructive text-sm">
          {error}
        </div>
      ) : diff && diff.diff ? (
        <div className="flex-1 overflow-auto custom-scrollbar">
          <div className="font-mono text-xs min-w-max">
            {parsedLines.map((line, i) => (
              <DiffLineRenderer
                key={i}
                line={line}
                index={i}
                language={language}
                onLineClick={handleLineClick}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          No changes to display
        </div>
      )}
    </div>
  );
}
