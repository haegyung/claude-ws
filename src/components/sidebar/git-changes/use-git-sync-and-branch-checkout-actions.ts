'use client';

/**
 * Hook providing git push/sync and branch checkout actions.
 * Extracted from use-git-actions.ts for focused responsibility.
 */

import { useState, useCallback } from 'react';

interface UseGitSyncAndBranchCheckoutActionsOptions {
  projectPath: string | undefined;
  t: (key: string, values?: Record<string, string>) => string;
  fetchStatus: (forceRefresh?: boolean) => Promise<void>;
}

export function useGitSyncAndBranchCheckoutActions({
  projectPath,
  t,
  fetchStatus,
}: UseGitSyncAndBranchCheckoutActionsOptions) {
  const [syncing, setSyncing] = useState(false);

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

  return { syncing, handleSync, handleBranchCheckout };
}
