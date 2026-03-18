'use client';

import { useTranslations } from 'next-intl';
import { Zap } from 'lucide-react';
import { useAutopilot } from '@/hooks/use-autopilot';
import { useProjectStore } from '@/stores/project-store';
import { cn } from '@/lib/utils';

export function AutopilotToggle() {
  const t = useTranslations('kanban');
  const { activeProjectId, selectedProjectIds } = useProjectStore();
  const projectId = activeProjectId || (selectedProjectIds.length === 1 ? selectedProjectIds[0] : null);
  const { enabled, phase, processedCount, todoCount, toggle } = useAutopilot(projectId);

  const getStatusText = () => {
    if (!enabled) return t('autopilot');
    if (phase === 'planning') return t('autopilotPlanning');
    if (phase === 'processing') {
      const total = processedCount + todoCount;
      if (total > 0) return t('autopilotProgress', { processed: processedCount, total });
      return t('autopilotOn');
    }
    return t('autopilotIdle');
  };

  return (
    <button
      onClick={toggle}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-colors',
        enabled
          ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 hover:bg-green-100 dark:hover:bg-green-950/50'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
      )}
    >
      <Zap
        className={cn(
          'h-3.5 w-3.5',
          enabled && phase !== 'idle' && 'animate-pulse'
        )}
      />
      <span>{getStatusText()}</span>
    </button>
  );
}
