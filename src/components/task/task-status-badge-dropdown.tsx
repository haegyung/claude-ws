'use client';

import { ChevronDown, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { TaskStatus } from '@/types';

const STATUS_CONFIG: Record<TaskStatus, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  todo: { label: 'todo', variant: 'outline' },
  in_progress: { label: 'inProgress', variant: 'secondary' },
  in_review: { label: 'inReview', variant: 'default' },
  done: { label: 'done', variant: 'default' },
  cancelled: { label: 'cancelled', variant: 'destructive' },
};

const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'cancelled'];

interface TaskStatusBadgeDropdownProps {
  currentStatus: TaskStatus;
  showDropdown: boolean;
  onToggleDropdown: () => void;
  onSelectStatus: (status: TaskStatus) => void;
}

/**
 * Status badge button with an inline dropdown to change task status.
 * Used in both TaskDetailPanel header and FloatingChatWindow title bar.
 */
export function TaskStatusBadgeDropdown({
  currentStatus,
  showDropdown,
  onToggleDropdown,
  onSelectStatus,
}: TaskStatusBadgeDropdownProps) {
  const tk = useTranslations('kanban');
  const config = STATUS_CONFIG[currentStatus];
  const label = tk(config.label as any);

  return (
    <div className="relative">
      <button
        onClick={onToggleDropdown}
        className="flex items-center gap-1 hover:opacity-80 transition-opacity"
      >
        <Badge variant={config.variant} className="cursor-pointer">
          {label}
        </Badge>
        <ChevronDown className="size-3 text-muted-foreground" />
      </button>

      {showDropdown && (
        <div className="absolute top-full left-0 mt-1.5 z-[9999] bg-popover border rounded-lg shadow-lg min-w-[140px] py-1 overflow-hidden">
          {STATUSES.map((status) => (
            <button
              key={status}
              onClick={() => onSelectStatus(status)}
              className={cn(
                'w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between gap-2',
                status === currentStatus && 'bg-accent/50'
              )}
            >
              <span className="flex items-center gap-2">
                <Badge variant={STATUS_CONFIG[status].variant} className="text-xs">
                  {tk(STATUS_CONFIG[status].label as any)}
                </Badge>
              </span>
              {status === currentStatus && (
                <Check className="size-4 text-primary" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
