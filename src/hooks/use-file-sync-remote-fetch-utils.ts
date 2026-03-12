/**
 * Remote file fetch utilities for useFileSync hook.
 *
 * Provides lightweight metadata (mtime-only) and full content fetching
 * from the file API, used by the polling loop in useFileSync.
 */

import { useCallback } from 'react';
import { createLogger } from '@/lib/logger';

const log = createLogger('FileSyncRemoteFetch');

/**
 * Hook that returns fetch helpers scoped to a specific filePath + basePath.
 * Both helpers are memoised with useCallback so callers get stable references.
 */
export function useFileSyncRemoteFetch(
  filePath: string | null,
  basePath: string | null,
) {
  /**
   * Lightweight metadata check — fetches only mtime to avoid downloading the
   * full file content on every polling tick.
   */
  const fetchRemoteMetadata = useCallback(
    async (): Promise<{ mtime: number | null } | null> => {
      if (!filePath || !basePath) return null;

      try {
        const res = await fetch(
          `/api/files/metadata?basePath=${encodeURIComponent(basePath)}&path=${encodeURIComponent(filePath)}`
        );

        if (!res.ok) return null;

        const data = await res.json();
        return { mtime: data.mtime ?? null };
      } catch (error) {
        log.error({ error, filePath }, 'Error fetching remote metadata');
        return null;
      }
    },
    [filePath, basePath]
  );

  /**
   * Full content fetch — called only after mtime indicates the file changed.
   */
  const fetchRemoteContent = useCallback(
    async (): Promise<{ content: string | null; mtime: number | null }> => {
      if (!filePath || !basePath) return { content: null, mtime: null };

      try {
        const res = await fetch(
          `/api/files/content?basePath=${encodeURIComponent(basePath)}&path=${encodeURIComponent(filePath)}`
        );

        if (!res.ok) return { content: null, mtime: null };

        const data = await res.json();
        if (data.isBinary || data.content === null) {
          return { content: null, mtime: data.mtime ?? null };
        }

        return { content: data.content, mtime: data.mtime ?? null };
      } catch (error) {
        log.error({ error, filePath }, 'Error fetching remote content');
        return { content: null, mtime: null };
      }
    },
    [filePath, basePath]
  );

  return { fetchRemoteMetadata, fetchRemoteContent };
}
