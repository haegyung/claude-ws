'use client';

import { useCallback, useRef, type RefObject } from 'react';
import type { Socket } from 'socket.io-client';
import type { ClaudeOutput } from '@/types';
import { useRunningTasksStore } from '@/stores/running-tasks-store';
import { createLogger } from '@/lib/logger';

const log = createLogger('AttemptQuestionsHook');

// Question types for AskUserQuestion
export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface ActiveQuestion {
  attemptId: string;
  toolUseId: string;
  questions: Question[];
}

interface UseAttemptQuestionsOptions {
  taskId?: string;
  socketRef: RefObject<Socket | null>;
  currentAttemptIdRef: RefObject<string | null>;
  currentTaskIdRef: RefObject<string | null>;
  activeQuestion: ActiveQuestion | null;
  setActiveQuestion: (q: ActiveQuestion | null | ((prev: ActiveQuestion | null) => ActiveQuestion | null)) => void;
  setIsRunning: (running: boolean) => void;
  setMessages: (fn: (prev: ClaudeOutput[]) => ClaudeOutput[]) => void;
}

export function useAttemptQuestions({
  taskId,
  socketRef,
  currentAttemptIdRef,
  currentTaskIdRef,
  activeQuestion,
  setActiveQuestion,
  setIsRunning,
  setMessages,
}: UseAttemptQuestionsOptions) {
  const { addRunningTask } = useRunningTasksStore();
  const answeringRef = useRef(false);

  const fetchPendingQuestion = useCallback(async (attemptId: string, signal?: AbortSignal) => {
    try {
      console.log('[fetchPendingQuestion] Fetching for attempt:', attemptId);
      const res = await fetch(`/api/attempts/${attemptId}/pending-question`, { cache: 'no-store', signal });
      if (!res.ok) {
        console.log('[fetchPendingQuestion] Failed, HTTP', res.status);
        return;
      }
      const data = await res.json();
      console.log('[fetchPendingQuestion] Result:', data.question ? `Found (toolUseId: ${data.question.toolUseId})` : 'No pending question');
      if (data.question) {
        setActiveQuestion(data.question);
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      console.error('[fetchPendingQuestion] Error:', err);
    }
  }, []);

  const fetchPersistentQuestion = useCallback(async (taskIdParam: string, signal?: AbortSignal) => {
    try {
      console.log('[fetchPersistentQuestion] Fetching for task:', taskIdParam);
      const res = await fetch(`/api/tasks/${taskIdParam}/pending-question`, { cache: 'no-store', signal });
      if (!res.ok) return;
      const data = await res.json();
      console.log('[fetchPersistentQuestion] Result:', data.question ? `Found (toolUseId: ${data.question.toolUseId})` : 'No persistent question');
      if (data.question) {
        setActiveQuestion(data.question);
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      console.error('[fetchPersistentQuestion] Error:', err);
    }
  }, []);

  const refetchQuestion = useCallback(async () => {
    let attemptId = currentAttemptIdRef.current;

    if (!attemptId && taskId) {
      try {
        const res = await fetch(`/api/tasks/${taskId}/running-attempt`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.attempt?.status === 'running') {
            attemptId = data.attempt.id;
          }
        }
      } catch {
        // Fall through
      }
    }

    if (attemptId) {
      await fetchPendingQuestion(attemptId);
    } else if (taskId) {
      await fetchPersistentQuestion(taskId);
    }
  }, [fetchPendingQuestion, fetchPersistentQuestion, taskId]);

  const answerQuestion = useCallback(async (questions: Question[], answers: Record<string, string>) => {
    const socket = socketRef.current;
    if (!socket || !activeQuestion || answeringRef.current) return;
    answeringRef.current = true; // Prevent double-sends from React re-renders

    const attemptId = activeQuestion.attemptId;
    const answeredToolUseId = activeQuestion.toolUseId;

    setIsRunning(true);
    if (currentTaskIdRef.current) addRunningTask(currentTaskIdRef.current);

    socket.emit('question:answer', {
      attemptId,
      toolUseId: answeredToolUseId,
      questions,
      answers,
    });

    try {
      await fetch(`/api/attempts/${attemptId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions, answers })
      });
    } catch (err) {
      log.error({ err }, 'Failed to save answer to database');
    }

    const answerText = Object.entries(answers)
      .map(([question, answer]) => `${question}: **${answer}**`)
      .join('\n');
    setMessages((prev) => [
      ...prev,
      {
        type: 'assistant' as const,
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: `\u2713 **You answered:**\n${answerText}` }]
        },
        _attemptId: attemptId,
        _msgId: Math.random().toString(36)
      }
    ]);

    setActiveQuestion((prev) =>
      prev?.toolUseId === answeredToolUseId ? null : prev
    );
    answeringRef.current = false;
  }, [activeQuestion]);

  const cancelQuestion = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !activeQuestion) return;
    socket.emit('question:cancel', { attemptId: activeQuestion.attemptId });
    setActiveQuestion(null);
  }, [activeQuestion]);

  return {
    fetchPendingQuestion,
    fetchPersistentQuestion,
    refetchQuestion,
    answerQuestion,
    cancelQuestion,
  };
}
