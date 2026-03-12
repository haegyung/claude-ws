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
    taskDescription,
    pendingAutoStartTask,
    pendingAutoStartPrompt,
    pendingAutoStartFileIds,
  }: {
    taskStatus: string;
    taskChatInit: boolean;
    taskLastModel?: string | null;
    taskDescription?: string | null;
    pendingAutoStartTask: string | null;
    pendingAutoStartPrompt: string | null;
    pendingAutoStartFileIds: string[] | null;
  }
) {
  const t = useTranslations('chat');
  const { updateTaskStatus, setTaskChatInit, moveTaskToInProgress, setPendingAutoStartTask } = useTaskStore();
  const { getPendingFiles, clearFiles } = useAttachmentStore();
  const { getTaskModel } = useModelStore();

  const [hasSentFirstMessage, setHasSentFirstMessage] = useState(false);
  const [currentAttemptFiles, setCurrentAttemptFiles] = useState<PendingFile[]>([]);
  const lastCompletedTaskRef = useRef<string | null>(null);
  const hasAutoStartedRef = useRef(false);

  const handleTaskComplete = useCallback(async (completedTaskId: string) => {
    if (lastCompletedTaskRef.current === completedTaskId) return;
    lastCompletedTaskRef.current = completedTaskId;
    await updateTaskStatus(completedTaskId, 'in_review');
    toast.success(t('taskCompleted'), { description: t('movedToReview') });
  }, [updateTaskStatus, t]);

  const stream = useAttemptStream({ taskId, onComplete: handleTaskComplete });
  const { startAttempt, interruptAndSend, isRunning, isConnected } = stream;

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
          startAttempt(taskId, promptToSend, promptToDisplay, fileIds, getTaskModel(taskId, taskLastModel));
          clearFiles(taskId);
        }
        setPendingAutoStartTask(null);
      }, 50);
    }
    if (taskId !== pendingAutoStartTask) hasAutoStartedRef.current = false;
  }, [pendingAutoStartTask, pendingAutoStartPrompt, pendingAutoStartFileIds, taskId, isRunning, isConnected, taskStatus, taskChatInit, taskDescription, taskLastModel, setPendingAutoStartTask, startAttempt, setTaskChatInit, moveTaskToInProgress, getPendingFiles, clearFiles, getTaskModel]);

  const handlePromptSubmit = (prompt: string, displayPrompt?: string, fileIds?: string[]) => {
    if (!taskId) return;
    if (taskStatus !== 'in_progress') moveTaskToInProgress(taskId);
    if (!taskChatInit && !hasSentFirstMessage) { setTaskChatInit(taskId, true); setHasSentFirstMessage(true); }
    lastCompletedTaskRef.current = null;
    const pendingFiles = getPendingFiles(taskId);
    setCurrentAttemptFiles(pendingFiles);
    startAttempt(taskId, prompt, displayPrompt, fileIds, getTaskModel(taskId, taskLastModel));
  };

  const handleInterruptAndSend = (prompt: string, displayPrompt?: string, fileIds?: string[]) => {
    if (!taskId) return;
    if (taskStatus !== 'in_progress') moveTaskToInProgress(taskId);
    if (!taskChatInit && !hasSentFirstMessage) { setTaskChatInit(taskId, true); setHasSentFirstMessage(true); }
    lastCompletedTaskRef.current = null;
    const pendingFiles = getPendingFiles(taskId);
    setCurrentAttemptFiles(pendingFiles);
    interruptAndSend(taskId, prompt, displayPrompt, fileIds, getTaskModel(taskId, taskLastModel));
  };

  const resetForNewTask = () => {
    setHasSentFirstMessage(false);
    setCurrentAttemptFiles([]);
    lastCompletedTaskRef.current = null;
    hasAutoStartedRef.current = false;
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
