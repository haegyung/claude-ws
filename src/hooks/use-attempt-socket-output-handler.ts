'use client';

/**
 * Output handler for the attempt socket — processes streamed output:json messages.
 *
 * Handles streaming text/thinking deltas, tool_use / tool_result deduplication,
 * and streaming assistant message merging.
 */

import type { RefObject } from 'react';
import type { Socket } from 'socket.io-client';
import type { ClaudeOutput } from '@/types';

/**
 * Register the output:json handler on the given socket instance.
 * Extracted from useAttemptSocket to keep the main useEffect readable.
 */
export function registerOutputHandler(
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
