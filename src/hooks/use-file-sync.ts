/**
 * File Sync Hook - Polls file system for changes and detects conflicts
 *
 * Monitors the currently open file every 10 seconds to detect external changes.
 * When changes are detected, triggers a callback with the remote content for
 * diff resolution.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useFileSyncRemoteFetch } from '@/hooks/use-file-sync-remote-fetch-utils';
import { useFileSyncCheckNow, useFileSyncPolling } from '@/hooks/use-file-sync-change-check-and-polling';

export interface FileSyncState {
  /** Whether a sync conflict is detected */
  hasConflict: boolean;
  /** Remote (disk) content when conflict detected */
  remoteContent: string | null;
  /** Timestamp when remote content was last fetched */
  lastSyncedAt: number | null;
  /** Whether currently polling */
  isPolling: boolean;
  /** Last known remote file modification time */
  lastKnownMtime: number | null;
}

export interface UseFileSyncOptions {
  /** File path to monitor (relative to basePath) */
  filePath: string | null;
  /** Base project path */
  basePath: string | null;
  /** Current content in the editor */
  currentContent: string;
  /** Original content when file was loaded */
  originalContent: string;
  /** Polling interval in milliseconds (default: 10000) */
  pollInterval?: number;
  /** Whether sync is enabled (default: true) */
  enabled?: boolean;
  /** Callback when file changes are detected AND local has unsaved changes (shows conflict modal) */
  onRemoteChange?: (remoteContent: string) => void;
  /** Callback when file changes are detected AND no local changes (silent auto-update) */
  onSilentUpdate?: (remoteContent: string) => void;
}

export function useFileSync({
  filePath,
  basePath,
  currentContent,
  originalContent,
  pollInterval = 10000,
  enabled = true,
  onRemoteChange,
  onSilentUpdate,
}: UseFileSyncOptions): FileSyncState & {
  /** Clear the current conflict state */
  clearConflict: () => void;
  /** Manually trigger a sync check */
  checkNow: () => Promise<void>;
  /** Accept remote content (updates original to remote) */
  acceptRemote: () => void;
  /** Keep local content (dismisses conflict) */
  keepLocal: () => void;
} {
  const [state, setState] = useState<FileSyncState>({
    hasConflict: false,
    remoteContent: null,
    lastSyncedAt: null,
    isPolling: false,
    lastKnownMtime: null,
  });

  // Refs to access latest values in interval callback
  const currentContentRef = useRef(currentContent);
  const originalContentRef = useRef(originalContent);
  const lastKnownRemoteRef = useRef<string | null>(null);
  const lastKnownMtimeRef = useRef<number | null>(null);
  const isCheckingRef = useRef(false); // Prevent duplicate concurrent checks

  useEffect(() => {
    currentContentRef.current = currentContent;
  }, [currentContent]);

  useEffect(() => {
    originalContentRef.current = originalContent;
    // When original content changes (file reloaded), update last known remote
    lastKnownRemoteRef.current = originalContent;
  }, [originalContent]);

  // Remote fetch helpers (metadata-only and full content)
  const { fetchRemoteMetadata, fetchRemoteContent } = useFileSyncRemoteFetch(filePath, basePath);

  // Single sync-cycle callback
  const checkNow = useFileSyncCheckNow({
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
  });

  // Clear conflict state
  const clearConflict = useCallback(() => {
    setState(prev => ({
      ...prev,
      hasConflict: false,
      remoteContent: null,
    }));
  }, []);

  // Accept remote content
  const acceptRemote = useCallback(() => {
    if (state.remoteContent !== null) {
      lastKnownRemoteRef.current = state.remoteContent;
      lastKnownMtimeRef.current = state.lastKnownMtime;
    }
    clearConflict();
  }, [state.remoteContent, state.lastKnownMtime, clearConflict]);

  // Keep local content (dismiss conflict)
  const keepLocal = useCallback(() => {
    // Update last known remote to current content to avoid re-triggering
    lastKnownRemoteRef.current = currentContentRef.current;
    // Don't update mtime - keep tracking remote mtime for future checks
    clearConflict();
  }, [clearConflict]);

  // Reset state when file changes
  useEffect(() => {
    setState({
      hasConflict: false,
      remoteContent: null,
      lastSyncedAt: null,
      isPolling: false,
      lastKnownMtime: null,
    });
    lastKnownRemoteRef.current = null;
    lastKnownMtimeRef.current = null;
    isCheckingRef.current = false; // Reset check guard for new file
  }, [filePath]);

  // Recurring polling loop — uses a stable ref to avoid recreating on checkNow changes
  const checkNowRef = useRef(checkNow);
  checkNowRef.current = checkNow;

  useFileSyncPolling({ enabled, filePath, basePath, pollInterval, checkNowRef });

  return {
    ...state,
    clearConflict,
    checkNow,
    acceptRemote,
    keepLocal,
  };
}
