/**
 * Shell Store - Manages background shell state and socket subscriptions
 *
 * Tracks shells per project, handles real-time updates via Socket.io,
 * and provides actions for stopping shells and fetching logs.
 *
 * Heavy socket/API actions extracted to shell-store-socket-and-api-actions.ts
 */

import { create } from 'zustand';
import {
  subscribeToProjectAction,
  unsubscribeAction,
  stopShellAction,
  getShellLogsAction,
} from './shell-store-socket-and-api-actions';

export interface ShellInfo {
  shellId: string;
  projectId: string;
  attemptId: string;
  command: string;
  pid: number;
  startedAt: number;
  isRunning: boolean;
  exitCode: number | null;
}

export interface LogEntry {
  type: 'stdout' | 'stderr';
  content: string;
  timestamp: number;
}

interface ShellState {
  shells: Map<string, ShellInfo>;
  shellLogs: Map<string, LogEntry[]>;
  socket: ReturnType<typeof import('socket.io-client').io> | null;
  subscribedProjectId: string | null;
  loading: boolean;
}

interface ShellActions {
  setShells: (projectId: string, shells: ShellInfo[]) => void;
  addShell: (shell: ShellInfo) => void;
  updateShell: (shellId: string, updates: Partial<ShellInfo>) => void;
  removeShell: (shellId: string) => void;
  subscribeToProject: (projectId: string) => void;
  unsubscribe: () => void;
  stopShell: (shellId: string) => Promise<boolean>;
  getShellLogs: (shellId: string, lines?: number) => Promise<LogEntry[]>;
  addShellLog: (shellId: string, entry: LogEntry) => void;
  clearShellLogs: (shellId: string) => void;
}

type ShellStore = ShellState & ShellActions;

export const useShellStore = create<ShellStore>((set, get) => ({
  shells: new Map(),
  shellLogs: new Map(),
  socket: null,
  subscribedProjectId: null,
  loading: false,

  setShells: (projectId, shells) => {
    const map = new Map<string, ShellInfo>();
    shells.forEach((s) => map.set(s.shellId, s));
    set({ shells: map, loading: false });
  },

  addShell: (shell) =>
    set((state) => {
      const newMap = new Map(state.shells);
      newMap.set(shell.shellId, shell);
      return { shells: newMap };
    }),

  updateShell: (shellId, updates) =>
    set((state) => {
      const shell = state.shells.get(shellId);
      if (!shell) return state;
      const newMap = new Map(state.shells);
      newMap.set(shellId, { ...shell, ...updates });
      return { shells: newMap };
    }),

  removeShell: (shellId) =>
    set((state) => {
      const newMap = new Map(state.shells);
      newMap.delete(shellId);
      return { shells: newMap };
    }),

  addShellLog: (shellId, entry) =>
    set((state) => {
      const newLogs = new Map(state.shellLogs);
      const existing = newLogs.get(shellId) || [];
      newLogs.set(shellId, [...existing, entry].slice(-500));
      return { shellLogs: newLogs };
    }),

  clearShellLogs: (shellId) =>
    set((state) => {
      const newLogs = new Map(state.shellLogs);
      newLogs.delete(shellId);
      return { shellLogs: newLogs };
    }),

  // API/socket actions — delegated to shell-store-socket-and-api-actions
  subscribeToProject: (projectId) => subscribeToProjectAction(projectId, set, get),
  unsubscribe: () => unsubscribeAction(set, get),
  stopShell: (shellId) => stopShellAction(shellId, get),
  getShellLogs: (shellId, lines = 100) => getShellLogsAction(shellId, lines, set, get),
}));

