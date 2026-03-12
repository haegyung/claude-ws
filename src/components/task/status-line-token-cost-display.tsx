'use client';

import { TrendingUp, Clock } from 'lucide-react';
import { Gauge } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { UsageStats } from '@/lib/usage-tracker';
import { formatDuration, formatTokenCount } from './status-line-format-utils';

interface StatusLineTokenCostDisplayProps {
  usage: UsageStats;
}

/**
 * Renders the context usage gauge and token/cost/turn/duration metrics for StatusLine.
 */
export function StatusLineTokenCostDisplay({ usage }: StatusLineTokenCostDisplayProps) {
  const t = useTranslations('task');

  return (
    <>
      {/* Context Usage Section */}
      {usage.contextUsed > 0 && (
        <div className="flex items-center gap-1.5">
          <Gauge className={cn(
            'size-3.5',
            usage.contextHealth?.status === 'HEALTHY' && 'text-green-500',
            usage.contextHealth?.status === 'WARNING' && 'text-yellow-500',
            usage.contextHealth?.status === 'CRITICAL' && 'text-orange-500',
            usage.contextHealth?.status === 'EMERGENCY' && 'text-red-500'
          )} />
          <span className={cn(
            'font-medium',
            usage.contextHealth?.status === 'HEALTHY' && 'text-green-600',
            usage.contextHealth?.status === 'WARNING' && 'text-yellow-600',
            usage.contextHealth?.status === 'CRITICAL' && 'text-orange-600',
            usage.contextHealth?.status === 'EMERGENCY' && 'text-red-600'
          )}>
            {usage.contextPercentage.toFixed(1)}%
          </span>
          <span className="text-muted-foreground/70">
            of {formatTokenCount(usage.contextLimit)}
          </span>
          {usage.contextHealth && (
            <span className={cn(
              'text-xs px-1.5 py-0.5 rounded',
              usage.contextHealth.status === 'HEALTHY' && 'bg-green-500/10 text-green-600',
              usage.contextHealth.status === 'WARNING' && 'bg-yellow-500/10 text-yellow-600',
              usage.contextHealth.status === 'CRITICAL' && 'bg-orange-500/10 text-orange-600',
              usage.contextHealth.status === 'EMERGENCY' && 'bg-red-500/10 text-red-600'
            )}>
              {usage.contextHealth.status}
            </span>
          )}
        </div>
      )}

      {/* Token count, cost, turns and duration */}
      <div className="flex items-center gap-1.5">
        <TrendingUp className="size-3.5" />
        <span className="font-medium">
          {usage.totalTokens.toLocaleString()} {t('tokens')}
        </span>
        {usage.totalCostUSD > 0 && (
          <span className="text-muted-foreground/70">
            (${usage.totalCostUSD.toFixed(4)})
          </span>
        )}
        {usage.numTurns > 0 && (
          <span className="text-muted-foreground/70">
            · {usage.numTurns} {usage.numTurns === 1 ? t('turn') : t('turns')}
          </span>
        )}
        {usage.durationMs > 0 && (
          <span className="text-muted-foreground/70 flex items-center gap-1">
            · <Clock className="size-3" /> {formatDuration(usage.durationMs)}
          </span>
        )}
      </div>
    </>
  );
}
