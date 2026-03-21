/**
 * Task Store Mutation API Actions - HTTP patch/put actions for task status, reorder, rename, description, chatInit
 *
 * Contains: reorderTasks, updateTaskStatus, renameTask, updateTaskDescription,
 * setTaskChatInit, moveTaskToInProgress.
 * Basic CRUD actions live in task-store-api-actions.ts
 */

import type { Task, TaskStatus } from '@/types';
import { createLogger } from '@/lib/logger';
import type { TaskStoreSetFn, TaskStoreGetFn } from './task-store-api-actions';

const log = createLogger('TaskStore');

export async function reorderTasksAction(
  taskId: string,
  newStatus: TaskStatus,
  newPosition: number,
  set: TaskStoreSetFn,
  get: TaskStoreGetFn
): Promise<void> {
  const oldTasks = get().tasks;
  const task = oldTasks.find((t) => t.id === taskId);
  if (!task) return;

  // Force top position when moving from in_progress to in_review
  if (task.status === 'in_progress' && newStatus === 'in_review') {
    newPosition = 0;
  }

  const tasksInNewColumn = oldTasks
    .filter((t) => t.status === newStatus && t.id !== taskId)
    .sort((a, b) => a.position - b.position);
  tasksInNewColumn.splice(newPosition, 0, { ...task, status: newStatus });

  const updatedTasks = oldTasks.map((t) => {
    if (t.id === taskId) return { ...t, status: newStatus, position: newPosition };
    const idx = tasksInNewColumn.findIndex((nt) => nt.id === t.id);
    if (idx >= 0 && t.status === newStatus) return { ...t, position: idx };
    return t;
  });
  set(() => ({ tasks: updatedTasks }));

  try {
    const res = await fetch('/api/tasks/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, status: newStatus, position: newPosition }),
    });
    if (!res.ok) { set(() => ({ tasks: oldTasks })); throw new Error('Failed to reorder tasks'); }
  } catch (error) {
    log.error({ error, taskId }, 'Error reordering tasks');
    set(() => ({ tasks: oldTasks }));
  }
}

export async function updateTaskStatusAction(
  taskId: string,
  status: TaskStatus,
  set: TaskStoreSetFn,
  get: TaskStoreGetFn
): Promise<void> {
  const oldTasks = get().tasks;
  const task = oldTasks.find((t) => t.id === taskId);
  if (!task) return;

  const isStatusChanging = task.status !== status;
  const newPosition = isStatusChanging ? 0 : task.position;

  if (isStatusChanging) {
    set(() => ({
      tasks: oldTasks.map((t) => {
        if (t.id === taskId) return { ...t, status, position: 0 };
        if (t.status === status) return { ...t, position: t.position + 1 };
        return t;
      }),
    }));
    const selected = get().selectedTask;
    if (selected?.id === taskId) set(() => ({ selectedTask: { ...selected, status, position: 0 } }));
  }

  try {
    const res = await fetch('/api/tasks/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, status, position: newPosition }),
    });
    if (!res.ok) throw new Error('Failed to update task status');
  } catch (error) {
    log.error({ error, taskId }, 'Error updating task status');
    set(() => ({ tasks: oldTasks }));
    const selected = get().selectedTask;
    if (selected?.id === taskId && task) {
      set(() => ({ selectedTask: { ...selected, status: task.status, position: task.position } }));
    }
  }
}

export async function renameTaskAction(
  taskId: string,
  title: string,
  set: TaskStoreSetFn,
  get: TaskStoreGetFn
): Promise<void> {
  const task = get().tasks.find((t) => t.id === taskId);
  if (!task) return;
  get().updateTask(taskId, { title });
  const selected = get().selectedTask;
  if (selected?.id === taskId) set(() => ({ selectedTask: { ...selected, title } }));
  try {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error('Failed to rename task');
  } catch (error) {
    get().updateTask(taskId, { title: task.title });
    const sel = get().selectedTask;
    if (sel?.id === taskId) set(() => ({ selectedTask: { ...sel, title: task.title } }));
    log.error({ error, taskId }, 'Error renaming task');
    throw error;
  }
}

export async function updateTaskDescriptionAction(
  taskId: string,
  description: string | null,
  set: TaskStoreSetFn,
  get: TaskStoreGetFn
): Promise<void> {
  const task = get().tasks.find((t) => t.id === taskId);
  if (!task) return;
  get().updateTask(taskId, { description });
  const selected = get().selectedTask;
  if (selected?.id === taskId) set(() => ({ selectedTask: { ...selected, description } }));
  try {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });
    if (!res.ok) throw new Error('Failed to update task description');
  } catch (error) {
    get().updateTask(taskId, { description: task.description });
    const sel = get().selectedTask;
    if (sel?.id === taskId) set(() => ({ selectedTask: { ...sel, description: task.description } }));
    log.error({ error, taskId }, 'Error updating task description');
    throw error;
  }
}

export async function setTaskChatInitAction(
  taskId: string,
  chatInit: boolean,
  set: TaskStoreSetFn,
  get: TaskStoreGetFn
): Promise<void> {
  get().updateTask(taskId, { chatInit });
  const selected = get().selectedTask;
  if (selected?.id === taskId) set(() => ({ selectedTask: { ...selected, chatInit } }));
  try {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatInit }),
    });
    if (!res.ok) throw new Error('Failed to update task chatInit');
  } catch (error) {
    log.error({ error, taskId }, 'Error updating task chatInit');
    get().updateTask(taskId, { chatInit: !chatInit });
    const sel = get().selectedTask;
    if (sel?.id === taskId) set(() => ({ selectedTask: { ...sel, chatInit: !chatInit } }));
  }
}

export async function moveTaskToInProgressAction(
  taskId: string,
  set: TaskStoreSetFn,
  get: TaskStoreGetFn
): Promise<void> {
  const task = get().tasks.find((t) => t.id === taskId);
  if (!task || task.status === 'in_progress') return;
  get().updateTask(taskId, { status: 'in_progress' as TaskStatus });
  const state = get();
  if (state.selectedTask?.id === taskId) {
    set(() => ({ selectedTask: { ...state.selectedTask!, status: 'in_progress' as TaskStatus } }));
  }
  try {
    await get().updateTaskStatus(taskId, 'in_progress');
  } catch (error) {
    get().updateTask(taskId, { status: task.status });
    const sel = get().selectedTask;
    if (sel?.id === taskId) set(() => ({ selectedTask: { ...sel, status: task.status } }));
    log.error({ error, taskId }, 'Error moving task to in_progress');
  }
}
