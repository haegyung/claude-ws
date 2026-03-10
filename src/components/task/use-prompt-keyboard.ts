import React, { FormEvent } from 'react';

interface UsePromptKeyboardOptions {
  showFileMention: boolean;
  showCommands: boolean;
  disableSubmitShortcut: boolean;
  handleSubmit: (e: FormEvent) => void;
  handleFileMentionClose: () => void;
  setShowCommands: (show: boolean) => void;
  updatePrompt: (value: string) => void;
}

export function usePromptKeyboard({
  showFileMention,
  showCommands,
  disableSubmitShortcut,
  handleSubmit,
  handleFileMentionClose,
  setShowCommands,
  updatePrompt,
}: UsePromptKeyboardOptions) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Let file mention dropdown handle navigation keys when visible
    if (showFileMention && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Tab' || e.key === 'Enter' || e.key === 'Escape')) {
      return;
    }

    // Let command selector handle navigation keys when visible
    if (showCommands && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter' || e.key === 'Escape')) {
      return;
    }

    // Enter to send, Shift+Enter or Ctrl+Enter for newline
    if (!disableSubmitShortcut && e.key === 'Enter') {
      if (e.shiftKey || e.ctrlKey) {
        return;
      }
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }

    if (e.key === 'Escape') {
      if (showFileMention) {
        e.preventDefault();
        handleFileMentionClose();
      } else if (showCommands) {
        e.preventDefault();
        setShowCommands(false);
        updatePrompt('');
      }
    }
  };

  return { handleKeyDown };
}
