'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { GitStatus, GitFileStatus } from '@/types';

interface UseGitActionsOptions {
  projectPath: string | undefined;
  t: (key: string, values?: Record<string, string>) => string;
}

interface UseGitActionsReturn {
  status: GitStatus | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  changes: GitFileStatus[];
  syncing: boolean;
  fetchStatus: (forceRefresh?: boolean) => Promise<void>;
  stageFile: (filePath: string) => Promise<void>;
  unstageFile: (filePath: string) => Promise<void>;
  discardFile: (filePath: string) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageAll: () => Promise<void>;
  discardAll: () => Promise<void>;
  addToGitignore: (filePath: string) => Promise<void>;
  handleSync: () => Promise<void>;
  handleBranchCheckout: (branch: string) => Promise<void>;
}

export function useGitActions({ projectPath, t }: UseGitActionsOptions): UseGitActionsReturn {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);
  const isComponentMountedRef = useRef(true);
  const fetchedPathRef = useRef<string | null>(null);

  const fetchStatus = useCallback(async (forceRefresh = false) => {
    if (!projectPath) {
      setStatus(null);
      setLoading(false);
      fetchedPathRef.current = null;
      return;
    }

    if (!forceRefresh && fetchedPathRef.current === projectPath) return;
    if (!isComponentMountedRef.current) return;

    fetchedPathRef.current = projectPath;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/git/status?path=${encodeURIComponent(projectPath)}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch git status');
      }
      const data = await res.json();
      if (isComponentMountedRef.current) {
        setStatus(data);
        setLastUpdated(new Date());
      }
    } catch (err) {
      if (isComponentMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setStatus(null);
      }
    } finally {
      if (isComponentMountedRef.current) {
        setLoading(false);
      }
    }
  }, [projectPath]);

  useEffect(() => {
    isComponentMountedRef.current = true;
    fetchStatus();
    return () => {
      isComponentMountedRef.current = false;
    };
  }, [fetchStatus]);

  useEffect(() => {
    const handleFocus = () => { fetchStatus(); };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [fetchStatus]);

  const gitFetch = useCallback(async (url: string, method: string, body: Record<string, unknown>) => {
    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }, []);

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

  const handleSync = useCallback(async () => {
    if (!projectPath) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/git/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('failedToPush'));
      }
      fetchStatus(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : t('failedToPush'));
    } finally {
      setSyncing(false);
    }
  }, [projectPath, fetchStatus, t]);

  const handleBranchCheckout = useCallback(async (branch: string) => {
    if (!projectPath) return;
    const res = await fetch('/api/git/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath, commitish: branch }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to checkout branch');
    }
    await fetchStatus(true);
  }, [projectPath, fetchStatus]);

  const changes: GitFileStatus[] = useMemo(() => {
    if (!status) return [];
    return [...(status.unstaged || []), ...(status.untracked || [])];
  }, [status]);

  return {
    status,
    loading,
    error,
    lastUpdated,
    changes,
    syncing,
    fetchStatus,
    stageFile,
    unstageFile,
    discardFile,
    stageAll,
    unstageAll,
    discardAll,
    addToGitignore,
    handleSync,
    handleBranchCheckout,
  };
}
