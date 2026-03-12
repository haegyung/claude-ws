/**
 * Terminal Store - Interactive terminal state management
 *
 * Uses the shared socket-service singleton (same socket as shell-store, inline-edit, etc.)
 * Architecturally separate from shell-store (background shells).
 *
 * Tabs and session IDs are persisted so panel toggle / page refresh
 * can reconnect to still-alive backend PTY sessions.
 *
 * Heavy session actions extracted to terminal-store-socket-session-actions.ts
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getSocket } from '@/lib/socket-service';
import {
  attachListenersAction,
  reconnectTabsAction,
  createTerminalAction,
  closeTerminalAction,
} from './terminal-store-socket-session-actions';

export interface TerminalInstanceActions {
  copySelection: () => void;
  selectAll: () => void;
  pasteClipboard: () => void;
  pasteText: (text: string) => void;
  clearTerminal: () => void;
}

export interface TerminalTab {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  isConnected: boolean;
}

interface TerminalState {
  isOpen: boolean;
  panelHeight: number;
  activeTabId: string | null;
  tabs: TerminalTab[];
  _listenersAttached: boolean;
  _isCreating: boolean;
  selectionMode: Record<string, boolean>;
  _terminalActions: Record<string, TerminalInstanceActions>;
}

interface TerminalActions {
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
  setPanelHeight: (height: number) => void;
  createTerminal: (projectId?: string) => Promise<string | null>;
  closeTerminal: (terminalId: string) => void;
  setActiveTab: (terminalId: string) => void;
  sendInput: (terminalId: string, data: string) => void;
  sendResize: (terminalId: string, cols: number, rows: number) => void;
  renameTerminal: (terminalId: string, title: string) => void;
  closeAllTerminals: () => void;
  reconnectTabs: () => Promise<void>;
  _attachListeners: () => void;
  setSelectionMode: (id: string, active: boolean) => void;
  registerTerminalActions: (id: string, actions: TerminalInstanceActions) => void;
  unregisterTerminalActions: (id: string) => void;
  copySelection: (id: string) => void;
  selectAll: (id: string) => void;
  pasteClipboard: (id: string) => void;
  pasteText: (id: string, text: string) => void;
  clearTerminal: (id: string) => void;
}

type TerminalStore = TerminalState & TerminalActions;

export const MIN_PANEL_HEIGHT = 150;
export const MAX_PANEL_HEIGHT = 600;
const DEFAULT_PANEL_HEIGHT = 300;

export const useTerminalStore = create<TerminalStore>()(
  persist(
    (set, get) => ({
      isOpen: false,
      panelHeight: DEFAULT_PANEL_HEIGHT,
      activeTabId: null,
      tabs: [],
      _listenersAttached: false,
      _isCreating: false,
      selectionMode: {},
      _terminalActions: {},

      togglePanel: () => set((s) => ({ isOpen: !s.isOpen })),
      openPanel: () => set({ isOpen: true }),
      closePanel: () => set({ isOpen: false }),

      setPanelHeight: (height) =>
        set({ panelHeight: Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, height)) }),

      _attachListeners: () => attachListenersAction(set, get),

      reconnectTabs: () => reconnectTabsAction(set, get),

      createTerminal: (projectId) => createTerminalAction(projectId, set, get),

      closeTerminal: (terminalId) => closeTerminalAction(terminalId, set, get),

      setActiveTab: (terminalId) => set({ activeTabId: terminalId }),

      sendInput: (terminalId, data) => getSocket().emit('terminal:input', { terminalId, data }),

      sendResize: (terminalId, cols, rows) =>
        getSocket().emit('terminal:resize', { terminalId, cols, rows }),

      renameTerminal: (terminalId, title) => {
        const trimmed = title.trim();
        if (!trimmed) return;
        set((s) => ({
          tabs: s.tabs.map((t) => t.id === terminalId ? { ...t, title: trimmed } : t),
        }));
      },

      closeAllTerminals: () => {
        const socket = getSocket();
        get().tabs.forEach((t) => socket.emit('terminal:close', { terminalId: t.id }));
        set({ tabs: [], activeTabId: null });
      },

      setSelectionMode: (id, active) =>
        set((s) => ({ selectionMode: { ...s.selectionMode, [id]: active } })),

      registerTerminalActions: (id, actions) =>
        set((s) => ({ _terminalActions: { ...s._terminalActions, [id]: actions } })),

      unregisterTerminalActions: (id) =>
        set((s) => {
          const next = { ...s._terminalActions };
          delete next[id];
          return { _terminalActions: next };
        }),

      copySelection: (id) => get()._terminalActions[id]?.copySelection(),
      selectAll: (id) => get()._terminalActions[id]?.selectAll(),
      pasteClipboard: (id) => get()._terminalActions[id]?.pasteClipboard(),
      pasteText: (id, text) => get()._terminalActions[id]?.pasteText(text),
      clearTerminal: (id) => get()._terminalActions[id]?.clearTerminal(),
    }),
    {
      name: 'terminal-store',
      partialize: (state) => ({
        isOpen: state.isOpen,
        panelHeight: state.panelHeight,
        tabs: state.tabs,
        activeTabId: state.activeTabId,
      }),
    }
  )
);
