'use client';

import { useTranslations } from 'next-intl';
import { TrendingUp } from 'lucide-react';
import { TaskStats } from './use-task-stats';

interface PromptInputContextStatsBarProps {
  taskStats: TaskStats | null;
}

// Displays keyboard hints (/, @, paste) and task context stats
// (git diff additions/deletions + context window usage bar) below the prompt input.
export function PromptInputContextStatsBar({ taskStats }: PromptInputContextStatsBarProps) {
  const t = useTranslations('chat');
  const contextPct = taskStats?.contextPercentage || 0;

  const contextColor =
    contextPct > 90 ? 'text-red-500' : contextPct >= 60 ? 'text-yellow-500' : '';

  return (
    <div className="flex items-center justify-between gap-2 sm:gap-3 text-[10px] text-muted-foreground px-1">
      {/* Keyboard hints - left */}
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

      {/* Stats - right: git diff + context usage bar */}
      <div className="flex items-center gap-2 sm:gap-3 ml-auto">
        {/* Git diff additions / deletions */}
        <div className="flex items-center gap-0.5 sm:gap-1">
          <span className="text-green-600 text-[9px] sm:text-[10px]">+{taskStats?.totalAdditions || 0}</span>
          <span className="text-red-600 text-[9px] sm:text-[10px]">-{taskStats?.totalDeletions || 0}</span>
        </div>

        {/* Context window usage */}
        <div className="flex items-center gap-1">
          <TrendingUp className="size-3 hidden sm:inline" />
          <div className="flex items-center gap-0.5 sm:gap-1">
            <div className="hidden sm:flex gap-0.5">
              {Array.from({ length: 10 }).map((_, i) => {
                const filled = (contextPct / 10) > i;
                let color = 'bg-muted';
                if (filled) {
                  color = contextPct > 90 ? 'bg-red-500' : contextPct >= 60 ? 'bg-yellow-500' : 'bg-green-500';
                }
                return <div key={i} className={`w-1.5 h-2 rounded-[1px] ${color}`} />;
              })}
            </div>
            <span className={`font-medium text-[9px] sm:text-[10px] ${contextColor}`}>
              {contextPct}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
