'use client';

import { useState, useCallback, RefObject } from 'react';
import { FileIcon } from '@/components/sidebar/file-browser/file-icon';
import { useContextMentionStore } from '@/stores/context-mention-store';
import { X } from 'lucide-react';

// ─── Hook: mention state & handlers ───

interface UsePromptMentionsOptions {
  taskId?: string;
  prompt: string;
  updatePrompt: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export function usePromptMentions({ taskId, prompt, updatePrompt, textareaRef }: UsePromptMentionsOptions) {
  const [showFileMention, setShowFileMention] = useState(false);
  const [fileMentionQuery, setFileMentionQuery] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);

  const { getMentions, addFileMention, removeMention, buildPromptWithMentions } = useContextMentionStore();
  const mentions = taskId ? getMentions(taskId) : [];

  const checkForFileMention = useCallback((text: string, cursorPos: number) => {
    let atIndex = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      const char = text[i];
      if (char === '@') {
        atIndex = i;
        break;
      }
      if (char === ' ' || char === '\n') {
        break;
      }
    }

    if (atIndex >= 0) {
      const query = text.slice(atIndex + 1, cursorPos);
      if (!query.includes(' ')) {
        setShowFileMention(true);
        setFileMentionQuery(query);
        setMentionStartIndex(atIndex);
        return;
      }
    }

    setShowFileMention(false);
    setFileMentionQuery('');
    setMentionStartIndex(-1);
  }, []);

  const handleFileSelect = useCallback((filePath: string) => {
    if (mentionStartIndex >= 0 && taskId) {
      const fileName = filePath.split('/').pop() || filePath;

      const before = prompt.slice(0, mentionStartIndex);
      const cursorPos = textareaRef.current?.selectionStart || prompt.length;
      const after = prompt.slice(cursorPos);
      const newPrompt = `${before}${after}`.trim();
      updatePrompt(newPrompt);

      addFileMention(taskId, fileName, filePath);

      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    }
    setShowFileMention(false);
    setFileMentionQuery('');
    setMentionStartIndex(-1);
  }, [mentionStartIndex, prompt, updatePrompt, taskId, addFileMention, textareaRef]);

  const handleFileMentionClose = useCallback(() => {
    setShowFileMention(false);
    setFileMentionQuery('');
    setMentionStartIndex(-1);
  }, []);

  const handleRemoveMention = useCallback((displayName: string) => {
    if (taskId) {
      removeMention(taskId, displayName);
    }
  }, [taskId, removeMention]);

  return {
    mentions,
    showFileMention,
    fileMentionQuery,
    checkForFileMention,
    handleFileSelect,
    handleFileMentionClose,
    handleRemoveMention,
    buildPromptWithMentions,
  };
}

// ─── Component: mentions bar (chip list) ───

interface MentionsBarProps {
  mentions: ReturnType<ReturnType<typeof useContextMentionStore.getState>['getMentions']>;
  onRemove: (displayName: string) => void;
}

export function MentionsBar({ mentions, onRemove }: MentionsBarProps) {
  if (mentions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-1">
      {mentions.map((mention) => (
        <div
          key={mention.displayName}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-muted/80 rounded text-xs group max-w-full"
          title={mention.type === 'lines' ? `${mention.filePath}#L${mention.startLine}-${mention.endLine}` : mention.filePath}
        >
          <FileIcon name={mention.fileName} type="file" className="size-3 shrink-0" />
          <span className="text-foreground truncate">
            {mention.type === 'lines'
              ? `@${mention.filePath}#L${mention.startLine}-${mention.endLine}`
              : `@${mention.filePath}`}
          </span>
          <button
            type="button"
            onClick={() => onRemove(mention.displayName)}
            className="text-muted-foreground hover:text-foreground opacity-60 group-hover:opacity-100 transition-opacity shrink-0"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
