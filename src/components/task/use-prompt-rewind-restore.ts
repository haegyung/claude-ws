import { useCallback, useEffect, RefObject } from 'react';

interface UsePromptRewindRestoreOptions {
  taskId?: string;
  updatePrompt: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

// Restores prompt from localStorage after a rewind operation.
// Listens for 'rewind-complete' window event to re-apply on fresh renders.
export function usePromptRewindRestore({
  taskId,
  updatePrompt,
  textareaRef,
}: UsePromptRewindRestoreOptions) {
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
  }, [taskId, updatePrompt, textareaRef]);

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
}
