'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, GitBranch } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSocket } from '@/hooks/use-socket';
import { cn } from '@/lib/utils';
import type { UsageStats } from '@/lib/usage-tracker';
import type { GitStats } from '@/lib/git-stats-collector';
import { StatusLineTokenCostDisplay } from './status-line-token-cost-display';
import { StatusLineWorkflowTreeDisplay, type WorkflowData } from './status-line-workflow-tree-display';

interface StatusLineProps {
  taskId: string;
  currentAttemptId: string | null;
  className?: string;
}

/**
 * StatusLine — real-time tracking bar shown below the task input.
 *
 * Delegates rendering to:
 * - StatusLineTokenCostDisplay  (context gauge + token/cost/turns/duration)
 * - StatusLineWorkflowTreeDisplay  (collapsible subagent workflow tree)
 *
 * Data sources: socket events for the current attempt; persists last values
 * until the task changes.
 */
export function StatusLine({ taskId, currentAttemptId, className }: StatusLineProps) {
  const t = useTranslations('task');
  const socket = useSocket();
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [gitStats, setGitStats] = useState<GitStats | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowData | null>(null);

  // Reset when task changes
  useEffect(() => {
    setUsage(null);
    setGitStats(null);
    setWorkflow(null);
  }, [taskId]);

  // Subscribe to socket tracking events for the current attempt
  useEffect(() => {
    if (!socket || !currentAttemptId) return;

    console.log('[StatusLine] Subscribing to room for attemptId:', currentAttemptId);
    socket.emit('attempt:subscribe', { attemptId: currentAttemptId });

    const handleUsageUpdate = (data: { attemptId: string; usage: UsageStats }) => {
      console.log('[StatusLine] Usage update:', data);
      if (data.attemptId === currentAttemptId) setUsage(data.usage);
    };

    const handleWorkflowUpdate = (data: {
      attemptId: string;
      nodes: WorkflowData['nodes'];
      messages: WorkflowData['messages'];
      summary: WorkflowData['summary'];
    }) => {
      console.log('[StatusLine] Workflow update:', data);
      if (data.attemptId === currentAttemptId) {
        setWorkflow({ nodes: data.nodes, messages: data.messages, summary: data.summary });
      }
    };

    const handleGitStats = (data: { attemptId: string; stats: GitStats }) => {
      console.log('[StatusLine] Git stats:', data);
      if (data.attemptId === currentAttemptId) setGitStats(data.stats);
    };

    socket.on('status:usage', handleUsageUpdate);
    socket.on('status:workflow', handleWorkflowUpdate);
    socket.on('status:git', handleGitStats);

    return () => {
      socket.off('status:usage', handleUsageUpdate);
      socket.off('status:workflow', handleWorkflowUpdate);
      socket.off('status:git', handleGitStats);
    };
  }, [socket, currentAttemptId]);

  const hasData = usage || gitStats || workflow;
  const hasRunningAttempt = !!currentAttemptId;

  return (
    <div className={cn(
      'px-3 py-2 border-t bg-muted/20 text-xs text-muted-foreground',
      'flex items-center gap-4 flex-wrap',
      className
    )}>
      {!hasRunningAttempt && !hasData && (
        <div className="flex items-center gap-1.5 text-muted-foreground/50">
          <TrendingUp className="size-3.5" />
          <span>{t('noAttemptRunning')}</span>
        </div>
      )}

      {hasRunningAttempt && !hasData && (
        <div className="flex items-center gap-1.5 text-muted-foreground/50">
          <TrendingUp className="size-3.5 animate-pulse" />
          <span>{t('waitingForTracking')}</span>
        </div>
      )}

      {usage && <StatusLineTokenCostDisplay usage={usage} />}

      {gitStats && gitStats.filesChanged > 0 && (
        <div className="flex items-center gap-1.5">
          <GitBranch className="size-3.5" />
          <span className="font-medium text-green-600">+{gitStats.additions}</span>
          <span className="font-medium text-red-600">-{gitStats.deletions}</span>
          <span className="text-muted-foreground/70">
            ({gitStats.filesChanged} {gitStats.filesChanged === 1 ? t('file') : t('files')})
          </span>
        </div>
      )}

      {workflow && <StatusLineWorkflowTreeDisplay workflow={workflow} />}
    </div>
  );
}
