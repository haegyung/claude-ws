/**
 * Terminal Store Socket Session Actions - Socket.io session management for terminal PTY sessions
 *
 * Extracted from terminal-store.ts to keep the store file under 200 lines.
 * Contains: createTerminal, reconnectTabs, _attachListeners, and closeTerminal logic.
 */

import { getSocket } from '@/lib/socket-service';
import { createLogger } from '@/lib/logger';
import type { Socket } from 'socket.io-client';
import type { TerminalTab, TerminalInstanceActions } from './terminal-store';

const log = createLogger('TerminalStore');

/** Find the lowest available tab number (1-based) not already used by current tabs */
export function nextAvailableTabNumber(tabs: TerminalTab[]): number {
  const usedNumbers = new Set(
    tabs.map((t) => {
      const match = t.title.match(/^Terminal (\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    })
  );
  let n = 1;
  while (usedNumbers.has(n)) n++;
  return n;
}

/** Wait for socket to be connected, resolves immediately if already connected */
export function waitForSocketConnection(socket: Socket): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve) => {
    socket.once('connect', () => resolve());
  });
}

type SetFn = (updater: ((s: TerminalStoreSlice) => Partial<TerminalStoreSlice>) | Partial<TerminalStoreSlice>) => void;
type GetFn = () => TerminalStoreSlice;

interface TerminalStoreSlice {
  tabs: TerminalTab[];
  activeTabId: string | null;
  isOpen: boolean;
  _listenersAttached: boolean;
  _isCreating: boolean;
  selectionMode: Record<string, boolean>;
  _terminalActions: Record<string, TerminalInstanceActions>;
  _attachListeners: () => void;
}

export function attachListenersAction(set: SetFn, get: GetFn): void {
  if (get()._listenersAttached) return;
  const socket = getSocket();
  socket.on('terminal:exit', (data: { terminalId: string }) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === data.terminalId ? { ...t, isConnected: false } : t
      ),
    }));
  });
  set({ _listenersAttached: true });
}

export async function reconnectTabsAction(set: SetFn, get: GetFn): Promise<void> {
  const { tabs, _attachListeners } = get();
  if (tabs.length === 0) return;

  _attachListeners();
  const socket = getSocket();
  await waitForSocketConnection(socket);

  const updatedTabs: TerminalTab[] = [];
  for (const tab of tabs) {
    const alive = await new Promise<boolean>((resolve) => {
      socket.emit(
        'terminal:check',
        { terminalId: tab.id },
        (result: { alive: boolean }) => resolve(result?.alive ?? false)
      );
      setTimeout(() => resolve(false), 2000);
    });

    if (alive) {
      socket.emit('terminal:subscribe', { terminalId: tab.id });
      updatedTabs.push({ ...tab, isConnected: true });
    } else {
      log.info({ terminalId: tab.id }, 'Stale terminal session removed');
    }
  }

  const { activeTabId } = get();
  const activeStillExists = updatedTabs.some((t) => t.id === activeTabId);
  set({
    tabs: updatedTabs,
    activeTabId: activeStillExists
      ? activeTabId
      : updatedTabs.length > 0
        ? updatedTabs[0].id
        : null,
  });
}

export async function createTerminalAction(
  projectId: string | undefined,
  set: SetFn,
  get: GetFn
): Promise<string | null> {
  if (get()._isCreating) {
    log.info('Terminal creation already in-flight, skipping');
    return null;
  }
  set({ _isCreating: true });

  get()._attachListeners();
  const socket = getSocket();
  await waitForSocketConnection(socket);

  return new Promise((resolve) => {
    log.info({ projectId }, 'Creating terminal');

    const timeout = setTimeout(() => {
      log.error('Terminal create timed out (no ack after 8s)');
      set({ _isCreating: false });
      resolve(null);
    }, 8000);

    socket.emit(
      'terminal:create',
      { projectId: projectId || undefined },
      (result: { success: boolean; terminalId?: string; error?: string }) => {
        clearTimeout(timeout);
        log.info({ result }, 'terminal:create ack received');
        set({ _isCreating: false });
        if (result.success && result.terminalId) {
          const tabNumber = nextAvailableTabNumber(get().tabs);
          const tab: TerminalTab = {
            id: result.terminalId,
            projectId: projectId || 'global',
            title: `Terminal ${tabNumber}`,
            createdAt: Date.now(),
            isConnected: true,
          };
          set((s) => ({
            tabs: [...s.tabs, tab],
            activeTabId: result.terminalId!,
            isOpen: true,
          }));
          resolve(result.terminalId);
        } else {
          log.error({ error: result.error }, 'Failed to create terminal');
          resolve(null);
        }
      }
    );
  });
}

export function closeTerminalAction(terminalId: string, set: SetFn, get: GetFn): void {
  const socket = getSocket();
  socket.emit('terminal:close', { terminalId });
  const { tabs, activeTabId, selectionMode, _terminalActions } = get();
  const newTabs = tabs.filter((t) => t.id !== terminalId);
  const newActiveId =
    activeTabId === terminalId
      ? newTabs.length > 0
        ? newTabs[newTabs.length - 1].id
        : null
      : activeTabId;
  const newSelectionMode = { ...selectionMode };
  delete newSelectionMode[terminalId];
  const newActions = { ..._terminalActions };
  delete newActions[terminalId];
  set({ tabs: newTabs, activeTabId: newActiveId, selectionMode: newSelectionMode, _terminalActions: newActions });
}
