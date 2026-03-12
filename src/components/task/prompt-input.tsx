'use client';

import { useState, useRef, forwardRef, useImperativeHandle, FormEvent } from 'react';
import { FileDropZone } from './file-drop-zone';
import { cn } from '@/lib/utils';
import { usePromptMentions } from '@/components/task/prompt-input-mentions';
import { usePromptAttachments } from '@/components/task/prompt-input-attachments';
import { usePromptKeyboard } from '@/components/task/use-prompt-keyboard';
import { useTaskStats } from '@/components/task/use-task-stats';
import { usePromptRewindRestore } from '@/components/task/use-prompt-rewind-restore';
import { usePromptSubmitHandler } from '@/components/task/use-prompt-submit-handler';
import { usePromptSlashCommandDetection } from '@/components/task/use-prompt-slash-command-detection';
import { PromptInputFormBody } from '@/components/task/prompt-input-form-body';

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

// Orchestrates all prompt-input hooks and delegates rendering to PromptInputFormBody.
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
  const [prompt, setPrompt] = useState(initialValue || '');
  const [userHasTyped, setUserHasTyped] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const updatePrompt = (newPrompt: string) => {
    setPrompt(newPrompt);
    onChange?.(newPrompt);
  };

  const {
    mentions, showFileMention, fileMentionQuery,
    checkForFileMention, handleFileSelect, handleFileMentionClose,
    handleRemoveMention, buildPromptWithMentions,
  } = usePromptMentions({ taskId, prompt, updatePrompt, textareaRef });

  const {
    fileInputRef, pendingFiles, handleFilesSelected, openFilePicker,
    removeFile, retryUpload, clearFiles, getUploadedFileIds, hasUploadingFiles,
  } = usePromptAttachments({ taskId });

  const {
    showCommands, commandFilter, selectedCommand,
    setShowCommands, setSelectedCommand, handleCommandSelect, handleCommandClose,
  } = usePromptSlashCommandDetection({ prompt, userHasTyped, updatePrompt, textareaRef, taskId });

  const taskStats = useTaskStats(taskId);
  usePromptRewindRestore({ taskId, updatePrompt, textareaRef });

  const { handleSubmit } = usePromptSubmitHandler({
    prompt, mentions, disabled, isStreaming, selectedCommand, taskId,
    onSubmit, onInterruptAndSend, buildPromptWithMentions,
    getUploadedFileIds, hasUploadingFiles, clearFiles,
    updatePrompt, setSelectedCommand, setShowCommands,
  });

  const { handleKeyDown } = usePromptKeyboard({
    showFileMention, showCommands, disableSubmitShortcut,
    handleSubmit, handleFileMentionClose, setShowCommands, updatePrompt,
  });

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
    focus: () => { textareaRef.current?.focus(); },
  }));

  return (
    <FileDropZone
      onFilesSelected={handleFilesSelected}
      disabled={disabled}
      className={cn('relative flex flex-col overflow-visible', className)}
    >
      <PromptInputFormBody
        prompt={prompt}
        textareaRef={textareaRef}
        minRows={minRows}
        maxRows={maxRows}
        disabled={disabled}
        isStreaming={isStreaming}
        placeholder={placeholder}
        onSubmit={handleSubmit}
        onInputChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        mentions={mentions}
        onRemoveMention={handleRemoveMention}
        taskId={taskId}
        pendingFiles={pendingFiles}
        fileInputRef={fileInputRef}
        onRemoveFile={(tempId) => removeFile(taskId!, tempId)}
        onRetryFile={(tempId) => retryUpload(taskId!, tempId)}
        onOpenFilePicker={openFilePicker}
        onFilesSelected={handleFilesSelected}
        showCommands={showCommands}
        commandFilter={commandFilter}
        projectPath={projectPath}
        onCommandSelect={handleCommandSelect}
        onCommandClose={handleCommandClose}
        showFileMention={showFileMention}
        fileMentionQuery={fileMentionQuery}
        onFileSelect={handleFileSelect}
        onFileMentionClose={handleFileMentionClose}
        hideSendButton={hideSendButton}
        taskLastModel={taskLastModel}
        onCancel={onCancel}
        hideStats={hideStats}
        taskStats={taskStats}
      />
    </FileDropZone>
  );
});

PromptInput.displayName = 'PromptInput';
