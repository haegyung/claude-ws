import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { useTaskStore } from '@/stores/task-store';
import { useProjectStore } from '@/stores/project-store';
import { useAttachmentStore } from '@/stores/attachment-store';
import { useModelStore } from '@/stores/model-store';
import { useAttemptStream } from '@/hooks/use-attempt-stream';
import { useTranslations } from 'next-intl';
import type { PendingFile } from '@/types';

interface UseTaskAttemptStreamHandlerOptions {
  taskId: string | undefined;
  /** Called after startAttempt / interruptAndSend to update parent's currentAttemptFiles */
  onAttemptFiles?: (files: PendingFile[]) => void;
}

/**
 * Encapsulates useAttemptStream wiring + pending-auto-start logic for a task.
 * Used by TaskDetailPanel and FloatingChatWindow to keep those files lean.
 */
export function useTaskAttemptStreamHandler(
  taskId: string | undefined,
  {
    taskStatus,
    taskChatInit,
    taskLastModel,
    taskLastProvider,
    taskDescription,
    pendingAutoStartTask,
    pendingAutoStartPrompt,
    pendingAutoStartFileIds,
  }: {
    taskStatus: string;
    taskChatInit: boolean;
    taskLastModel?: string | null;
    taskLastProvider?: string | null;
    taskDescription?: string | null;
    pendingAutoStartTask: string | null;
    pendingAutoStartPrompt: string | null;
    pendingAutoStartFileIds: string[] | null;
  }
) {
  const t = useTranslations('chat');
  const { updateTaskStatus, setTaskChatInit, moveTaskToInProgress, setPendingAutoStartTask } = useTaskStore();
  const { projects, activeProjectId, selectedProjectIds } = useProjectStore();
  const { getPendingFiles, clearFiles } = useAttachmentStore();
  const { getTaskModel, getTaskProvider } = useModelStore();

  const [hasSentFirstMessage, setHasSentFirstMessage] = useState(false);
  const [currentAttemptFiles, setCurrentAttemptFiles] = useState<PendingFile[]>([]);
  const lastCompletedTaskRef = useRef<string | null>(null);
  const hasAutoStartedRef = useRef(false);
  // Defer "In Review" move until isRunning is actually false (the source of truth)
  const pendingReviewTaskRef = useRef<string | null>(null);
  const isRunningRef = useRef(false);

  // Check if autopilot is active — if so, autopilot owns the "in_review" transition
  const currentProjectId = activeProjectId || selectedProjectIds[0];
  const isAutopilotActive = currentProjectId
    ? projects.some(p => p.id === currentProjectId && p.autopilotMode && p.autopilotMode !== 'off')
    : false;

  const handleTaskComplete = useCallback((completedTaskId: string) => {
    if (lastCompletedTaskRef.current === completedTaskId) return;
    lastCompletedTaskRef.current = completedTaskId;
    // When autopilot is active, it manages the in_review transition
    // (including validation). Frontend must not race with it.
    if (isAutopilotActive) return;
    // Only move to review if client confirms the agent stopped running.
    // If still running, defer — the useEffect below will pick it up.
    if (isRunningRef.current) {
      pendingReviewTaskRef.current = completedTaskId;
      return;
    }
    updateTaskStatus(completedTaskId, 'in_review');
    toast.success(t('taskCompleted'), { description: t('movedToReview') });
  }, [updateTaskStatus, t, isAutopilotActive]);

  const stream = useAttemptStream({ taskId, onComplete: handleTaskComplete });
  const { startAttempt, interruptAndSend, isRunning, isConnected } = stream;

  // Keep isRunningRef in sync so the callback always reads the latest value
  isRunningRef.current = isRunning;

  // When isRunning transitions to false, flush any deferred "In Review" move
  useEffect(() => {
    if (!isRunning && pendingReviewTaskRef.current && !isAutopilotActive) {
      const taskToReview = pendingReviewTaskRef.current;
      pendingReviewTaskRef.current = null;
      updateTaskStatus(taskToReview, 'in_review');
      toast.success(t('taskCompleted'), { description: t('movedToReview') });
    }
  }, [isRunning, updateTaskStatus, t, isAutopilotActive]);

  // Auto-start when pendingAutoStartTask matches this task
  useEffect(() => {
    if (!taskId) return;
    if (
      pendingAutoStartTask &&
      taskId === pendingAutoStartTask &&
      !hasAutoStartedRef.current &&
      !isRunning &&
      isConnected &&
      (pendingAutoStartPrompt || taskDescription)
    ) {
      hasAutoStartedRef.current = true;
      if (taskStatus !== 'in_progress') moveTaskToInProgress(taskId);
      if (!taskChatInit) { setTaskChatInit(taskId, true); setHasSentFirstMessage(true); }
      const fileIds = pendingAutoStartFileIds || undefined;
      const pendingFiles = getPendingFiles(taskId);
      setCurrentAttemptFiles(pendingFiles);
      setTimeout(() => {
        if (!isRunning && hasAutoStartedRef.current && taskId === pendingAutoStartTask) {
          const promptToSend = pendingAutoStartPrompt || taskDescription!;
          const promptToDisplay = pendingAutoStartPrompt ? taskDescription! : undefined;
          startAttempt(taskId, promptToSend, promptToDisplay, fileIds, getTaskModel(taskId, taskLastModel), getTaskProvider(taskId, taskLastProvider));
          clearFiles(taskId);
        }
        setPendingAutoStartTask(null);
      }, 50);
    }
    if (taskId !== pendingAutoStartTask) hasAutoStartedRef.current = false;
  }, [pendingAutoStartTask, pendingAutoStartPrompt, pendingAutoStartFileIds, taskId, isRunning, isConnected, taskStatus, taskChatInit, taskDescription, taskLastModel, taskLastProvider, setPendingAutoStartTask, startAttempt, setTaskChatInit, moveTaskToInProgress, getPendingFiles, clearFiles, getTaskModel, getTaskProvider]);

  const handlePromptSubmit = (prompt: string, displayPrompt?: string, fileIds?: string[]) => {
    if (!taskId) return;
    if (taskStatus !== 'in_progress') moveTaskToInProgress(taskId);
    if (!taskChatInit && !hasSentFirstMessage) { setTaskChatInit(taskId, true); setHasSentFirstMessage(true); }
    lastCompletedTaskRef.current = null;
    const pendingFiles = getPendingFiles(taskId);
    setCurrentAttemptFiles(pendingFiles);
    startAttempt(taskId, prompt, displayPrompt, fileIds, getTaskModel(taskId, taskLastModel), getTaskProvider(taskId, taskLastProvider));
  };

  const handleInterruptAndSend = (prompt: string, displayPrompt?: string, fileIds?: string[]) => {
    if (!taskId) return;
    if (taskStatus !== 'in_progress') moveTaskToInProgress(taskId);
    if (!taskChatInit && !hasSentFirstMessage) { setTaskChatInit(taskId, true); setHasSentFirstMessage(true); }
    lastCompletedTaskRef.current = null;
    const pendingFiles = getPendingFiles(taskId);
    setCurrentAttemptFiles(pendingFiles);
    interruptAndSend(taskId, prompt, displayPrompt, fileIds, getTaskModel(taskId, taskLastModel), getTaskProvider(taskId, taskLastProvider));
  };

  const resetForNewTask = () => {
    setHasSentFirstMessage(false);
    setCurrentAttemptFiles([]);
    lastCompletedTaskRef.current = null;
    hasAutoStartedRef.current = false;
    pendingReviewTaskRef.current = null;
  };

  return {
    ...stream,
    hasSentFirstMessage,
    currentAttemptFiles,
    handlePromptSubmit,
    handleInterruptAndSend,
    resetForNewTask,
  };
}
