'use client';

import { cn } from '@/lib/utils';

export interface TrackedTaskItem {
  id: string;
  subject: string;
  status: 'pending' | 'in_progress' | 'completed' | 'deleted';
  owner?: string;
  activeForm?: string;
}

/** Renders tracked tasks (from TaskCreate/TaskUpdate) as a visual task dashboard */
export function TrackedTasksBlock({ tasks }: { tasks: TrackedTaskItem[] }) {
  if (!tasks.length) return null;

  const completed = tasks.filter(t => t.status === 'completed');
  const inProgress = tasks.filter(t => t.status === 'in_progress');
  const pending = tasks.filter(t => t.status === 'pending');
  const deleted = tasks.filter(t => t.status === 'deleted');
  const total = tasks.length - deleted.length;

  // Sort: in_progress first, then pending, then completed, then deleted
  const sorted = [...inProgress, ...pending, ...completed, ...deleted];

  return (
    <div className="rounded-lg border border-border overflow-hidden font-mono w-full max-w-full bg-zinc-900 dark:bg-zinc-950 my-3">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border/50 flex items-center justify-between">
        <span className="text-sm text-zinc-300 font-medium">
          Tasks
          <span className="text-zinc-500 ml-2 text-xs font-normal">
            {completed.length}/{total} done
          </span>
        </span>
        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          {inProgress.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="text-blue-400 animate-pulse">●</span> {inProgress.length} running
            </span>
          )}
          {pending.length > 0 && (
            <span>{pending.length} pending</span>
          )}
          {completed.length === total && total > 0 && (
            <span className="text-green-500 font-medium">All done ✓</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="h-1 bg-zinc-800">
          <div
            className="h-full bg-green-500/80 transition-all duration-500"
            style={{ width: `${(completed.length / total) * 100}%` }}
          />
        </div>
      )}

      {/* Task items */}
      <div className="px-3 py-2 space-y-0.5">
        {sorted.map((task, idx) => {
          const isCompleted = task.status === 'completed';
          const isInProgress = task.status === 'in_progress';
          const isDeleted = task.status === 'deleted';

          return (
            <div
              key={task.id}
              className={cn(
                'flex items-center gap-3 px-2 py-1.5 rounded-md transition-colors',
                isInProgress && 'bg-blue-500/5',
                isDeleted && 'opacity-30',
              )}
            >
              {/* Status icon */}
              <span className={cn(
                'shrink-0 text-sm',
                isCompleted && 'text-green-500',
                isInProgress && 'text-blue-400',
                isDeleted && 'text-red-400',
                !isCompleted && !isInProgress && !isDeleted && 'text-zinc-600'
              )}>
                {isCompleted ? '✓' : isDeleted ? '✗' : isInProgress ? '⟳' : '○'}
              </span>

              {/* Task content */}
              <span className={cn(
                'flex-1 text-[13px] leading-6',
                isCompleted && 'text-zinc-500 line-through',
                isInProgress && 'text-zinc-100',
                isDeleted && 'text-zinc-600 line-through',
                !isCompleted && !isInProgress && !isDeleted && 'text-zinc-400'
              )}>
                {isInProgress && task.activeForm ? task.activeForm : task.subject}
              </span>

              {/* Status label */}
              {isInProgress && (
                <span className="text-[10px] text-blue-400/70 shrink-0 animate-pulse">running</span>
              )}

              {/* Owner badge */}
              {task.owner && (
                <span className="text-zinc-600 text-[10px] shrink-0">
                  @{task.owner}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
