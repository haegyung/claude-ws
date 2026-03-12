'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Send, Loader2, Square } from 'lucide-react';
import { ChatModelSelector } from './chat-model-selector';
import { PaperclipButton } from './prompt-input-attachments';

interface PromptInputActionToolbarProps {
  prompt: string;
  mentionsCount: number;
  disabled: boolean;
  isStreaming: boolean;
  hideSendButton: boolean;
  taskId?: string;
  taskLastModel?: string | null;
  onCancel?: () => void;
  onOpenFilePicker: () => void;
}

// Bottom toolbar row inside the prompt input box:
// paperclip button, active command badge, model selector, send/stop buttons.
export function PromptInputActionToolbar({
  prompt,
  mentionsCount,
  disabled,
  isStreaming,
  hideSendButton,
  taskId,
  taskLastModel,
  onCancel,
  onOpenFilePicker,
}: PromptInputActionToolbarProps) {
  const t = useTranslations('chat');
  const hasContent = !!prompt.trim() || mentionsCount > 0;

  return (
    <div className="flex items-center justify-between px-2 py-1.5 bg-transparent dark:bg-input/30">
      {/* Left: paperclip + active command badge */}
      <div className="flex items-center gap-2">
        <PaperclipButton disabled={disabled} isStreaming={isStreaming} onClick={onOpenFilePicker} />
        {prompt.startsWith('/') && (() => {
          const cmdPart = prompt.split(' ')[0];
          return (
            <span className="inline-flex items-center px-2 py-0.5 bg-primary/15 text-primary text-xs font-medium rounded">
              {cmdPart}
            </span>
          );
        })()}
      </div>

      {/* Right: model selector + send/stop buttons */}
      <div className="flex items-center gap-1">
        <ChatModelSelector disabled={disabled && !isStreaming} taskId={taskId} taskLastModel={taskLastModel} />
        {!hideSendButton && (
          isStreaming ? (
            <div className="flex items-center gap-1">
              {onCancel && (
                <Button type="button" size="sm" variant="destructive" onClick={onCancel} title={t('stop')}>
                  <Square className="size-4" />
                </Button>
              )}
              <Button type="submit" size="sm" disabled={!hasContent}>
                <Send className="size-4" />
              </Button>
            </div>
          ) : disabled && onCancel ? (
            <Button type="button" size="sm" variant="destructive" onClick={onCancel}>
              <Square className="size-4" />
              {t('stop')}
            </Button>
          ) : (
            <Button type="submit" disabled={disabled || !hasContent} size="sm">
              {disabled ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('running')}
                </>
              ) : (
                <>
                  <Send className="size-4" />
                  {t('send')}
                </>
              )}
            </Button>
          )
        )}
      </div>
    </div>
  );
}
