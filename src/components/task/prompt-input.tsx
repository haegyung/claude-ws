'use client';

import { useState, FormEvent, useRef, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Loader2, Square, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { CommandSelector } from './command-selector';
import { FileDropZone } from './file-drop-zone';
import { FileMentionDropdown } from './file-mention-dropdown';
import { ChatModelSelector } from './chat-model-selector';
import { useInteractiveCommandStore } from '@/stores/interactive-command-store';
import { cn } from '@/lib/utils';
import { usePromptMentions, MentionsBar } from '@/components/task/prompt-input-mentions';
import { usePromptAttachments, AttachmentBarSection, PaperclipButton, HiddenFileInput } from '@/components/task/prompt-input-attachments';
import { usePromptKeyboard } from '@/components/task/use-prompt-keyboard';

export interface PromptInputRef {
  submit: () => void;
  focus: () => void;
}

interface PromptInputProps {
  onSubmit: (prompt: string, displayPrompt?: string, fileIds?: string[]) => void;
  onCancel?: () => void;
  onInterruptAndSend?: (prompt: string, displayPrompt?: string, fileIds?: string[]) => void;
  disabled?: boolean;
  isStreaming?: boolean;  // Whether Claude is currently streaming a response
  placeholder?: string;
  className?: string;
  taskId?: string;
  taskLastModel?: string | null;
  projectPath?: string;  // Project path for loading project-level commands/skills
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
  const [showCommands, setShowCommands] = useState(false);
  const [commandFilter, setCommandFilter] = useState('');
  const [selectedCommand, setSelectedCommand] = useState<string | null>(null);
  const [userHasTyped, setUserHasTyped] = useState(false);
  const [taskStats, setTaskStats] = useState<{
    totalTokens: number;
    totalCostUSD: number;
    totalTurns: number;
    totalDurationMs: number;
    totalAdditions: number;
    totalDeletions: number;
    filesChanged: number;
    contextUsed: number;
    contextLimit: number;
    contextPercentage: number;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { openCommand } = useInteractiveCommandStore();

  // Wrapper to update prompt and notify parent
  const updatePrompt = (newPrompt: string) => {
    setPrompt(newPrompt);
    onChange?.(newPrompt);
  };

  // ─── Extracted hooks ───

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

  // ─── Slash command detection ───

  useEffect(() => {
    if (selectedCommand && !prompt.startsWith(`/${selectedCommand}`)) {
      setSelectedCommand(null);
    }

    if (!userHasTyped) {
      setShowCommands(false);
      return;
    }

    if (prompt.startsWith('/')) {
      const afterSlash = prompt.slice(1);
      const hasSpace = afterSlash.includes(' ');

      if (!hasSpace) {
        setShowCommands(true);
        const filter = afterSlash.split(' ')[0];
        setCommandFilter(filter);
      } else {
        setShowCommands(false);
      }
    } else {
      setShowCommands(false);
      setCommandFilter('');
    }
  }, [prompt, selectedCommand, userHasTyped]);

  // Fetch task stats when taskId changes
  useEffect(() => {
    if (!taskId) return;

    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}/stats`);
        if (res.ok) {
          const data = await res.json();
          setTaskStats(data);
        }
      } catch (error) {
        console.error('Failed to fetch task stats:', error);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [taskId]);

  // Helper to check and apply rewind prompt from localStorage
  const applyRewindPrompt = useCallback(() => {
    if (!taskId) return;

    const storageKey = `rewind-prompt-${taskId}`;
    const rewindPrompt = localStorage.getItem(storageKey);

    if (rewindPrompt) {
      updatePrompt(rewindPrompt);
      localStorage.removeItem(storageKey);
      setTimeout(() => {
        textareaRef.current?.focus();
        textareaRef.current?.select();
      }, 100);
    }
  }, [taskId, updatePrompt]);

  useEffect(() => {
    applyRewindPrompt();
  }, [taskId, applyRewindPrompt]);

  useEffect(() => {
    const handleRewindComplete = () => {
      setTimeout(applyRewindPrompt, 50);
    };

    window.addEventListener('rewind-complete', handleRewindComplete);
    return () => window.removeEventListener('rewind-complete', handleRewindComplete);
  }, [applyRewindPrompt]);

  // ─── Submit ───

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

  // ─── Keyboard ───

  const { handleKeyDown } = usePromptKeyboard({
    showFileMention,
    showCommands,
    disableSubmitShortcut,
    handleSubmit,
    handleFileMentionClose,
    setShowCommands,
    updatePrompt,
  });

  // Handle paste event for images
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!taskId) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      await handleFilesSelected(imageFiles);
    }
  };

  // Handle input change - check for @ mentions
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    updatePrompt(newValue);

    if (!userHasTyped) {
      setUserHasTyped(true);
    }

    const cursorPos = e.target.selectionStart || 0;
    checkForFileMention(newValue, cursorPos);
  };

  const handleCommandSelect = (command: string, isInteractive?: boolean) => {
    if (isInteractive && taskId) {
      setShowCommands(false);
      updatePrompt('');

      switch (command) {
        case 'rewind':
          openCommand({ type: 'rewind', taskId });
          break;
        case 'model':
          openCommand({ type: 'model', currentModel: 'claude-sonnet-4-20250514' });
          break;
        case 'config':
          openCommand({ type: 'config' });
          break;
        case 'clear':
          openCommand({ type: 'clear', taskId });
          break;
        case 'compact':
          openCommand({ type: 'compact', taskId });
          break;
        default:
          const cmdText = `/${command} `;
          updatePrompt(cmdText);
          setSelectedCommand(command);
          textareaRef.current?.focus();
      }
      return;
    }

    const cmdText = `/${command} `;
    updatePrompt(cmdText);
    setSelectedCommand(command);
    setShowCommands(false);
    textareaRef.current?.focus();
  };

  const handleCommandClose = () => {
    setShowCommands(false);
    if (prompt === '/' || (prompt.startsWith('/') && !prompt.includes(' '))) {
      updatePrompt('');
    }
  };

  // Expose submit and focus functions to parent via ref
  useImperativeHandle(ref, () => ({
    submit: () => {
      if (!prompt.trim() && mentions.length === 0) return;
      if (disabled && !isStreaming) return;
      handleSubmit({ preventDefault: () => { } } as FormEvent);
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
        {/* Context Mentions Bar */}
        <MentionsBar mentions={mentions} onRemove={handleRemoveMention} />

        {/* Attachment Bar */}
        <AttachmentBarSection
          taskId={taskId}
          pendingFiles={pendingFiles}
          onRemove={(tempId) => removeFile(taskId!, tempId)}
          onRetry={(tempId) => retryUpload(taskId!, tempId)}
          onAddFiles={openFilePicker}
        />

        {/* Input area */}
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

          {/* Textarea and buttons as a single block */}
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
                    textareaRef.current?.setSelectionRange(textareaRef.current.value.length, textareaRef.current.value.length);
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

            {/* Buttons row - below textarea */}
            <div className="flex items-center justify-between px-2 py-1.5 bg-transparent dark:bg-input/30">
              <div className="flex items-center gap-2">
                <PaperclipButton disabled={disabled} isStreaming={isStreaming} onClick={openFilePicker} />
                {prompt.startsWith('/') && (() => {
                  const cmdPart = prompt.split(' ')[0];
                  return (
                    <span className="inline-flex items-center px-2 py-0.5 bg-primary/15 text-primary text-xs font-medium rounded">
                      {cmdPart}
                    </span>
                  );
                })()}
              </div>

              {/* Model selector + Send/Stop button - right */}
              <div className="flex items-center gap-1">
                <ChatModelSelector disabled={disabled && !isStreaming} taskId={taskId} taskLastModel={taskLastModel} />
                {!hideSendButton && (
                  isStreaming ? (
                    <div className="flex items-center gap-1">
                      {onCancel && (
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={onCancel}
                          title={t('stop')}
                        >
                          <Square className="size-4" />
                        </Button>
                      )}
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!prompt.trim() && mentions.length === 0}
                      >
                        <Send className="size-4" />
                      </Button>
                    </div>
                  ) : disabled && onCancel ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={onCancel}
                    >
                      <Square className="size-4" />
                      {t('stop')}
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      disabled={disabled || (!prompt.trim() && mentions.length === 0)}
                      size="sm"
                    >
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
          </div>
        </div>

        {/* Stats and hints bar - below input */}
        {taskId && !hideStats && (
          <div className="flex items-center justify-between gap-2 sm:gap-3 text-[10px] text-muted-foreground px-1">
              {/* Keyboard hints - left side */}
              <div className="hidden sm:flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-muted rounded text-[9px] font-mono">/</kbd>
                  <span>{t('commandsHint')}</span>
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-muted rounded text-[9px] font-mono">@</kbd>
                  <span>{t('filesHint')}</span>
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-muted rounded text-[9px] font-mono">&#x2318;V</kbd>
                  <span>{t('pasteImageHint')}</span>
                </span>
              </div>

              {/* Stats - right side: git changes, then context % */}
              <div className="flex items-center gap-2 sm:gap-3 ml-auto">
                {/* Git changes */}
                <div className="flex items-center gap-0.5 sm:gap-1">
                  <span className="text-green-600 text-[9px] sm:text-[10px]">+{taskStats?.totalAdditions || 0}</span>
                  <span className="text-red-600 text-[9px] sm:text-[10px]">-{taskStats?.totalDeletions || 0}</span>
                </div>

                {/* Context Usage */}
                <div className="flex items-center gap-1">
                  <TrendingUp className="size-3 hidden sm:inline" />
                  <div className="flex items-center gap-0.5 sm:gap-1">
                    <div className="hidden sm:flex gap-0.5">
                      {Array.from({ length: 10 }).map((_, i) => {
                        const percentage = taskStats?.contextPercentage || 0;
                        const filled = (percentage / 10) > i;
                        let color = 'bg-muted';
                        if (filled) {
                          if (percentage > 90) {
                            color = 'bg-red-500';
                          } else if (percentage >= 60) {
                            color = 'bg-yellow-500';
                          } else {
                            color = 'bg-green-500';
                          }
                        }
                        return (
                          <div
                            key={i}
                            className={`w-1.5 h-2 rounded-[1px] ${color}`}
                          />
                        );
                      })}
                    </div>
                    <span className={`font-medium text-[9px] sm:text-[10px] ${
                      (taskStats?.contextPercentage || 0) > 90
                        ? 'text-red-500'
                        : (taskStats?.contextPercentage || 0) >= 60
                          ? 'text-yellow-500'
                          : ''
                    }`}>
                      {taskStats?.contextPercentage || 0}%
                    </span>
                  </div>
                </div>
              </div>
          </div>
        )}
      </form>

      {/* Hidden file input for Paperclip button */}
      <HiddenFileInput
        fileInputRef={fileInputRef}
        disabled={disabled}
        onFilesSelected={handleFilesSelected}
      />
    </FileDropZone>
  );
});

PromptInput.displayName = 'PromptInput';
