'use client';

import { useState, useEffect, RefObject } from 'react';
import { useInteractiveCommandStore } from '@/stores/interactive-command-store';

interface UsePromptSlashCommandDetectionOptions {
  prompt: string;
  userHasTyped: boolean;
  updatePrompt: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  taskId?: string;
}

// Detects slash commands typed in the prompt, manages the command selector
// visibility/filter, and handles command selection with interactive routing.
export function usePromptSlashCommandDetection({
  prompt,
  userHasTyped,
  updatePrompt,
  textareaRef,
  taskId,
}: UsePromptSlashCommandDetectionOptions) {
  const [showCommands, setShowCommands] = useState(false);
  const [commandFilter, setCommandFilter] = useState('');
  const [selectedCommand, setSelectedCommand] = useState<string | null>(null);
  const { openCommand } = useInteractiveCommandStore();

  // Auto-show command selector when prompt starts with /
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
        setCommandFilter(afterSlash.split(' ')[0]);
      } else {
        setShowCommands(false);
      }
    } else {
      setShowCommands(false);
      setCommandFilter('');
    }
  }, [prompt, selectedCommand, userHasTyped]);

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
        default: {
          const cmdText = `/${command} `;
          updatePrompt(cmdText);
          setSelectedCommand(command);
          textareaRef.current?.focus();
        }
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

  return {
    showCommands,
    commandFilter,
    selectedCommand,
    setShowCommands,
    setSelectedCommand,
    handleCommandSelect,
    handleCommandClose,
  };
}
