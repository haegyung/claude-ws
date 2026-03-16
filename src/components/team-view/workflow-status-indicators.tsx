'use client';

/**
 * Shared status indicator components for workflow/team-view.
 * Extracted from team-tree-sidebar, task-list-tab, and agent-detail-tab
 * to avoid duplication.
 */

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Status icon for subagent nodes (tree sidebar, etc.) */
export function AgentStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <span className="text-green-500 text-xs shrink-0">&#10003;</span>;
    case 'in_progress':
      return <span className="text-blue-500 text-xs shrink-0 animate-pulse">&#9679;</span>;
    case 'failed':
      return <span className="text-red-500 text-xs shrink-0">&#10007;</span>;
    case 'orphaned':
      return <span className="text-yellow-500 text-xs shrink-0">&#8856;</span>;
    default:
      return <span className="text-muted-foreground text-xs shrink-0">&#9675;</span>;
  }
}

/** Status icon for tracked tasks */
export function TaskStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <span className="text-green-500 text-xs">&#10003;</span>;
    case 'in_progress':
      return <span className="text-blue-500 text-xs animate-pulse">&#9679;</span>;
    case 'deleted':
      return <span className="text-red-500 text-xs">&#10007;</span>;
    default:
      return <span className="text-muted-foreground text-xs">&#9675;</span>;
  }
}

const AGENT_STATUS_VARIANTS: Record<string, { label: string; className: string }> = {
  completed: { label: 'Completed', className: 'bg-green-500/10 text-green-600 border-green-500/20' },
  in_progress: { label: 'Running', className: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  failed: { label: 'Failed', className: 'bg-red-500/10 text-red-600 border-red-500/20' },
  orphaned: { label: 'Orphaned', className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' },
  pending: { label: 'Pending', className: 'bg-muted text-muted-foreground' },
};

/** Status badge for agent detail view */
export function AgentStatusBadge({ status }: { status: string }) {
  const v = AGENT_STATUS_VARIANTS[status] || AGENT_STATUS_VARIANTS.pending;
  return (
    <Badge variant="outline" className={cn('text-[10px]', v.className)}>
      {v.label}
    </Badge>
  );
}

const TASK_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  in_progress: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  completed: 'bg-green-500/10 text-green-600 border-green-500/20',
  deleted: 'bg-red-500/10 text-red-500 border-red-500/20',
};

/** Status badge for task list */
export function TaskStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn('text-[9px] px-1 py-0', TASK_STATUS_STYLES[status])}>
      {status}
    </Badge>
  );
}
