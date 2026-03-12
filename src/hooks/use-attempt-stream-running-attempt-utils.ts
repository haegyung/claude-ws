'use client';

/**
 * Running-attempt recovery and interrupt utilities for useAttemptStream.
 *
 * Provides:
 *  - useCheckRunningAttempt  — on mount / taskId change, polls the API for an
 *    in-progress attempt and restores state (messages, prompt, question).
 *  - useInterruptAndSend     — cancels the current attempt (with a timeout
 *    fallback) then immediately starts a new one.
 */

import { useEffect, useCallback, type RefObject } from 'react';
import type { Socket } from 'socket.io-client';
import type { ClaudeOutput } from '@/types';
import { useRunningTasksStore } from '@/stores/running-tasks-store';
import type { ActiveQuestion } from '@/hooks/use-attempt-questions';

// ---------------------------------------------------------------------------
// useCheckRunningAttempt
// ---------------------------------------------------------------------------

interface UseCheckRunningAttemptOptions {
  taskId: string | undefined;
  socketRef: RefObject<Socket | null>;
  currentAttemptIdRef: RefObject<string | null>;
  currentTaskIdRef: RefObject<string | null>;
  setCurrentAttemptId: (id: string | null) => void;
  setCurrentPrompt: (prompt: string | null) => void;
  setMessages: (msgs: ClaudeOutput[]) => void;
  setIsRunning: (running: boolean) => void;
  fetchPendingQuestion: (attemptId: string, signal: AbortSignal) => Promise<void>;
  fetchPersistentQuestion: (taskId: string, signal: AbortSignal) => Promise<void>;
}

/**
 * On mount and whenever taskId changes, fetches the running attempt from the
 * API and restores messages / prompt / question state so the UI re-connects
 * to an already-running agent.
 */
export function useCheckRunningAttempt({
  taskId,
  socketRef,
  currentAttemptIdRef,
  currentTaskIdRef,
  setCurrentAttemptId,
  setCurrentPrompt,
  setMessages,
  setIsRunning,
  fetchPendingQuestion,
  fetchPersistentQuestion,
}: UseCheckRunningAttemptOptions) {
  const { addRunningTask } = useRunningTasksStore();

  useEffect(() => {
    if (!taskId) return;

    const abortController = new AbortController();

    const checkRunningAttempt = async () => {
      try {
        console.log('[checkRunningAttempt] Checking for running attempt, taskId:', taskId);
        const res = await fetch(`/api/tasks/${taskId}/running-attempt`, {
          cache: 'no-store',
          signal: abortController.signal,
        });

        if (!res.ok) {
          console.log('[checkRunningAttempt] No running attempt (HTTP', res.status, ')');
          return;
        }

        const data = await res.json();
        if (abortController.signal.aborted) return;

        console.log('[checkRunningAttempt] Response:', {
          attemptId: data.attempt?.id,
          status: data.attempt?.status,
          messageCount: data.messages?.length,
        });

        if (data.attempt && data.attempt.status === 'running') {
          currentTaskIdRef.current = taskId;
          currentAttemptIdRef.current = data.attempt.id;
          setCurrentAttemptId(data.attempt.id);
          setCurrentPrompt(data.attempt.prompt);

          const loadedMessages = (data.messages || []).map((m: any) => ({
            ...m,
            _attemptId: data.attempt.id,
            _msgId: Math.random().toString(36),
          }));
          setMessages(loadedMessages);
          setIsRunning(true);
          addRunningTask(taskId);

          if (socketRef.current?.connected) {
            socketRef.current.emit('attempt:subscribe', { attemptId: data.attempt.id });
          }

          console.log('[checkRunningAttempt] Fetching pending question for attempt:', data.attempt.id);
          await fetchPendingQuestion(data.attempt.id, abortController.signal);
        } else {
          currentTaskIdRef.current = taskId;
          await fetchPersistentQuestion(taskId, abortController.signal);
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        currentTaskIdRef.current = taskId;
      }
    };

    checkRunningAttempt();
    return () => abortController.abort();
  }, [taskId, fetchPendingQuestion]);
}

// ---------------------------------------------------------------------------
// useInterruptAndSend
// ---------------------------------------------------------------------------

interface UseInterruptAndSendOptions {
  isConnected: boolean;
  socketRef: RefObject<Socket | null>;
  currentAttemptIdRef: RefObject<string | null>;
  currentTaskIdRef: RefObject<string | null>;
  setIsRunning: (running: boolean) => void;
  setActiveQuestion: (q: ActiveQuestion | null) => void;
  startAttempt: (
    taskId: string,
    prompt: string,
    displayPrompt?: string,
    fileIds?: string[],
    model?: string
  ) => void;
}

/**
 * Returns an `interruptAndSend` callback that cancels the current attempt
 * (waiting up to 3 s for confirmation) and then starts a new one.
 */
export function useInterruptAndSend({
  isConnected,
  socketRef,
  currentAttemptIdRef,
  currentTaskIdRef,
  setIsRunning,
  setActiveQuestion,
  startAttempt,
}: UseInterruptAndSendOptions) {
  const { removeRunningTask } = useRunningTasksStore();

  const interruptAndSend = useCallback(
    async (
      taskId: string,
      prompt: string,
      displayPrompt?: string,
      fileIds?: string[],
      model?: string
    ) => {
      const socket = socketRef.current;
      if (!socket || !isConnected) return;

      const attemptToCancel = currentAttemptIdRef.current;

      if (attemptToCancel) {
        await new Promise<void>((resolve) => {
          const handler = (data: { attemptId: string }) => {
            if (data.attemptId === attemptToCancel) {
              clearTimeout(timeout);
              socket.off('attempt:finished', handler);
              resolve();
            }
          };
          const timeout = setTimeout(() => {
            socket.off('attempt:finished', handler);
            resolve();
          }, 3000);
          socket.on('attempt:finished', handler);
          socket.emit('attempt:cancel', { attemptId: attemptToCancel });
        });
      }

      setIsRunning(false);
      setActiveQuestion(null);
      if (currentTaskIdRef.current) removeRunningTask(currentTaskIdRef.current);

      startAttempt(taskId, prompt, displayPrompt, fileIds, model);
    },
    [isConnected, startAttempt]
  );

  return { interruptAndSend };
}
