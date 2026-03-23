'use client';

import { useTranslations } from 'next-intl';
import { Columns3 } from 'lucide-react';
import { KANBAN_COLUMNS, TaskStatus } from '@/types';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface BoardColumnVisibilityFilterProps {
  hiddenColumns: TaskStatus[];
  onToggleColumn: (columnId: TaskStatus) => void;
}

export function BoardColumnVisibilityFilter({ hiddenColumns, onToggleColumn }: BoardColumnVisibilityFilterProps) {
  const t = useTranslations('kanban');

  return (
    <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="inline-flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-accent transition-colors">
            <Columns3 className="h-3.5 w-3.5" />
            <span>{t('columns')}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t('toggleColumns')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {KANBAN_COLUMNS.map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={!hiddenColumns.includes(column.id)}
              onCheckedChange={() => onToggleColumn(column.id)}
            >
              {t(column.titleKey)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
    </DropdownMenu>
  );
}
