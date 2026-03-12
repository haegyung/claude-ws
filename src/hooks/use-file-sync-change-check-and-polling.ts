/**
 * Change-check and polling logic for the useFileSync hook.
 *
 * Provides:
 *  - useFileSyncCheckNow  — memoised callback that performs a single
 *    mtime+content comparison and updates state accordingly.
 *  - useFileSyncPolling   — sets up the recurring setTimeout loop that
 *    calls checkNow on the configured interval.
 */

import { useEffect, useRef, useCallback, type Dispatch, type SetStateAction, type RefObject } from 'react';
import { createLogger } from '@/lib/logger';
import type { FileSyncState } from '@/hooks/use-file-sync';

const log = createLogger('FileSyncChangeCheck');

// ---------------------------------------------------------------------------
// Types shared between the two hooks below
// ---------------------------------------------------------------------------

interface FetchRemoteMetadata {
  (): Promise<{ mtime: number | null } | null>;
}

interface FetchRemoteContent {
  (): Promise<{ content: string | null; mtime: number | null }>;
}

// ---------------------------------------------------------------------------
// useFileSyncCheckNow
// ---------------------------------------------------------------------------

interface UseFileSyncCheckNowOptions {
  filePath: string | null;
  basePath: string | null;
  enabled: boolean;
  isCheckingRef: RefObject<boolean>;
  lastKnownMtimeRef: RefObject<number | null>;
  lastKnownRemoteRef: RefObject<string | null>;
  currentContentRef: RefObject<string>;
  originalContentRef: RefObject<string>;
  fetchRemoteMetadata: FetchRemoteMetadata;
  fetchRemoteContent: FetchRemoteContent;
  setState: Dispatch<SetStateAction<FileSyncState>>;
  onRemoteChange?: (remoteContent: string) => void;
  onSilentUpdate?: (remoteContent: string) => void;
}

/**
 * Returns a stable `checkNow` callback that performs one full sync cycle:
 * lightweight mtime check → optional full content fetch → state update.
 */
export function useFileSyncCheckNow({
  filePath,
  basePath,
  enabled,
  isCheckingRef,
  lastKnownMtimeRef,
  lastKnownRemoteRef,
  currentContentRef,
  originalContentRef,
  fetchRemoteMetadata,
  fetchRemoteContent,
  setState,
  onRemoteChange,
  onSilentUpdate,
}: UseFileSyncCheckNowOptions) {
  return useCallback(async () => {
    if (!filePath || !basePath || !enabled) return;

    if (isCheckingRef.current) {
      log.debug({ filePath }, 'Check already in progress, skipping');
      return;
    }

    isCheckingRef.current = true;
    setState(prev => ({ ...prev, isPolling: true }));

    try {
      // Step 1: Lightweight metadata check (only mtime)
      const metadata = await fetchRemoteMetadata();

      if (!metadata || metadata.mtime === null) {
        setState(prev => ({ ...prev, isPolling: false }));
        isCheckingRef.current = false;
        return;
      }

      const now = Date.now();
      const lastMtime = lastKnownMtimeRef.current;

      // Step 2: Skip content fetch if mtime unchanged
      if (lastMtime && metadata.mtime === lastMtime) {
        setState(prev => ({ ...prev, isPolling: false }));
        isCheckingRef.current = false;
        return;
      }

      // Step 3: mtime changed — fetch full content
      const result = await fetchRemoteContent();

      if (result.content === null) {
        setState(prev => ({ ...prev, isPolling: false }));
        isCheckingRef.current = false;
        return;
      }

      const { content: remoteContent, mtime } = result;
      lastKnownMtimeRef.current = mtime ?? null;

      const lastKnownRemote = lastKnownRemoteRef.current ?? originalContentRef.current;
      const remoteHasChanged = remoteContent !== lastKnownRemote;
      const localHasChanged = currentContentRef.current !== originalContentRef.current;

      if (remoteHasChanged) {
        lastKnownRemoteRef.current = remoteContent;

        if (localHasChanged) {
          log.debug({ filePath }, 'Conflict detected - remote and local both changed');
          setState({ hasConflict: true, remoteContent, lastSyncedAt: now, isPolling: false, lastKnownMtime: mtime });
          onRemoteChange?.(remoteContent);
        } else {
          log.debug({ filePath }, 'Remote changed, no local changes - auto-updating');
          setState({ hasConflict: false, remoteContent: null, lastSyncedAt: now, isPolling: false, lastKnownMtime: mtime });
          onSilentUpdate?.(remoteContent);
        }
      } else {
        setState(prev => ({ ...prev, lastSyncedAt: now, isPolling: false, lastKnownMtime: mtime }));
      }

      isCheckingRef.current = false;
    } catch (error) {
      log.error({ error, filePath }, 'Check failed');
      setState(prev => ({ ...prev, isPolling: false }));
      isCheckingRef.current = false;
    }
  }, [filePath, basePath, enabled, fetchRemoteMetadata, fetchRemoteContent, onRemoteChange, onSilentUpdate]);
}

// ---------------------------------------------------------------------------
// useFileSyncPolling
// ---------------------------------------------------------------------------

interface UseFileSyncPollingOptions {
  enabled: boolean;
  filePath: string | null;
  basePath: string | null;
  pollInterval: number;
  checkNowRef: RefObject<() => Promise<void>>;
}

/**
 * Sets up a recurring setTimeout loop that calls `checkNowRef.current()` at
 * the given interval. The ref avoids re-creating the loop when `checkNow`
 * changes due to dependency updates.
 */
export function useFileSyncPolling({
  enabled,
  filePath,
  basePath,
  pollInterval,
  checkNowRef,
}: UseFileSyncPollingOptions) {
  useEffect(() => {
    if (!enabled || !filePath || !basePath) return;

    const stableCheck = async () => { await checkNowRef.current(); };

    let timeoutId: NodeJS.Timeout | null = null;

    const scheduleNext = () => {
      timeoutId = setTimeout(() => {
        stableCheck().then(() => { scheduleNext(); });
      }, pollInterval);
    };

    // Initial check after a short delay, then recurring
    const initialTimer = setTimeout(() => {
      stableCheck().then(() => { scheduleNext(); });
    }, 1000);

    return () => {
      clearTimeout(initialTimer);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [enabled, filePath, basePath, pollInterval]);
}
