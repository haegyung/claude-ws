'use client';

import { useRef } from 'react';
import { X, Minimize2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { TaskStatusBadgeDropdown } from './task-status-badge-dropdown';
import type { TaskStatus } from '@/types';

interface TaskDetailPanelHeaderProps {
  title: string;
  description: string | null | undefined;
  status: TaskStatus;
  showStatusDropdown: boolean;
  onToggleStatusDropdown: () => void;
  onSelectStatus: (status: TaskStatus) => void;
  onClose: () => void;
  onDetach: () => void;
  isMobile: boolean;
  // Title editing
  isEditingTitle: boolean;
  editTitleValue: string;
  onEditTitleChange: (value: string) => void;
  onStartEditTitle: () => void;
  onSaveTitle: () => void;
  onCancelEditTitle: () => void;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
  // Description editing
  isEditingDescription: boolean;
  editDescriptionValue: string;
  onEditDescriptionChange: (value: string) => void;
  onStartEditDescription: () => void;
  onSaveDescription: () => void;
  onCancelEditDescription: () => void;
  descriptionTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * Header section for TaskDetailPanel: status badge+dropdown, title (editable),
 * description (editable), close and detach-to-floating buttons.
 */
export function TaskDetailPanelHeader({
  title,
  description,
  status,
  showStatusDropdown,
  onToggleStatusDropdown,
  onSelectStatus,
  onClose,
  onDetach,
  isMobile,
  isEditingTitle,
  editTitleValue,
  onEditTitleChange,
  onStartEditTitle,
  onSaveTitle,
  onCancelEditTitle,
  titleInputRef,
  isEditingDescription,
  editDescriptionValue,
  onEditDescriptionChange,
  onStartEditDescription,
  onSaveDescription,
  onCancelEditDescription,
  descriptionTextareaRef,
}: TaskDetailPanelHeaderProps) {
  const t = useTranslations('chat');

  return (
    <div className="px-3 sm:px-4 py-2 border-b w-full max-w-full overflow-visible relative z-10">
      {/* Top row: status badge + action buttons */}
      <div className="flex items-center justify-between gap-2 mb-1 w-full">
        <div className="flex items-center gap-2">
          <TaskStatusBadgeDropdown
            currentStatus={status}
            showDropdown={showStatusDropdown}
            onToggleDropdown={onToggleStatusDropdown}
            onSelectStatus={onSelectStatus}
          />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isMobile && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onDetach}
              title={t('detachToFloating')}
            >
              <Minimize2 className="size-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Editable title */}
      {isEditingTitle ? (
        <input
          ref={titleInputRef}
          type="text"
          value={editTitleValue}
          onChange={(e) => onEditTitleChange(e.target.value)}
          onBlur={onSaveTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onSaveTitle(); }
            else if (e.key === 'Escape') { onCancelEditTitle(); }
          }}
          className="text-base sm:text-lg font-semibold w-full bg-transparent border-b border-primary/50 outline-none py-0"
        />
      ) : (
        <h2
          className="text-base sm:text-lg font-semibold line-clamp-2 cursor-text"
          onDoubleClick={onStartEditTitle}
        >
          {title}
        </h2>
      )}

      {/* Editable description */}
      {isEditingDescription ? (
        <textarea
          ref={descriptionTextareaRef}
          value={editDescriptionValue}
          onChange={(e) => onEditDescriptionChange(e.target.value)}
          onBlur={onSaveDescription}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSaveDescription(); }
            else if (e.key === 'Escape') { onCancelEditDescription(); }
          }}
          rows={3}
          className="mt-1 text-sm text-muted-foreground w-full bg-transparent border border-border rounded-md p-2 outline-none resize-y"
          placeholder="Add description..."
        />
      ) : (
        <p
          className="mt-1 text-sm text-muted-foreground line-clamp-3 cursor-text min-h-[1.25rem]"
          onClick={onStartEditDescription}
        >
          {description || 'Add description...'}
        </p>
      )}
    </div>
  );
}
