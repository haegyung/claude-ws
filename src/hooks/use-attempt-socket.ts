'use client';

import { useEffect, useCallback, type RefObject } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ClaudeOutput, WsAttemptFinished } from '@/types';
import { useRunningTasksStore } from '@/stores/running-tasks-store';
import { useQuestionsStore } from '@/stores/questions-store';
import { useWorkflowStore } from '@/stores/workflow-store';
import { createLogger } from '@/lib/logger';
import type { ActiveQuestion } from '@/hooks/use-attempt-questions';

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

/**
 * Register the output:json handler for processing streamed messages.
 * Extracted to keep the main useEffect readable while preserving all message
 * merging/delta-accumulation logic exactly as-is.
 */
function registerOutputHandler(
  socketInstance: Socket,
  currentAttemptIdRef: RefObject<string | null>,
  currentTaskIdRef: RefObject<string | null>,
  setMessages: (fn: (prev: ClaudeOutput[]) => ClaudeOutput[]) => void,
  setIsRunning: (running: boolean) => void,
  removeRunningTask: (taskId: string) => void,
) {
  socketInstance.on('output:json', (data: { attemptId: string; data: ClaudeOutput }) => {
    const { attemptId, data: output } = data;

    // Filter messages by attemptId to prevent cross-task streaming
    if (currentAttemptIdRef.current && attemptId !== currentAttemptIdRef.current) {
      return;
    }

    if (output.type === 'result') {
      setIsRunning(false);
      if (currentTaskIdRef.current) removeRunningTask(currentTaskIdRef.current);
    }

    setMessages((prev) => {
      // Handle streaming text/thinking deltas
      if (output.type === 'content_block_delta' && (output as any).delta) {
        const delta = (output as any).delta;

        if (delta.type !== 'text_delta' && delta.type !== 'thinking_delta') {
          return prev;
        }

        const existingIndex = prev.findLastIndex(
          (m) => m.type === 'assistant' && (m as any)._attemptId === attemptId
        );

        let assistantMsg: any;
        let content: any[];

        if (existingIndex >= 0 && (prev[existingIndex] as any)._fromStreaming) {
          assistantMsg = { ...prev[existingIndex] };
          content = [...(assistantMsg.message?.content || [])];
        } else {
          assistantMsg = {
            type: 'assistant',
            message: { role: 'assistant', content: [] },
            _attemptId: attemptId,
            _msgId: Math.random().toString(36),
            _fromStreaming: true,
          };
          content = [];
        }

        if (delta.type === 'text_delta' && delta.text) {
          const textBlockIndex = content.findIndex((b: any) => b.type === 'text');
          if (textBlockIndex >= 0) {
            content[textBlockIndex] = {
              ...content[textBlockIndex],
              text: (content[textBlockIndex].text || '') + delta.text,
            };
          } else {
            content.push({ type: 'text', text: delta.text });
          }
        }

        if (delta.type === 'thinking_delta' && delta.thinking) {
          const thinkingBlockIndex = content.findIndex((b: any) => b.type === 'thinking');
          if (thinkingBlockIndex >= 0) {
            content[thinkingBlockIndex] = {
              ...content[thinkingBlockIndex],
              thinking: (content[thinkingBlockIndex].thinking || '') + delta.thinking,
            };
          } else {
            content.push({ type: 'thinking', thinking: delta.thinking });
          }
        }

        assistantMsg.message = { ...assistantMsg.message, content };

        const shouldUpdate = existingIndex >= 0 && (prev[existingIndex] as any)._fromStreaming;
        if (shouldUpdate) {
          const updated = [...prev];
          updated[existingIndex] = assistantMsg;
          return updated;
        }
        return [...prev, assistantMsg];
      }

      const msgId = Math.random().toString(36);
      const taggedOutput = { ...output, _attemptId: attemptId, _msgId: msgId } as ClaudeOutput & { _attemptId: string; _msgId: string };

      if (output.type === 'tool_use' && output.id) {
        const existingIndex = prev.findIndex(
          (m) => m.type === 'tool_use' && m.id === output.id
        );
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = taggedOutput;
          return updated;
        }
      }

      if (output.type === 'tool_result' && output.tool_data?.tool_use_id) {
        const toolUseId = output.tool_data.tool_use_id;
        const existingIndex = prev.findIndex(
          (m) => m.type === 'tool_result' && m.tool_data?.tool_use_id === toolUseId
        );
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = taggedOutput;
          return updated;
        }
      }

      if (output.type === 'assistant') {
        const lastMsg = prev[prev.length - 1];
        const isLastMsgStreamingAssistant = lastMsg?.type === 'assistant' && (lastMsg as any)._fromStreaming;

        if (isLastMsgStreamingAssistant) {
          const existingIndex = prev.length - 1;
          const existing = prev[existingIndex] as any;
          const existingContent = existing.message?.content || [];
          const newContent = output.message?.content || [];

          const mergedContent = [...existingContent];
          for (const newBlock of newContent) {
            const blockIndex = mergedContent.findIndex(
              (b: any) => b.type === newBlock.type && (
                (newBlock.type === 'tool_use' && b.id === newBlock.id) ||
                (newBlock.type !== 'tool_use')
              )
            );

            if (blockIndex >= 0 && newBlock.type !== 'tool_use') {
              const oldBlock = mergedContent[blockIndex];
              if (newBlock.type === 'text') {
                if ((newBlock.text?.length || 0) >= (oldBlock.text?.length || 0)) {
                  mergedContent[blockIndex] = newBlock;
                }
              } else if (newBlock.type === 'thinking') {
                if ((newBlock.thinking?.length || 0) >= (oldBlock.thinking?.length || 0)) {
                  mergedContent[blockIndex] = newBlock;
                }
              } else {
                mergedContent[blockIndex] = newBlock;
              }
            } else if (blockIndex < 0) {
              mergedContent.push(newBlock);
            }
          }

          const updated = [...prev];
          updated[existingIndex] = {
            ...existing,
            message: { ...output.message, content: mergedContent },
            _attemptId: attemptId,
          };
          return updated;
        }
      }

      const finalOutput = output.type === 'assistant'
        ? { ...taggedOutput, _fromStreaming: true }
        : taggedOutput;
      return [...prev, finalOutput];
    });
  });
}
