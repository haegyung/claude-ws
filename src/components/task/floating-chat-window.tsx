'use client';

import { useState, useEffect, useRef } from 'react';
import { Maximize2, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { PromptInput, PromptInputRef } from './prompt-input';
import { ConversationView } from './conversation-view';
import { InteractiveCommandOverlay, QuestionPrompt } from './interactive-command';
import { ShellToggleBar, ShellExpandedPanel } from './task-shell-indicator';
import { TaskStatusBadgeDropdown } from './task-status-badge-dropdown';
import { useTaskAttemptStreamHandler } from './use-task-attempt-stream-handler';
import { useShellStore } from '@/stores/shell-store';
import { useTaskStore } from '@/stores/task-store';
import { useProjectStore } from '@/stores/project-store';
import { DetachableWindow } from '@/components/ui/detachable-window';
import { useIsMobileViewport } from '@/hooks/use-mobile-viewport';
import type { Task, TaskStatus } from '@/types';

interface FloatingChatWindowProps {
  task: Task;
  zIndex: number;
  onClose: () => void;
  onMaximize: () => void;
  onFocus: () => void;
}

export function FloatingChatWindow({ task, zIndex, onClose, onMaximize, onFocus }: FloatingChatWindowProps) {
  const t = useTranslations('chat');
  const tCommon = useTranslations('common');
  const isMobile = useIsMobileViewport();
  const { updateTaskStatus, moveTaskToInProgress, renameTask, pendingAutoStartTask, pendingAutoStartPrompt, pendingAutoStartFileIds } = useTaskStore();
  const { activeProjectId, selectedProjectIds, projects } = useProjectStore();
  const { shells } = useShellStore();

  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [shellPanelExpanded, setShellPanelExpanded] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');

  const promptInputRef = useRef<PromptInputRef>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const { messages, cancelAttempt, isRunning, currentAttemptId, currentPrompt, activeQuestion, answerQuestion, cancelQuestion, refetchQuestion, hasSentFirstMessage, currentAttemptFiles, handlePromptSubmit, handleInterruptAndSend } = useTaskAttemptStreamHandler(
    task.id,
    {
      taskStatus: task.status,
      taskChatInit: task.chatInit,
      taskLastModel: task.lastModel,
      taskDescription: task.description,
      pendingAutoStartTask,
      pendingAutoStartPrompt,
      pendingAutoStartFileIds,
    }
  );

  const currentProjectId = activeProjectId || selectedProjectIds[0] || task.projectId;
  const currentProjectPath = currentProjectId ? projects.find(p => p.id === currentProjectId)?.path : undefined;
  const hasShells = currentProjectId ? Array.from(shells.values()).some(s => s.projectId === currentProjectId) : false;

  const handleSaveTitle = async () => {
    const trimmed = editTitleValue.trim();
    if (trimmed && trimmed !== task.title) { try { await renameTask(task.id, trimmed); } catch { /* store reverts */ } }
    setIsEditingTitle(false);
  };

  const renderFooter = () => (
    <>
      <Separator />
      <div className="relative">
        {activeQuestion ? (
          <div className="border-t bg-muted/30">
            <QuestionPrompt
              key={activeQuestion.toolUseId}
              questions={activeQuestion.questions}
              onAnswer={(answers) => {
                if (task.status !== 'in_progress') moveTaskToInProgress(task.id);
                answerQuestion(activeQuestion.questions, answers as Record<string, string>);
              }}
              onCancel={cancelQuestion}
            />
          </div>
        ) : shellPanelExpanded && currentProjectId ? (
          <ShellExpandedPanel projectId={currentProjectId} onClose={() => setShellPanelExpanded(false)} />
        ) : (
          <div className="p-3 sm:p-4">
            <PromptInput
              key={`${task.id}-${hasSentFirstMessage ? 'sent' : 'initial'}`}
              ref={promptInputRef}
              onSubmit={handlePromptSubmit}
              onCancel={cancelAttempt}
              onInterruptAndSend={handleInterruptAndSend}
              isStreaming={isRunning}
              taskId={task.id}
              taskLastModel={task.lastModel}
              projectPath={currentProjectPath}
              initialValue={!hasSentFirstMessage && !task.chatInit && task.description ? task.description : undefined}
            />
            <InteractiveCommandOverlay />
          </div>
        )}
      </div>
      {currentProjectId && (
        <ShellToggleBar projectId={currentProjectId} isExpanded={shellPanelExpanded} onToggle={() => setShellPanelExpanded(!shellPanelExpanded)} />
      )}
    </>
  );

  return (
    <DetachableWindow
      isOpen={true}
      onClose={onClose}
      initialSize={{ width: 500, height: 600 }}
      footer={renderFooter()}
      storageKey={`chat-${task.id}`}
      titleCenter={
        isEditingTitle ? (
          <input
            ref={titleInputRef}
            type="text"
            data-no-drag
            value={editTitleValue}
            onChange={(e) => setEditTitleValue(e.target.value)}
            onBlur={handleSaveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleSaveTitle(); }
              else if (e.key === 'Escape') { setIsEditingTitle(false); setEditTitleValue(''); }
            }}
            className="text-sm font-medium w-full bg-transparent border-b border-primary/50 outline-none text-center"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="flex items-center gap-1 cursor-grab active:cursor-grabbing">
            <span className="line-clamp-2">{task.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); setEditTitleValue(task.title); setIsEditingTitle(true); setTimeout(() => titleInputRef.current?.focus(), 0); }}
              onMouseDown={(e) => e.stopPropagation()}
              className="p-0.5 hover:bg-accent rounded transition-colors shrink-0 cursor-pointer"
              data-no-drag
              title={tCommon('editTitle')}
            >
              <Pencil className="size-3 text-muted-foreground" />
            </button>
          </div>
        )
      }
      zIndex={zIndex}
      onFocus={onFocus}
      title={
        <TaskStatusBadgeDropdown
          currentStatus={task.status}
          showDropdown={showStatusDropdown}
          onToggleDropdown={() => setShowStatusDropdown(!showStatusDropdown)}
          onSelectStatus={async (s: TaskStatus) => { setShowStatusDropdown(false); if (s !== task.status) await updateTaskStatus(task.id, s); }}
        />
      }
      headerEnd={
        !isMobile ? (
          <Button variant="ghost" size="icon-sm" onClick={onMaximize} title={t('maximizeToPanel')}>
            <Maximize2 className="size-4" />
          </Button>
        ) : undefined
      }
    >
      <div className="flex-1 overflow-hidden min-w-0 relative z-0">
        <ConversationView
          taskId={task.id}
          currentMessages={messages}
          currentAttemptId={currentAttemptId}
          currentPrompt={currentPrompt || undefined}
          currentFiles={isRunning ? currentAttemptFiles : undefined}
          isRunning={isRunning}
          activeQuestion={activeQuestion}
          onOpenQuestion={(isRunning || activeQuestion) ? () => { if (!activeQuestion) refetchQuestion(); } : undefined}
        />
      </div>
    </DetachableWindow>
  );
}
