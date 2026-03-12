'use client';

import { cn } from '@/lib/utils';
import { Zap } from 'lucide-react';
import { useCommandSelectorDataAndKeyboard } from './use-command-selector-data-and-keyboard';

// Highlights the matched portion of text with a blue badge span.
function highlightMatch(text: string, query: string) {
  if (!query) return text;

  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part, i) => {
    if (part.toLowerCase() === query.toLowerCase()) {
      return (
        <span key={i} className="bg-blue-500/30 text-blue-600 dark:text-blue-400 font-semibold px-0.5 rounded">
          {part}
        </span>
      );
    }
    return part;
  });
}

interface CommandSelectorProps {
  isOpen: boolean;
  onSelect: (command: string, isInteractive?: boolean) => void;
  onClose: () => void;
  filter?: string;
  className?: string;
  projectPath?: string;
}

export function CommandSelector({
  isOpen,
  onSelect,
  onClose,
  filter = '',
  className,
  projectPath: explicitProjectPath,
}: CommandSelectorProps) {
  const { loading, filteredCommands, selectedIndex, setSelectedIndex, listRef } =
    useCommandSelectorDataAndKeyboard({ isOpen, filter, explicitProjectPath, onSelect, onClose });

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        'absolute bottom-full left-0 mb-1 w-72 bg-popover border rounded-md shadow-lg overflow-hidden',
        className
      )}
      style={{ zIndex: 9999 }}
    >
      <div ref={listRef} className="max-h-48 overflow-y-auto py-1">
        {loading ? (
          <div className="px-2 py-2 text-center text-xs text-muted-foreground">Loading...</div>
        ) : filteredCommands.length === 0 ? (
          <div className="px-2 py-2 text-center text-xs text-muted-foreground">No commands found</div>
        ) : (
          filteredCommands.map((cmd, index) => (
            <button
              key={cmd.name}
              onClick={() => onSelect(cmd.name, cmd.isInteractive)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/50 transition-colors',
                index === selectedIndex && 'bg-muted'
              )}
            >
              <Zap className="size-3 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">
                    /{highlightMatch(cmd.name, filter)}
                  </span>
                  {cmd.argumentHint && (
                    <span className="text-[10px] text-muted-foreground">{cmd.argumentHint}</span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground truncate">{cmd.description}</p>
              </div>
            </button>
          ))
        )}
      </div>

      <div className="px-2 py-1 border-t bg-muted/30 text-[10px] text-muted-foreground">
        <kbd className="px-0.5 bg-muted rounded">↑↓</kbd> navigate
        <span className="mx-1">·</span>
        <kbd className="px-0.5 bg-muted rounded">Tab</kbd> select
        <span className="mx-1">·</span>
        <kbd className="px-0.5 bg-muted rounded">Esc</kbd> close
      </div>
    </div>
  );
}
