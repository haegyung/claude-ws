'use client';

/**
 * Hook providing git stage, unstage, discard, and .gitignore file actions.
 * Extracted from use-git-actions.ts for focused responsibility.
 */

import { useCallback } from 'react';

interface UseGitStageUnstageDiscardActionsOptions {
  projectPath: string | undefined;
  t: (key: string, values?: Record<string, string>) => string;
  fetchStatus: (forceRefresh?: boolean) => Promise<void>;
  gitFetch: (url: string, method: string, body: Record<string, unknown>) => Promise<void>;
}

export function useGitStageUnstageDiscardActions({
  projectPath,
  t,
  fetchStatus,
  gitFetch,
}: UseGitStageUnstageDiscardActionsOptions) {
  const stageFile = useCallback(async (filePath: string) => {
    if (!projectPath) return;
    try {
      await gitFetch('/api/git/stage', 'POST', { projectPath, files: [filePath] });
      fetchStatus(true);
    } catch (err) {
      console.error('Failed to stage file:', err);
    }
  }, [projectPath, fetchStatus, gitFetch]);

  const unstageFile = useCallback(async (filePath: string) => {
    if (!projectPath) return;
    try {
      await gitFetch('/api/git/stage', 'DELETE', { projectPath, files: [filePath] });
      fetchStatus(true);
    } catch (err) {
      console.error('Failed to unstage file:', err);
    }
  }, [projectPath, fetchStatus, gitFetch]);

  const discardFile = useCallback(async (filePath: string) => {
    if (!projectPath) return;
    if (!confirm(t('discardChangesConfirm', { filePath }))) return;
    try {
      await gitFetch('/api/git/discard', 'POST', { projectPath, files: [filePath] });
      fetchStatus(true);
    } catch (err) {
      console.error('Failed to discard file:', err);
    }
  }, [projectPath, fetchStatus, gitFetch, t]);

  const stageAll = useCallback(async () => {
    if (!projectPath) return;
    try {
      await gitFetch('/api/git/stage', 'POST', { projectPath, all: true });
      fetchStatus(true);
    } catch (err) {
      console.error('Failed to stage all:', err);
    }
  }, [projectPath, fetchStatus, gitFetch]);

  const unstageAll = useCallback(async () => {
    if (!projectPath) return;
    try {
      await gitFetch('/api/git/stage', 'DELETE', { projectPath, all: true });
      fetchStatus(true);
    } catch (err) {
      console.error('Failed to unstage all:', err);
    }
  }, [projectPath, fetchStatus, gitFetch]);

  const discardAll = useCallback(async () => {
    if (!projectPath) return;
    if (!confirm(t('discardAllConfirm'))) return;
    try {
      await gitFetch('/api/git/discard', 'POST', { projectPath, all: true });
      fetchStatus(true);
    } catch (err) {
      console.error('Failed to discard all:', err);
    }
  }, [projectPath, fetchStatus, gitFetch, t]);

  const addToGitignore = useCallback(async (filePath: string) => {
    if (!projectPath) return;
    try {
      const res = await fetch('/api/git/gitignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, filePath }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('failedToAddGitignore'));
      }
      fetchStatus(true);
    } catch (err) {
      console.error('Failed to add to .gitignore:', err);
      alert(err instanceof Error ? err.message : t('failedToAddGitignore'));
    }
  }, [projectPath, fetchStatus, t]);

  return { stageFile, unstageFile, discardFile, stageAll, unstageAll, discardAll, addToGitignore };
}
