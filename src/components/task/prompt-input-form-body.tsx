'use client';

import React, { RefObject, FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Textarea } from '@/components/ui/textarea';
import { CommandSelector } from './command-selector';
import { FileMentionDropdown } from './file-mention-dropdown';
import { MentionsBar } from '@/components/task/prompt-input-mentions';
import { AttachmentBarSection, HiddenFileInput } from '@/components/task/prompt-input-attachments';
import { PromptInputActionToolbar } from '@/components/task/prompt-input-action-toolbar';
import { PromptInputContextStatsBar } from '@/components/task/prompt-input-context-stats-bar';
import { TaskStats } from '@/components/task/use-task-stats';
import { ContextMention } from '@/stores/context-mention-store';
import type { PendingFile } from '@/types';

interface PromptInputFormBodyProps {
  // Prompt state
  prompt: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  minRows: number;
  maxRows: number;
  disabled: boolean;
  isStreaming: boolean;
  placeholder?: string;
  onSubmit: (e: FormEvent) => void;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  // Mentions
  mentions: ContextMention[];
  onRemoveMention: (displayName: string) => void;
  // Attachments
  taskId?: string;
  pendingFiles: PendingFile[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  onRemoveFile: (tempId: string) => void;
  onRetryFile: (tempId: string) => void;
  onOpenFilePicker: () => void;
  onFilesSelected: (files: File[]) => void;
  // Command selector
  showCommands: boolean;
  commandFilter: string;
  projectPath?: string;
  onCommandSelect: (command: string, isInteractive?: boolean) => void;
  onCommandClose: () => void;
  // File mention dropdown
  showFileMention: boolean;
  fileMentionQuery: string;
  onFileSelect: (filePath: string) => void;
  onFileMentionClose: () => void;
  // Toolbar
  hideSendButton: boolean;
  taskLastModel?: string | null;
  onCancel?: () => void;
  // Stats bar
  hideStats: boolean;
  taskStats: TaskStats | null;
}

// Renders the full form interior of PromptInput: mentions bar, attachment bar,
// textarea with overlays (command selector, file mention), action toolbar, and stats bar.
export function PromptInputFormBody({
  prompt,
  textareaRef,
  minRows,
  maxRows,
  disabled,
  isStreaming,
  placeholder,
  onSubmit,
  onInputChange,
  onKeyDown,
  onPaste,
  mentions,
  onRemoveMention,
  taskId,
  pendingFiles,
  fileInputRef,
  onRemoveFile,
  onRetryFile,
  onOpenFilePicker,
  onFilesSelected,
  showCommands,
  commandFilter,
  projectPath,
  onCommandSelect,
  onCommandClose,
  showFileMention,
  fileMentionQuery,
  onFileSelect,
  onFileMentionClose,
  hideSendButton,
  taskLastModel,
  onCancel,
  hideStats,
  taskStats,
}: PromptInputFormBodyProps) {
  const t = useTranslations('chat');

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 w-full min-w-0 overflow-visible">
      <MentionsBar mentions={mentions} onRemove={onRemoveMention} />

      <AttachmentBarSection
        taskId={taskId}
        pendingFiles={pendingFiles}
        onRemove={onRemoveFile}
        onRetry={onRetryFile}
        onAddFiles={onOpenFilePicker}
      />

      <div className="relative w-full min-w-0 max-w-full overflow-visible">
        <CommandSelector
          isOpen={showCommands}
          onSelect={onCommandSelect}
          onClose={onCommandClose}
          filter={commandFilter}
          projectPath={projectPath}
        />

        <FileMentionDropdown
          query={fileMentionQuery}
          onSelect={onFileSelect}
          onClose={onFileMentionClose}
          visible={showFileMention}
        />

        <div className="rounded-md border border-input overflow-hidden bg-background w-full max-w-full">
          <div className="relative w-full max-w-full">
            <Textarea
              ref={textareaRef}
              value={prompt}
              onChange={onInputChange}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onFocus={() => {
                setTimeout(() => {
                  textareaRef.current?.setSelectionRange(
                    textareaRef.current.value.length,
                    textareaRef.current.value.length
                  );
                }, 100);
              }}
              placeholder={isStreaming ? t('interruptAndSend') : (placeholder || t('describeWhatYouWant'))}
              disabled={disabled && !isStreaming}
              rows={minRows}
              className="resize-none w-full min-w-0 max-w-full overflow-y-auto overflow-x-hidden border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 text-sm whitespace-pre-wrap break-words"
              style={{
                fontSize: '14px',
                fieldSizing: minRows === 1 ? 'content' : 'fixed',
                minHeight: `${minRows * 24 + 16}px`,
                maxHeight: `${maxRows * 24 + 16}px`,
              } as React.CSSProperties}
            />
          </div>

          <PromptInputActionToolbar
            prompt={prompt}
            mentionsCount={mentions.length}
            disabled={disabled}
            isStreaming={isStreaming}
            hideSendButton={hideSendButton}
            taskId={taskId}
            taskLastModel={taskLastModel}
            onCancel={onCancel}
            onOpenFilePicker={onOpenFilePicker}
          />
        </div>
      </div>

      {taskId && !hideStats && <PromptInputContextStatsBar taskStats={taskStats} />}

      <HiddenFileInput
        fileInputRef={fileInputRef}
        disabled={disabled}
        onFilesSelected={onFilesSelected}
      />
    </form>
  );
}
