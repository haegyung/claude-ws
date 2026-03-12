'use client';

import { useEffect, type RefObject } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ClaudeOutput, WsAttemptFinished } from '@/types';
import { useRunningTasksStore } from '@/stores/running-tasks-store';
import { useQuestionsStore } from '@/stores/questions-store';
import { useWorkflowStore } from '@/stores/workflow-store';
import { createLogger } from '@/lib/logger';
import type { ActiveQuestion } from '@/hooks/use-attempt-questions';
import { registerOutputHandler } from '@/hooks/use-attempt-socket-output-handler';

const log = createLogger('AttemptSocketHook');

interface UseAttemptSocketOptions {
  taskId?: string;
  socketRef: RefObject<Socket | null>;
  currentAttemptIdRef: RefObject<string | null>;
  currentTaskIdRef: RefObject<string | null>;
  onCompleteRef: RefObject<((taskId: string) => void) | undefined>;
  setMessages: (fn: (prev: ClaudeOutput[]) => ClaudeOutput[]) => void;
  setIsConnected: (connected: boolean) => void;
  setCurrentAttemptId: (id: string | null | ((prev: string | null) => string | null)) => void;
  setIsRunning: (running: boolean) => void;
  setActiveQuestion: (q: ActiveQuestion | null) => void;
}

export function useAttemptSocket({
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
}: UseAttemptSocketOptions) {
  const { addRunningTask, removeRunningTask, markTaskCompleted } = useRunningTasksStore();

  // Initialize socket connection and register all event listeners
  useEffect(() => {
    const socketInstance = io({
      reconnection: true,
      reconnectionDelay: 1000,
    });

    socketRef.current = socketInstance;

    socketInstance.on('connect', () => {
      setIsConnected(true);
      setCurrentAttemptId((currentId) => {
        if (currentId) {
          socketInstance.emit('attempt:subscribe', { attemptId: currentId });
          fetch(`/api/attempts/${currentId}/pending-question`, { cache: 'no-store' })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
              if (data?.question) {
                log.debug({ question: data.question }, 'Recovered pending question on reconnect');
                setActiveQuestion(data.question);
              }
            })
            .catch(() => {});
        }
        return currentId;
      });
    });

    socketInstance.on('disconnect', () => {
      setIsConnected(false);
    });

    socketInstance.on('task:started', (data: { taskId: string }) => {
      addRunningTask(data.taskId);
    });

    socketInstance.on('task:finished', (data: { taskId: string; status: string }) => {
      removeRunningTask(data.taskId);
      if (data.status === 'completed') {
        markTaskCompleted(data.taskId);
        onCompleteRef.current?.(data.taskId);
      }
    });

    socketInstance.on('attempt:started', (data: { attemptId: string; taskId: string }) => {
      if (data.taskId === taskId) {
        currentTaskIdRef.current = data.taskId;
        currentAttemptIdRef.current = data.attemptId;
        setCurrentAttemptId(data.attemptId);
        setIsRunning(true);
        addRunningTask(data.taskId);
        socketInstance.emit('attempt:subscribe', { attemptId: data.attemptId });
      }
    });

    registerOutputHandler(socketInstance, currentAttemptIdRef, currentTaskIdRef, setMessages, setIsRunning, removeRunningTask);

    socketInstance.on('attempt:finished', (data: WsAttemptFinished) => {
      setCurrentAttemptId((currentId) => {
        if (data.attemptId === currentId) {
          setIsRunning(false);
        }
        return currentId;
      });
    });

    socketInstance.on('error', () => {
      setIsRunning(false);
      if (currentTaskIdRef.current) removeRunningTask(currentTaskIdRef.current);
    });

    socketInstance.on('question:ask', (data: any) => {
      log.debug({ data }, 'Received question:ask event');
      if (!currentAttemptIdRef.current || data.attemptId !== currentAttemptIdRef.current) {
        log.debug({ receivedAttemptId: data.attemptId, currentAttemptId: currentAttemptIdRef.current }, 'Ignoring question from different attempt');
        return;
      }
      setActiveQuestion({ attemptId: data.attemptId, toolUseId: data.toolUseId, questions: data.questions });
    });

    socketInstance.on('question:new', (data: any) => {
      useQuestionsStore.getState().addQuestion({
        attemptId: data.attemptId,
        taskId: data.taskId,
        taskTitle: data.taskTitle,
        projectId: data.projectId,
        toolUseId: data.toolUseId,
        questions: data.questions,
        timestamp: data.timestamp,
      });
    });

    socketInstance.on('question:resolved', (data: { attemptId: string }) => {
      useQuestionsStore.getState().removeQuestion(data.attemptId);
    });

    socketInstance.on('status:workflow', (data: { attemptId: string; nodes: unknown[]; messages: unknown[]; summary: { chain: string[]; completedCount: number; activeCount: number; totalCount: number } }) => {
      useWorkflowStore.getState().updateWorkflow(data.attemptId, {
        nodes: data.nodes as any,
        messages: data.messages as any,
        summary: data.summary,
      });
    });

    socketInstance.on('workflow:update', (data: { attemptId: string; taskId: string; taskTitle: string; summary: { chain: string[]; completedCount: number; activeCount: number; totalCount: number } }) => {
      useWorkflowStore.getState().updateWorkflow(data.attemptId, {
        taskId: data.taskId,
        taskTitle: data.taskTitle,
        summary: data.summary,
      });
      if (data.summary.activeCount === 0 && data.summary.totalCount > 0) {
        setTimeout(() => {
          const entry = useWorkflowStore.getState().workflows.get(data.attemptId);
          if (entry && entry.summary.activeCount === 0) {
            useWorkflowStore.getState().removeWorkflow(data.attemptId);
          }
        }, 30000);
      }
    });

    socketInstance.on('output:stderr', (data: { attemptId: string; content: string }) => {
      if (currentAttemptIdRef.current && data.attemptId !== currentAttemptIdRef.current) return;
      setMessages((prev) => [...prev, {
        type: 'system' as any,
        content: data.content,
        isError: true,
        _attemptId: data.attemptId,
        _msgId: Math.random().toString(36),
      }]);
    });

    socketInstance.on('context:compacting', (data: { attemptId: string; taskId: string }) => {
      setMessages((prev) => [...prev, {
        type: 'system' as any,
        content: 'Compacting conversation context...',
        _attemptId: data.attemptId,
        _msgId: Math.random().toString(36),
      }]);
    });

    socketInstance.on('context:prompt-too-long', (data: { attemptId: string; message: string }) => {
      if (currentAttemptIdRef.current && data.attemptId !== currentAttemptIdRef.current) return;
      setMessages((prev) => [...prev, {
        type: 'system' as any,
        content: data.message,
        isError: true,
        _attemptId: data.attemptId,
        _msgId: Math.random().toString(36),
      }]);
    });

    return () => {
      socketInstance.close();
      socketRef.current = null;
    };
  }, []);
}
