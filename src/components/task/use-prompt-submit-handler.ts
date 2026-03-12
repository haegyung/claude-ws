'use client';

import { FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ContextMention } from '@/stores/context-mention-store';

interface UsePromptSubmitHandlerOptions {
  prompt: string;
  mentions: ContextMention[];
  disabled: boolean;
  isStreaming: boolean;
  selectedCommand: string | null;
  taskId?: string;
  onSubmit: (prompt: string, displayPrompt?: string, fileIds?: string[]) => void;
  onInterruptAndSend?: (prompt: string, displayPrompt?: string, fileIds?: string[]) => void;
  buildPromptWithMentions: (taskId: string, prompt: string) => { finalPrompt: string; displayPrompt: string };
  getUploadedFileIds: (taskId: string) => string[];
  hasUploadingFiles: (taskId: string) => boolean;
  clearFiles: (taskId: string) => void;
  updatePrompt: (value: string) => void;
  setSelectedCommand: (cmd: string | null) => void;
  setShowCommands: (show: boolean) => void;
}

// Handles prompt form submission including slash-command expansion,
// mention injection, file attachment IDs, and interrupt-and-send flow.
export function usePromptSubmitHandler({
  prompt,
  mentions,
  disabled,
  isStreaming,
  selectedCommand,
  taskId,
  onSubmit,
  onInterruptAndSend,
  buildPromptWithMentions,
  getUploadedFileIds,
  hasUploadingFiles,
  clearFiles,
  updatePrompt,
  setSelectedCommand,
  setShowCommands,
}: UsePromptSubmitHandlerOptions) {
  const t = useTranslations('chat');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() && mentions.length === 0) return;
    if (disabled && !isStreaming) return;

    if (taskId && hasUploadingFiles(taskId)) {
      toast.error(t('waitForUpload'));
      return;
    }

    const originalPrompt = prompt.trim();
    let finalPrompt = originalPrompt;
    let displayPrompt: string | undefined;

    if (taskId && mentions.length > 0) {
      const result = buildPromptWithMentions(taskId, originalPrompt);
      finalPrompt = result.finalPrompt;
      displayPrompt = result.displayPrompt;
    }

    if (selectedCommand || prompt.startsWith('/')) {
      const match = prompt.match(/^\/(\w+)(?::(\w+))?\s*(.*)/);
      if (match) {
        const [, cmdName, subCmd, args] = match;
        displayPrompt = originalPrompt;
        try {
          const res = await fetch(`/api/commands/${cmdName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subcommand: subCmd,
              arguments: args.trim(),
            }),
          });
          if (res.ok) {
            const data = await res.json();
            finalPrompt = data.prompt;
          }
        } catch (error) {
          console.error('Failed to process command:', error);
        }
      }
    }

    const fileIds = taskId ? getUploadedFileIds(taskId) : [];

    if (isStreaming && onInterruptAndSend) {
      onInterruptAndSend(finalPrompt, displayPrompt, fileIds.length > 0 ? fileIds : undefined);
    } else {
      onSubmit(finalPrompt, displayPrompt, fileIds.length > 0 ? fileIds : undefined);
    }

    updatePrompt('');
    setSelectedCommand(null);
    setShowCommands(false);
    if (taskId) {
      clearFiles(taskId);
    }
  };

  return { handleSubmit };
}
