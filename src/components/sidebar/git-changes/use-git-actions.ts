'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { GitStatus, GitFileStatus } from '@/types';
import { useGitStageUnstageDiscardActions } from './use-git-stage-unstage-discard-actions';
import { useGitSyncAndBranchCheckoutActions } from './use-git-sync-and-branch-checkout-actions';

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

  const stageActions = useGitStageUnstageDiscardActions({ projectPath, t, fetchStatus, gitFetch });
  const syncActions = useGitSyncAndBranchCheckoutActions({ projectPath, t, fetchStatus });

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
    syncing: syncActions.syncing,
    fetchStatus,
    ...stageActions,
    handleSync: syncActions.handleSync,
    handleBranchCheckout: syncActions.handleBranchCheckout,
  };
}
