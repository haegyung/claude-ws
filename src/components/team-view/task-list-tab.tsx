'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { TrackedTask } from '@/lib/workflow-tracker';
import type { WorkflowEntry } from '@/stores/workflow-store';
import { TaskStatusIcon, TaskStatusBadge } from './workflow-status-indicators';

interface TaskListTabProps {
  workflows: Map<string, WorkflowEntry>;
}

export function TaskListTab({ workflows }: TaskListTabProps) {
  // Merge all tasks from all workflows
  const allTasks: TrackedTask[] = [];
  for (const entry of workflows.values()) {
    allTasks.push(...entry.tasks);
  }

  if (allTasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">No tracked tasks</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-1">
        {allTasks.map((task, idx) => (
          <div
            key={task.id || idx}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded text-xs',
              task.status === 'deleted' && 'opacity-50',
            )}
          >
            <TaskStatusIcon status={task.status} />
            <span
              className={cn(
                'flex-1 truncate',
                task.status === 'deleted' && 'line-through',
              )}
            >
              {task.subject}
            </span>
            {task.owner && (
              <span className="text-muted-foreground/60 text-[10px] shrink-0">
                {task.owner}
              </span>
            )}
            <TaskStatusBadge status={task.status} />
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
