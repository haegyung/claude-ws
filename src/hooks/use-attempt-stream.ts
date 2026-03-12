'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { ClaudeOutput } from '@/types';
import { useRunningTasksStore } from '@/stores/running-tasks-store';
import { useAttemptSocket } from '@/hooks/use-attempt-socket';
import { useAttemptQuestions, type Question, type ActiveQuestion } from '@/hooks/use-attempt-questions';
import { useCheckRunningAttempt, useInterruptAndSend } from '@/hooks/use-attempt-stream-running-attempt-utils';

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

  // Check for running attempt on mount/taskId change
  useCheckRunningAttempt({
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
  });

  const cancelAttempt = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !currentAttemptId) return;
    socket.emit('attempt:cancel', { attemptId: currentAttemptId });
    setIsRunning(false);
    setActiveQuestion(null);
    if (currentTaskIdRef.current) removeRunningTask(currentTaskIdRef.current);
  }, [currentAttemptId]);

  // Interrupt current streaming and send a new message
  const { interruptAndSend } = useInterruptAndSend({
    isConnected,
    socketRef,
    currentAttemptIdRef,
    currentTaskIdRef,
    setIsRunning,
    setActiveQuestion,
    startAttempt,
  });

  return { messages, isConnected, startAttempt, cancelAttempt, interruptAndSend, currentAttemptId, currentPrompt, isRunning, activeQuestion, answerQuestion, cancelQuestion, refetchQuestion };
}
