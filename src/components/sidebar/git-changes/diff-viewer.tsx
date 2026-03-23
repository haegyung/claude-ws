'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, X, FileCode, Plus, Minus, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useActiveProject } from '@/hooks/use-active-project';
import { useSidebarStore } from '@/stores/sidebar-store';
import type { GitDiff } from '@/types';
import { PatchDiff } from '@pierre/diffs/react';
import { usePierreTheme } from '@/lib/pierre-theme-config';

function SplitViewIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 16 16" width="16" height="16" className={className}>
      <path d="M14 0H8.5v16H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2m-1.5 6.5v1h1a.5.5 0 0 1 0 1h-1v1a.5.5 0 0 1-1 0v-1h-1a.5.5 0 0 1 0-1h1v-1a.5.5 0 0 1 1 0" />
      <path d="M2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5.5V0zm.5 7.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1 0-1" opacity="0.3" />
    </svg>
  );
}

function StackedViewIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 16 16" width="16" height="16" className={className}>
      <path fillRule="evenodd" d="M16 14a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V8.5h16zm-8-4a.5.5 0 0 0-.5.5v1h-1a.5.5 0 0 0 0 1h1v1a.5.5 0 0 0 1 0v-1h1a.5.5 0 0 0 0-1h-1v-1A.5.5 0 0 0 8 10" clipRule="evenodd" />
      <path fillRule="evenodd" d="M14 0a2 2 0 0 1 2 2v5.5H0V2a2 2 0 0 1 2-2zM6.5 3.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1z" clipRule="evenodd" opacity="0.4" />
    </svg>
  );
}

interface DiffViewerProps {
  filePath: string;
  staged: boolean;
  onClose: () => void;
}

export function DiffViewer({ filePath, staged, onClose }: DiffViewerProps) {
  const activeProject = useActiveProject();
  const { openTab } = useSidebarStore();
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchedKeyRef = useRef<string | null>(null);
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified');
  const pierreTheme = usePierreTheme();

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

  const handleOpenInEditor = () => {
    openTab(filePath);
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
        <div className="flex items-center gap-1">
          {diff && (
            <div className="flex items-center gap-2 text-xs mr-1">
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
          <Button
            variant="ghost"
            size="icon"
            className={`size-7 ${diffStyle === 'split' ? 'text-foreground' : 'text-muted-foreground'}`}
            onClick={() => setDiffStyle('split')}
            title="Split view"
          >
            <SplitViewIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={`size-7 ${diffStyle === 'unified' ? 'text-foreground' : 'text-muted-foreground'}`}
            onClick={() => setDiffStyle('unified')}
            title="Unified view"
          >
            <StackedViewIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={handleOpenInEditor}
            title="Open in editor"
          >
            <ExternalLink className="size-3.5" />
          </Button>
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
          <PatchDiff
            patch={diff.diff}
            options={{
              ...pierreTheme,
              diffStyle,
              overflow: 'scroll',
              diffIndicators: 'bars',
              disableFileHeader: true,
              lineDiffType: 'word-alt',
            }}
          />
        </div>
      ) : (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          No changes to display
        </div>
      )}
    </div>
  );
}
