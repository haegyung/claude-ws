'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { ClaudeOutput } from '@/types';
import { useRunningTasksStore } from '@/stores/running-tasks-store';
import { useAttemptSocket } from '@/hooks/use-attempt-socket';
import { useAttemptQuestions, type Question, type ActiveQuestion } from '@/hooks/use-attempt-questions';

export type { Question, QuestionOption, ActiveQuestion } from '@/hooks/use-attempt-questions';

interface UseAttemptStreamOptions {
  taskId?: string;
  onComplete?: (taskId: string) => void;
}

interface UseAttemptStreamResult {
  messages: ClaudeOutput[];
  isConnected: boolean;
  startAttempt: (taskId: string, prompt: string, displayPrompt?: string, fileIds?: string[], model?: string) => void;
  cancelAttempt: () => void;
  interruptAndSend: (taskId: string, prompt: string, displayPrompt?: string, fileIds?: string[], model?: string) => Promise<void>;
  currentAttemptId: string | null;
  currentPrompt: string | null;
  isRunning: boolean;
  activeQuestion: ActiveQuestion | null;
  answerQuestion: (questions: Question[], answers: Record<string, string>) => void;
  cancelQuestion: () => void;
  refetchQuestion: () => Promise<void>;
}

export function useAttemptStream(
  options?: UseAttemptStreamOptions
): UseAttemptStreamResult {
  const taskId = options?.taskId;
  const onCompleteRef = useRef(options?.onComplete);
  const socketRef = useRef<Socket | null>(null);
  const currentTaskIdRef = useRef<string | null>(null);
  // CRITICAL: Use ref to track currentAttemptId for synchronous filtering in socket callbacks
  // State is async and cannot be used to filter messages in real-time
  const currentAttemptIdRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<ClaudeOutput[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [currentAttemptId, setCurrentAttemptId] = useState<string | null>(null);
  const [currentPrompt, setCurrentPrompt] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState<ActiveQuestion | null>(null);
  const { addRunningTask, removeRunningTask } = useRunningTasksStore();

  // Keep callback ref updated
  onCompleteRef.current = options?.onComplete;

  // Socket connection and event listeners
  useAttemptSocket({
    taskId,
    socketRef,
    currentAttemptIdRef,
    currentTaskIdRef,
    onCompleteRef,
    setMessages,
    setIsConnected,
    setCurrentAttemptId,
    setIsRunning,
    setActiveQuestion,
  });

  // Question handling (fetch, answer, cancel)
  const {
    fetchPendingQuestion,
    fetchPersistentQuestion,
    refetchQuestion,
    answerQuestion,
    cancelQuestion,
  } = useAttemptQuestions({
    taskId,
    socketRef,
    currentAttemptIdRef,
    currentTaskIdRef,
    activeQuestion,
    setActiveQuestion,
    setIsRunning,
    setMessages,
  });

  // Clear messages and reset state when taskId changes
  useEffect(() => {
    console.log('[useAttemptStream] taskId changed to:', taskId, '| prev attemptId:', currentAttemptIdRef.current);
    if (currentAttemptIdRef.current && socketRef.current) {
      socketRef.current.emit('attempt:unsubscribe', { attemptId: currentAttemptIdRef.current });
    }
    setMessages([]);
    setCurrentAttemptId(null);
    currentAttemptIdRef.current = null;
    setCurrentPrompt(null);
    setIsRunning(false);
    setActiveQuestion(null);
  }, [taskId]);

  // Ensure socket subscription when attempt ID and connection are both available
  useEffect(() => {
    if (isConnected && currentAttemptId && socketRef.current) {
      socketRef.current.emit('attempt:subscribe', { attemptId: currentAttemptId });
    }
  }, [isConnected, currentAttemptId]);

  // Check for running attempt on mount/taskId change
  useEffect(() => {
    if (!taskId) return;
    const abortController = new AbortController();
    const checkRunningAttempt = async () => {
      try {
        console.log('[checkRunningAttempt] Checking for running attempt, taskId:', taskId);
        const res = await fetch(`/api/tasks/${taskId}/running-attempt`, { cache: 'no-store', signal: abortController.signal });
        if (!res.ok) {
          console.log('[checkRunningAttempt] No running attempt (HTTP', res.status, ')');
          return;
        }
        const data = await res.json();
        if (abortController.signal.aborted) return;
        console.log('[checkRunningAttempt] Response:', { attemptId: data.attempt?.id, status: data.attempt?.status, messageCount: data.messages?.length });
        if (data.attempt && data.attempt.status === 'running') {
          currentTaskIdRef.current = taskId;
          currentAttemptIdRef.current = data.attempt.id;
          setCurrentAttemptId(data.attempt.id);
          setCurrentPrompt(data.attempt.prompt);
          const loadedMessages = (data.messages || []).map((m: any) => ({
            ...m,
            _attemptId: data.attempt.id,
            _msgId: Math.random().toString(36)
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

  const startAttempt = useCallback((taskId: string, prompt: string, displayPrompt?: string, fileIds?: string[], model?: string) => {
    const socket = socketRef.current;
    if (!socket || !isConnected) return;
    currentTaskIdRef.current = taskId;
    setCurrentPrompt(displayPrompt || prompt);
    setIsRunning(true);
    addRunningTask(taskId);
    socket.once('attempt:started', (data: any) => {
      currentAttemptIdRef.current = data.attemptId;
      setCurrentAttemptId(data.attemptId);
      setMessages([]);
      socket.emit('attempt:subscribe', { attemptId: data.attemptId });
    });
    socket.emit('attempt:start', { taskId, prompt, displayPrompt, fileIds, model });
  }, [isConnected]);

  const cancelAttempt = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !currentAttemptId) return;
    socket.emit('attempt:cancel', { attemptId: currentAttemptId });
    setIsRunning(false);
    setActiveQuestion(null);
    if (currentTaskIdRef.current) removeRunningTask(currentTaskIdRef.current);
  }, [currentAttemptId]);

  // Interrupt current streaming and send a new message
  const interruptAndSend = useCallback(async (
    taskId: string, prompt: string, displayPrompt?: string,
    fileIds?: string[], model?: string
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
  }, [isConnected, startAttempt]);

  return { messages, isConnected, startAttempt, cancelAttempt, interruptAndSend, currentAttemptId, currentPrompt, isRunning, activeQuestion, answerQuestion, cancelQuestion, refetchQuestion };
}
