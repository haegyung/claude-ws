'use client';

/**
 * Socket event handler registration for the useInlineEdit hook.
 *
 * Registers and cleans up inline-edit:delta / inline-edit:complete /
 * inline-edit:error listeners on the shared socket, forwarding events to
 * the inline-edit store when the sessionId matches the active session.
 */

import { useEffect, type RefObject } from 'react';
import { getSocket } from '@/lib/socket-service';
import type { DiffResult } from '@/lib/diff-generator';
import { createLogger } from '@/lib/logger';

const log = createLogger('InlineEditSocketHandlers');

interface UseInlineEditSocketHandlersOptions {
  filePath: string;
  sessionIdRef: RefObject<string | null>;
  appendGeneratedCode: (filePath: string, chunk: string) => void;
  completeGeneration: (filePath: string, code: string, diff: DiffResult) => void;
  setError: (filePath: string, error: string) => void;
}

/**
 * Registers socket event listeners for the inline-edit session tied to
 * `filePath`. Cleans up on unmount or when `filePath` changes.
 */
export function useInlineEditSocketEventHandlers({
  filePath,
  sessionIdRef,
  appendGeneratedCode,
  completeGeneration,
  setError,
}: UseInlineEditSocketHandlersOptions) {
  useEffect(() => {
    const socket = getSocket();
    log.debug({ filePath, socketId: socket.id }, 'Setting up handlers');

    const handleDelta = (data: { sessionId: string; chunk: string }) => {
      log.debug({ sessionId: data.sessionId, expected: sessionIdRef.current }, 'Received delta');
      if (data.sessionId === sessionIdRef.current) {
        appendGeneratedCode(filePath, data.chunk);
      }
    };

    const handleComplete = (data: { sessionId: string; code: string; diff: DiffResult }) => {
      log.debug({ sessionId: data.sessionId, expected: sessionIdRef.current }, 'Received complete');
      if (data.sessionId === sessionIdRef.current) {
        log.debug('Calling completeGeneration');
        completeGeneration(filePath, data.code, data.diff);
      }
    };

    const handleError = (data: { sessionId: string; error: string }) => {
      log.debug(
        { sessionId: data.sessionId, expected: sessionIdRef.current, error: data.error },
        'Received error'
      );
      if (data.sessionId === sessionIdRef.current) {
        setError(filePath, data.error);
      }
    };

    socket.on('inline-edit:delta', handleDelta);
    socket.on('inline-edit:complete', handleComplete);
    socket.on('inline-edit:error', handleError);
    log.debug(
      { listenersCount: socket.listeners('inline-edit:complete').length },
      'Handlers registered'
    );

    return () => {
      log.debug({ filePath }, 'Removing handlers');
      socket.off('inline-edit:delta', handleDelta);
      socket.off('inline-edit:complete', handleComplete);
      socket.off('inline-edit:error', handleError);
    };
  }, [filePath, appendGeneratedCode, completeGeneration, setError]);
}
