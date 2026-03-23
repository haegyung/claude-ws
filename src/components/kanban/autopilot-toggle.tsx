'use client';

import { useTranslations } from 'next-intl';
import { Zap } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAutopilot } from '@/hooks/use-autopilot';
import { useProjectStore } from '@/stores/project-store';
import { cn } from '@/lib/utils';
import { AutopilotModeInfoPopover } from './autopilot-mode-info-popover';

export function AutopilotToggle() {
  const t = useTranslations('kanban');
  const { activeProjectId, selectedProjectIds } = useProjectStore();
  const projectId = activeProjectId || (selectedProjectIds.length === 1 ? selectedProjectIds[0] : null);
  const { mode, phase, processedCount, todoCount, setMode } = useAutopilot(projectId);

  const getStatusText = () => {
    if (mode === 'off') return null;
    if (phase === 'processing') {
      const total = processedCount + todoCount;
      if (total > 0) return t('autopilotProgress', { processed: processedCount, total });
    }
    return null;
  };

  const statusText = getStatusText();

  // Color mapping: autonomous=green, ask=blue, off=muted
  const zapColor = mode === 'autonomous'
    ? 'text-green-600 dark:text-green-400'
    : mode === 'ask'
      ? 'text-blue-600 dark:text-blue-400'
      : 'text-muted-foreground';

  return (
    <div className="flex items-center gap-2">
      <Zap
        className={cn(
          'h-3.5 w-3.5',
          zapColor,
          mode !== 'off' && phase !== 'idle' && 'animate-pulse'
        )}
      />
      <Tabs value={mode} onValueChange={(v) => setMode(v as 'off' | 'autonomous' | 'ask')}>
        <TabsList className="h-7">
          <TabsTrigger value="off" className="text-xs px-2 py-0.5">
            {t('autopilotOff')}
          </TabsTrigger>
          <TabsTrigger
            value="autonomous"
            className={cn(
              'text-xs px-2 py-0.5',
              mode === 'autonomous' && '!bg-green-600 !text-white dark:!bg-green-600 dark:!text-white'
            )}
          >
            {t('autopilotAutonomous')}
          </TabsTrigger>
          <TabsTrigger
            value="ask"
            className={cn(
              'text-xs px-2 py-0.5',
              mode === 'ask' && '!bg-blue-600 !text-white dark:!bg-blue-600 dark:!text-white'
            )}
          >
            {t('autopilotAsk')}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {statusText && (
        <span className="text-xs text-muted-foreground">{statusText}</span>
      )}
      <AutopilotModeInfoPopover />
    </div>
  );
}
