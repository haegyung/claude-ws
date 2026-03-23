'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Separator } from '@/components/ui/separator';
import { ResizeHandle } from '@/components/ui/resize-handle';
import { PromptInput, PromptInputRef } from './prompt-input';
import { ConversationView } from './conversation-view';
import { InteractiveCommandOverlay, QuestionPrompt } from './interactive-command';
import { ShellToggleBar, ShellExpandedPanel } from './task-shell-indicator';
import { TaskDetailPanelHeader } from './task-detail-panel-header';
import { useTaskAttemptStreamHandler } from './use-task-attempt-stream-handler';
import { useResizable } from '@/hooks/use-resizable';
import { useShellStore } from '@/stores/shell-store';
import { useTaskStore } from '@/stores/task-store';
import { useAttachmentStore } from '@/stores/attachment-store';
import { useProjectStore } from '@/stores/project-store';
import { usePanelLayoutStore, PANEL_CONFIGS } from '@/stores/panel-layout-store';
import { useFloatingWindowsStore } from '@/stores/floating-windows-store';
import { useIsMobileViewport } from '@/hooks/use-mobile-viewport';
import { cn } from '@/lib/utils';
import type { TaskStatus } from '@/types';

const { minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH } = PANEL_CONFIGS.taskDetail;

interface TaskDetailPanelProps {
  className?: string;
}

export function TaskDetailPanel({ className }: TaskDetailPanelProps) {
  const t = useTranslations('chat');
  const { selectedTask, setSelectedTask, updateTaskStatus, setTaskChatInit, pendingAutoStartTask, pendingAutoStartPrompt, pendingAutoStartFileIds, setPendingAutoStartTask, moveTaskToInProgress, renameTask, updateTaskDescription } = useTaskStore();
  const { activeProjectId, selectedProjectIds, projects } = useProjectStore();
  const { widths, setWidth: setPanelWidth } = usePanelLayoutStore();
  const { openWindow } = useFloatingWindowsStore();
  const isMobile = useIsMobileViewport();

  const [conversationKey, setConversationKey] = useState(0);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [shellPanelExpanded, setShellPanelExpanded] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editDescriptionValue, setEditDescriptionValue] = useState('');

  const panelRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<PromptInputRef>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionTextareaRef = useRef<HTMLTextAreaElement>(null);
  const { shells } = useShellStore();

  // Declared early so useEffect hooks can reference it before the early return
  const currentProjectId = activeProjectId || selectedProjectIds[0] || selectedTask?.projectId;

  const { width, isResizing, handleMouseDown: handleResizeMouseDown } = useResizable({
    initialWidth: widths.taskDetail,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
    direction: 'left',
    onWidthChange: (w) => setPanelWidth('taskDetail', w),
  });

  const { messages, cancelAttempt, isRunning, currentAttemptId, currentPrompt, activeQuestion, answerQuestion, cancelQuestion, refetchQuestion, hasSentFirstMessage, currentAttemptFiles, handlePromptSubmit, handleInterruptAndSend, resetForNewTask } = useTaskAttemptStreamHandler(
    selectedTask?.id,
    {
      taskStatus: selectedTask?.status ?? 'todo',
      taskChatInit: selectedTask?.chatInit ?? false,
      taskLastModel: selectedTask?.lastModel,
      taskLastProvider: selectedTask?.lastProvider,
      taskDescription: selectedTask?.description,
      pendingAutoStartTask,
      pendingAutoStartPrompt,
      pendingAutoStartFileIds,
    }
  );

  // Restore pending file attachments from DB when task has pendingFileIds
  // Only restore if task hasn't started yet (chatInit=false) to avoid re-inserting files on reopen
  const { restoreFromDb } = useAttachmentStore();
  useEffect(() => {
    if (selectedTask?.pendingFileIds && !selectedTask.chatInit) {
      try {
        const ids = JSON.parse(selectedTask.pendingFileIds) as string[];
        if (ids.length > 0) restoreFromDb(selectedTask.id, ids);
      } catch { /* ignore */ }
    }
  }, [selectedTask?.id, selectedTask?.pendingFileIds, selectedTask?.chatInit, restoreFromDb]);

  // Close status dropdown on outside click
  useEffect(() => {
    if (!showStatusDropdown) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setShowStatusDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showStatusDropdown]);

  // Reset UI state when selected task changes
  useEffect(() => {
    console.log('[TaskDetailPanel] selectedTask changed:', selectedTask?.id, '→ resetting state');
    setConversationKey(prev => prev + 1);
    setShowStatusDropdown(false);
    setShellPanelExpanded(false);
    setIsEditingTitle(false);
    setEditTitleValue('');
    setIsEditingDescription(false);
    setEditDescriptionValue('');
    resetForNewTask();
    setTimeout(() => promptInputRef.current?.focus(), 100);
  }, [selectedTask?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rewind-complete event
  useEffect(() => {
    const handler = () => { setConversationKey(prev => prev + 1); setTimeout(() => promptInputRef.current?.focus(), 100); };
    window.addEventListener('rewind-complete', handler);
    return () => window.removeEventListener('rewind-complete', handler);
  }, []);

  // Arrow-down from input opens shell panel
  const hasShells = currentProjectId ? Array.from(shells.values()).some(s => s.projectId === currentProjectId) : false;
  useEffect(() => {
    if (shellPanelExpanded || !hasShells) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === 'ArrowDown' && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') && !e.shiftKey && !e.ctrlKey && !e.metaKey && panelRef.current?.contains(target)) {
        const input = target as HTMLTextAreaElement | HTMLInputElement;
        if (input.selectionStart === input.value.length) { e.preventDefault(); setShellPanelExpanded(true); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [shellPanelExpanded, hasShells]);

  if (!selectedTask) return null;

  const currentProjectPath = currentProjectId ? projects.find(p => p.id === currentProjectId)?.path : undefined;

  const handleSaveTitle = async () => {
    const trimmed = editTitleValue.trim();
    if (trimmed && trimmed !== selectedTask.title) { try { await renameTask(selectedTask.id, trimmed); } catch { /* store reverts */ } }
    setIsEditingTitle(false);
  };

  const handleSaveDescription = async () => {
    const trimmed = editDescriptionValue.trim();
    const newValue = trimmed || null;
    if (newValue !== (selectedTask.description || null)) { try { await updateTaskDescription(selectedTask.id, newValue); } catch { /* store reverts */ } }
    setIsEditingDescription(false);
  };

  return (
    <div
      ref={panelRef}
      className={cn('h-full bg-background border-l flex flex-col shrink-0 relative overflow-x-hidden', isMobile && 'fixed inset-0 z-50 border-l-0', isResizing && 'select-none', className)}
      style={{ width: isMobile ? '100vw' : `${width}px`, maxWidth: isMobile ? '100vw' : undefined }}
    >
      {!isMobile && <ResizeHandle position="left" onMouseDown={handleResizeMouseDown} isResizing={isResizing} />}
      <TaskDetailPanelHeader
        title={selectedTask.title} description={selectedTask.description} status={selectedTask.status}
        showStatusDropdown={showStatusDropdown} onToggleStatusDropdown={() => setShowStatusDropdown(!showStatusDropdown)}
        onSelectStatus={async (s: TaskStatus) => { setShowStatusDropdown(false); if (s !== selectedTask.status) await updateTaskStatus(selectedTask.id, s); }}
        onClose={() => setSelectedTask(null)}
        onDetach={() => { openWindow(selectedTask.id, 'chat', selectedTask.projectId); setSelectedTask(null); }}
        isMobile={isMobile}
        isEditingTitle={isEditingTitle} editTitleValue={editTitleValue} onEditTitleChange={setEditTitleValue}
        onStartEditTitle={() => { setEditTitleValue(selectedTask.title); setIsEditingTitle(true); setTimeout(() => titleInputRef.current?.focus(), 0); }}
        onSaveTitle={handleSaveTitle} onCancelEditTitle={() => { setIsEditingTitle(false); setEditTitleValue(''); }}
        titleInputRef={titleInputRef}
        isEditingDescription={isEditingDescription} editDescriptionValue={editDescriptionValue} onEditDescriptionChange={setEditDescriptionValue}
        onStartEditDescription={() => { setEditDescriptionValue(selectedTask.description || ''); setIsEditingDescription(true); setTimeout(() => descriptionTextareaRef.current?.focus(), 0); }}
        onSaveDescription={handleSaveDescription} onCancelEditDescription={() => { setIsEditingDescription(false); setEditDescriptionValue(''); }}
        descriptionTextareaRef={descriptionTextareaRef}
      />
      <div className="flex-1 overflow-hidden min-w-0 relative z-0">
        <ConversationView
          key={conversationKey} taskId={selectedTask.id} currentMessages={messages}
          currentAttemptId={currentAttemptId} currentPrompt={currentPrompt || undefined}
          currentFiles={isRunning ? currentAttemptFiles : undefined} isRunning={isRunning}
          activeQuestion={activeQuestion}
          onOpenQuestion={(isRunning || activeQuestion) ? () => { if (!activeQuestion) refetchQuestion(); } : undefined}
        />
      </div>
      <Separator />
      <div className="relative">
        {activeQuestion ? (
          <div className="border-t bg-muted/30">
            <QuestionPrompt key={activeQuestion.toolUseId} questions={activeQuestion.questions}
              onAnswer={(answers) => { if (selectedTask.status !== 'in_progress') moveTaskToInProgress(selectedTask.id); answerQuestion(activeQuestion.questions, answers as Record<string, string>); }}
              onCancel={cancelQuestion} />
          </div>
        ) : shellPanelExpanded && currentProjectId ? (
          <ShellExpandedPanel projectId={currentProjectId} onClose={() => setShellPanelExpanded(false)} />
        ) : (
          <div className="p-3 sm:p-4">
            <PromptInput
              key={`${selectedTask.id}-${hasSentFirstMessage ? 'sent' : 'initial'}`} ref={promptInputRef}
              onSubmit={handlePromptSubmit} onCancel={cancelAttempt} onInterruptAndSend={handleInterruptAndSend}
              isStreaming={isRunning} taskId={selectedTask.id} taskLastModel={selectedTask.lastModel}
              taskLastProvider={selectedTask.lastProvider}
              projectPath={currentProjectPath}
              initialValue={!hasSentFirstMessage && !selectedTask.chatInit && !pendingAutoStartTask && selectedTask.description ? selectedTask.description : undefined}
            />
            <InteractiveCommandOverlay />
          </div>
        )}
      </div>
      {currentProjectId && (
        <ShellToggleBar projectId={currentProjectId} isExpanded={shellPanelExpanded} onToggle={() => setShellPanelExpanded(!shellPanelExpanded)} />
      )}
    </div>
  );
}
