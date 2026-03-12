/**
 * Shell Store Socket and API Actions - Socket.io subscription and HTTP fetch actions for background shells
 *
 * Extracted from shell-store.ts to keep the store file under 200 lines.
 * Contains: subscribeToProject, unsubscribe, stopShell, getShellLogs logic.
 */

import { io } from 'socket.io-client';
import { createLogger } from '@/lib/logger';
import type { ShellInfo, LogEntry } from './shell-store';

const log = createLogger('ShellStore');

interface ShellStoreSlice {
  shells: Map<string, ShellInfo>;
  shellLogs: Map<string, LogEntry[]>;
  socket: ReturnType<typeof io> | null;
  subscribedProjectId: string | null;
  loading: boolean;
  addShell: (shell: ShellInfo) => void;
  updateShell: (shellId: string, updates: Partial<ShellInfo>) => void;
  addShellLog: (shellId: string, entry: LogEntry) => void;
  setShells: (projectId: string, shells: ShellInfo[]) => void;
}

type SetFn = (
  updater:
    | ((s: ShellStoreSlice) => Partial<ShellStoreSlice>)
    | Partial<ShellStoreSlice>
) => void;
type GetFn = () => ShellStoreSlice;

// ── subscribeToProject ─────────────────────────────────────────────────────

export function subscribeToProjectAction(projectId: string, set: SetFn, get: GetFn): void {
  const state = get();

  if (state.subscribedProjectId === projectId && state.socket) return;

  if (state.subscribedProjectId && state.socket) {
    state.socket.emit('shell:unsubscribe', { projectId: state.subscribedProjectId });
  }

  let socket = state.socket;
  if (!socket) {
    socket = io({ reconnection: true, reconnectionDelay: 1000 });

    socket.on(
      'shell:started',
      (data: { shellId: string; projectId: string; pid: number; command: string }) => {
        log.debug({ shellId: data.shellId }, 'Shell started');
        get().addShell({
          shellId: data.shellId,
          projectId: data.projectId,
          attemptId: '',
          command: data.command,
          pid: data.pid,
          startedAt: Date.now(),
          isRunning: true,
          exitCode: null,
        });
      }
    );

    socket.on(
      'shell:exit',
      (data: { shellId: string; projectId: string; code: number | null; signal: string | null }) => {
        log.debug({ shellId: data.shellId, code: data.code }, 'Shell exited');
        get().updateShell(data.shellId, { isRunning: false, exitCode: data.code });
      }
    );

    socket.on(
      'shell:output',
      (data: { shellId: string; projectId: string; type: 'stdout' | 'stderr'; content: string }) => {
        get().addShellLog(data.shellId, {
          type: data.type,
          content: data.content,
          timestamp: Date.now(),
        });
      }
    );

    set({ socket });
  }

  socket.emit('shell:subscribe', { projectId });
  set({ subscribedProjectId: projectId, loading: true });

  fetch(`/api/shells?projectId=${encodeURIComponent(projectId)}`)
    .then((res) => res.json())
    .then((shells: ShellInfo[]) => get().setShells(projectId, shells))
    .catch((err) => {
      log.error({ err, projectId }, 'Failed to fetch shells');
      set({ loading: false });
    });
}

// ── unsubscribe ────────────────────────────────────────────────────────────

export function unsubscribeAction(set: SetFn, get: GetFn): void {
  const { socket, subscribedProjectId } = get();
  if (socket && subscribedProjectId) {
    socket.emit('shell:unsubscribe', { projectId: subscribedProjectId });
    set({ subscribedProjectId: null, shells: new Map() });
  }
}

// ── stopShell ──────────────────────────────────────────────────────────────

export async function stopShellAction(shellId: string, get: GetFn): Promise<boolean> {
  const { socket } = get();
  if (!socket) return false;

  return new Promise((resolve) => {
    socket.emit(
      'shell:stop',
      { shellId },
      (result: { success: boolean; error?: string }) => {
        if (result.error) log.error({ error: result.error }, 'Stop shell error');
        resolve(result.success);
      }
    );
  });
}

// ── getShellLogs ───────────────────────────────────────────────────────────

export async function getShellLogsAction(
  shellId: string,
  lines: number,
  set: SetFn,
  get: GetFn
): Promise<LogEntry[]> {
  const { socket, shellLogs } = get();
  if (!socket) return shellLogs.get(shellId) || [];

  return new Promise((resolve) => {
    socket.emit(
      'shell:getLogs',
      { shellId, lines },
      (result: { logs: LogEntry[]; error?: string }) => {
        if (result.error) {
          log.error({ error: result.error }, 'Get logs error');
          resolve([]);
        } else {
          set((state) => {
            const newLogs = new Map(state.shellLogs);
            newLogs.set(shellId, result.logs);
            return { shellLogs: newLogs };
          });
          resolve(result.logs);
        }
      }
    );
  });
}
