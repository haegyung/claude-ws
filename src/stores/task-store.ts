import { create } from 'zustand';
import { Task, TaskStatus } from '@/types';
import { useInteractiveCommandStore } from './interactive-command-store';
import { useFloatingWindowsStore } from './floating-windows-store';
import {
  fetchTasksAction,
  createTaskAction,
  duplicateTaskAction,
  deleteTasksByStatusAction,
  reorderTasksAction,
  updateTaskStatusAction,
  renameTaskAction,
  updateTaskDescriptionAction,
  setTaskChatInitAction,
  moveTaskToInProgressAction,
} from './task-store-api-actions';

interface TaskStore {
  tasks: Task[];
  selectedTaskId: string | null;
  selectedTask: Task | null;
  isCreatingTask: boolean;
  pendingAutoStartTask: string | null;
  pendingAutoStartPrompt: string | null;
  pendingAutoStartFileIds: string[] | null;

  // Sync actions
  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  selectTask: (id: string | null) => void;
  setSelectedTask: (task: Task | null) => void;
  setSelectedTaskId: (id: string | null) => void;
  setCreatingTask: (isCreating: boolean) => void;
  setPendingAutoStartTask: (taskId: string | null, prompt?: string, fileIds?: string[]) => void;

  // API actions (delegated to task-store-api-actions)
  fetchTasks: (projectIds: string[]) => Promise<void>;
  createTask: (projectId: string, title: string, description: string | null) => Promise<Task>;
  duplicateTask: (task: Task) => Promise<Task>;
  deleteTasksByStatus: (status: TaskStatus) => Promise<void>;
  reorderTasks: (taskId: string, newStatus: TaskStatus, newPosition: number) => Promise<void>;
  updateTaskStatus: (taskId: string, status: TaskStatus) => Promise<void>;
  renameTask: (taskId: string, title: string) => Promise<void>;
  updateTaskDescription: (taskId: string, description: string | null) => Promise<void>;
  setTaskChatInit: (taskId: string, chatInit: boolean) => Promise<void>;
  moveTaskToInProgress: (taskId: string) => Promise<void>;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  selectedTaskId: null,
  selectedTask: null,
  isCreatingTask: false,
  pendingAutoStartTask: null,
  pendingAutoStartPrompt: null,
  pendingAutoStartFileIds: null,

  setTasks: (tasks) => set({ tasks }),

  addTask: (task) => set((state) => ({ tasks: [...state.tasks, task] })),

  updateTask: (id, updates) => set((state) => ({
    tasks: state.tasks.map((task) => task.id === id ? { ...task, ...updates } : task),
  })),

  deleteTask: (id) => set((state) => ({
    tasks: state.tasks.filter((task) => task.id !== id),
  })),

  selectTask: (id) => {
    const currentTaskId = get().selectedTaskId;
    if (id !== currentTaskId) {
      useInteractiveCommandStore.getState().closeCommand();
    }
    const task = id ? get().tasks.find((t) => t.id === id) || null : null;
    const floatingWindowsStore = useFloatingWindowsStore.getState();
    const hasFloatingWindows = floatingWindowsStore.windows.size > 0;
    const preferFloating = floatingWindowsStore.preferFloating;

    if (task && (hasFloatingWindows || preferFloating)) {
      if (floatingWindowsStore.isWindowOpen(task.id)) {
        floatingWindowsStore.bringToFront(task.id);
      } else {
        floatingWindowsStore.openWindow(task.id, 'chat', task.projectId);
      }
      set({ selectedTaskId: id, selectedTask: null });
      return;
    }
    if (task) floatingWindowsStore.setPreferFloating(false);
    set({ selectedTaskId: id, selectedTask: task });
  },

  setSelectedTask: (task) => {
    if (task) useFloatingWindowsStore.getState().setPreferFloating(false);
    set({ selectedTask: task, selectedTaskId: task?.id || null });
  },

  setSelectedTaskId: (id) => set({ selectedTaskId: id }),

  setCreatingTask: (isCreating) => set({ isCreatingTask: isCreating }),

  setPendingAutoStartTask: (taskId, prompt, fileIds) => set({
    pendingAutoStartTask: taskId,
    pendingAutoStartPrompt: prompt || null,
    pendingAutoStartFileIds: fileIds || null,
  }),

  // API actions — delegate to companion module
  fetchTasks: (projectIds) => fetchTasksAction(projectIds, set as Parameters<typeof fetchTasksAction>[1]),

  createTask: (projectId, title, description) => createTaskAction(projectId, title, description, get),

  duplicateTask: (task) => duplicateTaskAction(task, get),

  deleteTasksByStatus: (status) => deleteTasksByStatusAction(status, set as Parameters<typeof deleteTasksByStatusAction>[1], get),

  reorderTasks: (taskId, newStatus, newPosition) =>
    reorderTasksAction(taskId, newStatus, newPosition, set as Parameters<typeof reorderTasksAction>[3], get),

  updateTaskStatus: (taskId, status) =>
    updateTaskStatusAction(taskId, status, set as Parameters<typeof updateTaskStatusAction>[3], get),

  renameTask: (taskId, title) =>
    renameTaskAction(taskId, title, set as Parameters<typeof renameTaskAction>[3], get),

  updateTaskDescription: (taskId, description) =>
    updateTaskDescriptionAction(taskId, description, set as Parameters<typeof updateTaskDescriptionAction>[3], get),

  setTaskChatInit: (taskId, chatInit) =>
    setTaskChatInitAction(taskId, chatInit, set as Parameters<typeof setTaskChatInitAction>[3], get),

  moveTaskToInProgress: (taskId) =>
    moveTaskToInProgressAction(taskId, set as Parameters<typeof moveTaskToInProgressAction>[2], get),
}));
