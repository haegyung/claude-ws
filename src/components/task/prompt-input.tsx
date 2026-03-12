'use client';

import { useState, useRef, forwardRef, useImperativeHandle, FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Textarea } from '@/components/ui/textarea';
import { CommandSelector } from './command-selector';
import { FileDropZone } from './file-drop-zone';
import { FileMentionDropdown } from './file-mention-dropdown';
import { cn } from '@/lib/utils';
import { usePromptMentions, MentionsBar } from '@/components/task/prompt-input-mentions';
import { usePromptAttachments, AttachmentBarSection, HiddenFileInput } from '@/components/task/prompt-input-attachments';
import { usePromptKeyboard } from '@/components/task/use-prompt-keyboard';
import { useTaskStats } from '@/components/task/use-task-stats';
import { usePromptRewindRestore } from '@/components/task/use-prompt-rewind-restore';
import { usePromptSubmitHandler } from '@/components/task/use-prompt-submit-handler';
import { usePromptSlashCommandDetection } from '@/components/task/use-prompt-slash-command-detection';
import { PromptInputActionToolbar } from '@/components/task/prompt-input-action-toolbar';
import { PromptInputContextStatsBar } from '@/components/task/prompt-input-context-stats-bar';

export interface PromptInputRef {
  submit: () => void;
  focus: () => void;
}

interface PromptInputProps {
  onSubmit: (prompt: string, displayPrompt?: string, fileIds?: string[]) => void;
  onCancel?: () => void;
  onInterruptAndSend?: (prompt: string, displayPrompt?: string, fileIds?: string[]) => void;
  disabled?: boolean;
  isStreaming?: boolean;
  placeholder?: string;
  className?: string;
  taskId?: string;
  taskLastModel?: string | null;
  projectPath?: string;
  hideSendButton?: boolean;
  disableSubmitShortcut?: boolean;
  hideStats?: boolean;
  onChange?: (prompt: string) => void;
  initialValue?: string;
  minRows?: number;
  maxRows?: number;
}

export const PromptInput = forwardRef<PromptInputRef, PromptInputProps>(({
  onSubmit,
  onCancel,
  onInterruptAndSend,
  disabled = false,
  isStreaming = false,
  placeholder,
  className,
  taskId,
  taskLastModel,
  projectPath,
  hideSendButton = false,
  disableSubmitShortcut = false,
  hideStats = false,
  onChange,
  initialValue,
  minRows = 1,
  maxRows = 5,
}, ref) => {
  const t = useTranslations('chat');
  const [prompt, setPrompt] = useState(initialValue || '');
  const [userHasTyped, setUserHasTyped] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const updatePrompt = (newPrompt: string) => {
    setPrompt(newPrompt);
    onChange?.(newPrompt);
  };

  // ─── Hooks ───

  const {
    mentions,
    showFileMention,
    fileMentionQuery,
    checkForFileMention,
    handleFileSelect,
    handleFileMentionClose,
    handleRemoveMention,
    buildPromptWithMentions,
  } = usePromptMentions({ taskId, prompt, updatePrompt, textareaRef });

  const {
    fileInputRef,
    pendingFiles,
    handleFilesSelected,
    openFilePicker,
    removeFile,
    retryUpload,
    clearFiles,
    getUploadedFileIds,
    hasUploadingFiles,
  } = usePromptAttachments({ taskId });

  const {
    showCommands,
    commandFilter,
    selectedCommand,
    setShowCommands,
    setSelectedCommand,
    handleCommandSelect,
    handleCommandClose,
  } = usePromptSlashCommandDetection({ prompt, userHasTyped, updatePrompt, textareaRef, taskId });

  const taskStats = useTaskStats(taskId);

  usePromptRewindRestore({ taskId, updatePrompt, textareaRef });

  const { handleSubmit } = usePromptSubmitHandler({
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
  });

  const { handleKeyDown } = usePromptKeyboard({
    showFileMention,
    showCommands,
    disableSubmitShortcut,
    handleSubmit,
    handleFileMentionClose,
    setShowCommands,
    updatePrompt,
  });

  // Handle paste — intercept image files and add as attachments
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!taskId) return;
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      await handleFilesSelected(imageFiles);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    updatePrompt(newValue);
    if (!userHasTyped) setUserHasTyped(true);
    checkForFileMention(newValue, e.target.selectionStart || 0);
  };

  useImperativeHandle(ref, () => ({
    submit: () => {
      if (!prompt.trim() && mentions.length === 0) return;
      if (disabled && !isStreaming) return;
      handleSubmit({ preventDefault: () => {} } as FormEvent);
    },
    focus: () => {
      textareaRef.current?.focus();
    },
  }));

  return (
    <FileDropZone
      onFilesSelected={handleFilesSelected}
      disabled={disabled}
      className={cn('relative flex flex-col overflow-visible', className)}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 w-full min-w-0 overflow-visible">
        <MentionsBar mentions={mentions} onRemove={handleRemoveMention} />

        <AttachmentBarSection
          taskId={taskId}
          pendingFiles={pendingFiles}
          onRemove={(tempId) => removeFile(taskId!, tempId)}
          onRetry={(tempId) => retryUpload(taskId!, tempId)}
          onAddFiles={openFilePicker}
        />

        <div className="relative w-full min-w-0 max-w-full overflow-visible">
          <CommandSelector
            isOpen={showCommands}
            onSelect={handleCommandSelect}
            onClose={handleCommandClose}
            filter={commandFilter}
            projectPath={projectPath}
          />

          <FileMentionDropdown
            query={fileMentionQuery}
            onSelect={handleFileSelect}
            onClose={handleFileMentionClose}
            visible={showFileMention}
          />

          <div className="rounded-md border border-input overflow-hidden bg-background w-full max-w-full">
            <div className="relative w-full max-w-full">
              <Textarea
                ref={textareaRef}
                value={prompt}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
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
              onOpenFilePicker={openFilePicker}
            />
          </div>
        </div>

        {taskId && !hideStats && (
          <PromptInputContextStatsBar taskStats={taskStats} />
        )}
      </form>

      <HiddenFileInput
        fileInputRef={fileInputRef}
        disabled={disabled}
        onFilesSelected={handleFilesSelected}
      />
    </FileDropZone>
  );
});

PromptInput.displayName = 'PromptInput';
