/**
 * Task Store API Actions - HTTP fetch actions for task CRUD and reordering
 *
 * Extracted from task-store.ts to keep store under 200 lines.
 * All functions accept zustand's set/get and operate on TaskStore state.
 */

import type { Task, TaskStatus } from '@/types';
import { createLogger } from '@/lib/logger';

const log = createLogger('TaskStore');

type SetFn = (fn: (state: { tasks: Task[]; selectedTask: Task | null }) => Partial<{ tasks: Task[]; selectedTask: Task | null }> | void) => void;
type GetFn = () => {
  tasks: Task[];
  selectedTask: Task | null;
  selectedTaskId: string | null;
  updateTask: (id: string, updates: Partial<Task>) => void;
  addTask: (task: Task) => void;
  setCreatingTask: (isCreating: boolean) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus) => Promise<void>;
};

// ── fetchTasks ─────────────────────────────────────────────────────────────

export async function fetchTasksAction(projectIds: string[], set: (fn: (s: { tasks: Task[] }) => Partial<{ tasks: Task[] }>) => void): Promise<void> {
  try {
    const query = projectIds.length > 0 ? `?projectIds=${projectIds.join(',')}` : '';
    const res = await fetch(`/api/tasks${query}`);
    if (!res.ok) throw new Error('Failed to fetch tasks');
    const tasks = await res.json();
    set(() => ({ tasks }));
  } catch (error) {
    log.error({ error }, 'Error fetching tasks');
  }
}

// ── createTask ─────────────────────────────────────────────────────────────

export async function createTaskAction(
  projectId: string,
  title: string,
  description: string | null,
  get: GetFn
): Promise<Task> {
  try {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title, description }),
    });
    if (!res.ok) throw new Error('Failed to create task');
    const task = await res.json();
    get().addTask(task);
    get().setCreatingTask(false);
    return task;
  } catch (error) {
    log.error({ error }, 'Error creating task');
    throw error;
  }
}

// ── duplicateTask ──────────────────────────────────────────────────────────

export async function duplicateTaskAction(task: Task, get: GetFn): Promise<Task> {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      status: 'todo',
    }),
  });
  if (!res.ok) throw new Error('Failed to duplicate task');
  const newTask = await res.json();
  get().addTask(newTask);
  return newTask;
}

// ── deleteTasksByStatus ────────────────────────────────────────────────────

export async function deleteTasksByStatusAction(
  status: TaskStatus,
  set: SetFn,
  get: GetFn
): Promise<void> {
  const tasksToDelete = get().tasks.filter((task) => task.status === status);

  set((state) => ({ tasks: state.tasks.filter((task) => task.status !== status) }));

  try {
    await Promise.all(
      tasksToDelete.map((task) => fetch(`/api/tasks/${task.id}`, { method: 'DELETE' }))
    );
  } catch (error) {
    log.error({ error }, 'Error deleting tasks by status');
    set((state) => ({ tasks: [...state.tasks, ...tasksToDelete] }));
    throw error;
  }
}

// ── reorderTasks ───────────────────────────────────────────────────────────

export async function reorderTasksAction(
  taskId: string,
  newStatus: TaskStatus,
  newPosition: number,
  set: SetFn,
  get: GetFn
): Promise<void> {
  const oldTasks = get().tasks;
  const task = oldTasks.find((t) => t.id === taskId);
  if (!task) return;

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
    if (!res.ok) {
      set(() => ({ tasks: oldTasks }));
      throw new Error('Failed to reorder tasks');
    }
  } catch (error) {
    log.error({ error, taskId }, 'Error reordering tasks');
    set(() => ({ tasks: oldTasks }));
  }
}

// ── updateTaskStatus ───────────────────────────────────────────────────────

export async function updateTaskStatusAction(
  taskId: string,
  status: TaskStatus,
  set: SetFn,
  get: GetFn
): Promise<void> {
  const oldTasks = get().tasks;
  const task = oldTasks.find((t) => t.id === taskId);
  if (!task) return;

  const isStatusChanging = task.status !== status;
  const newPosition = isStatusChanging ? 0 : task.position;

  if (isStatusChanging) {
    const updatedTasks = oldTasks.map((t) => {
      if (t.id === taskId) return { ...t, status, position: 0 };
      if (t.status === status) return { ...t, position: t.position + 1 };
      return t;
    });
    set(() => ({ tasks: updatedTasks }));

    const selected = get().selectedTask;
    if (selected?.id === taskId) {
      set(() => ({ selectedTask: { ...selected, status, position: 0 } }));
    }
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

// ── renameTask ─────────────────────────────────────────────────────────────

export async function renameTaskAction(
  taskId: string,
  title: string,
  set: SetFn,
  get: GetFn
): Promise<void> {
  const task = get().tasks.find((t) => t.id === taskId);
  if (!task) return;

  get().updateTask(taskId, { title });
  const selected = get().selectedTask;
  if (selected?.id === taskId) {
    set(() => ({ selectedTask: { ...selected, title } }));
  }

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

// ── updateTaskDescription ──────────────────────────────────────────────────

export async function updateTaskDescriptionAction(
  taskId: string,
  description: string | null,
  set: SetFn,
  get: GetFn
): Promise<void> {
  const task = get().tasks.find((t) => t.id === taskId);
  if (!task) return;

  get().updateTask(taskId, { description });
  const selected = get().selectedTask;
  if (selected?.id === taskId) {
    set(() => ({ selectedTask: { ...selected, description } }));
  }

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

// ── setTaskChatInit ────────────────────────────────────────────────────────

export async function setTaskChatInitAction(
  taskId: string,
  chatInit: boolean,
  set: SetFn,
  get: GetFn
): Promise<void> {
  get().updateTask(taskId, { chatInit });
  const selected = get().selectedTask;
  if (selected?.id === taskId) {
    set(() => ({ selectedTask: { ...selected, chatInit } }));
  }

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

// ── moveTaskToInProgress ───────────────────────────────────────────────────

export async function moveTaskToInProgressAction(
  taskId: string,
  set: SetFn,
  get: GetFn
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
