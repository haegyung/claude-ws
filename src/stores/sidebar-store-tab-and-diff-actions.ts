/**
 * Sidebar Store Tab and Diff Actions - Multi-tab editor and diff viewer state management actions
 *
 * Extracted from sidebar-store.ts to keep the store file under 200 lines.
 * Contains: openTab, closeTab, closeTabByFilePath, closeAllTabs, setActiveTabId,
 * updateTabDirty, openDiffTab, closeDiffTab, closeAllDiffTabs, setActiveDiffTabId.
 */

import { createLogger } from '@/lib/logger';
import type { EditorTabState, DiffTabState } from './sidebar-store';

const log = createLogger('SidebarStore');

interface SidebarTabSlice {
  openTabs: EditorTabState[];
  activeTabId: string | null;
  diffTabs: DiffTabState[];
  activeDiffTabId: string | null;
}

type SetFn = (
  updater:
    | ((s: SidebarTabSlice) => Partial<SidebarTabSlice>)
    | Partial<SidebarTabSlice>
) => void;

// ── Editor tab actions ─────────────────────────────────────────────────────

export function openTabAction(filePath: string, set: SetFn): void {
  log.debug({ filePath, timestamp: Date.now() }, 'openTab called');
  set((state) => {
    const existing = state.openTabs.find((t) => t.filePath === filePath);
    if (existing) {
      log.debug({ tabId: existing.id }, 'Tab already exists, switching to it');
      return { activeTabId: existing.id };
    }
    const newTab: EditorTabState = { id: filePath, filePath, isDirty: false };
    log.debug({ tabId: newTab.id }, 'Creating new tab');
    return { openTabs: [...state.openTabs, newTab], activeTabId: newTab.id };
  });
}

export function closeTabAction(tabId: string, set: SetFn): void {
  set((state) => {
    const newTabs = state.openTabs.filter((t) => t.id !== tabId);
    let newActiveId = state.activeTabId;
    if (tabId === state.activeTabId) {
      const idx = state.openTabs.findIndex((t) => t.id === tabId);
      newActiveId = newTabs[idx]?.id ?? newTabs[idx - 1]?.id ?? null;
    }
    return { openTabs: newTabs, activeTabId: newActiveId };
  });
}

export function closeTabByFilePathAction(filePath: string, set: SetFn): void {
  set((state) => {
    const tab = state.openTabs.find((t) => t.filePath === filePath || t.id === filePath);
    if (!tab) return state;
    const newTabs = state.openTabs.filter((t) => t.id !== tab.id);
    let newActiveId = state.activeTabId;
    if (tab.id === state.activeTabId) {
      const idx = state.openTabs.findIndex((t) => t.id === tab.id);
      newActiveId = newTabs[idx]?.id ?? newTabs[idx - 1]?.id ?? null;
    }
    return { openTabs: newTabs, activeTabId: newActiveId };
  });
}

export function updateTabDirtyAction(tabId: string, isDirty: boolean, set: SetFn): void {
  set((state) => ({
    openTabs: state.openTabs.map((t) => (t.id === tabId ? { ...t, isDirty } : t)),
  }));
}

// ── Diff tab actions ───────────────────────────────────────────────────────

export function openDiffTabAction(filePath: string, staged: boolean, set: SetFn): void {
  set((state) => {
    const tabId = `${filePath}:${staged ? 'staged' : 'unstaged'}`;
    const existing = state.diffTabs.find((t) => t.id === tabId);
    if (existing) return { activeDiffTabId: existing.id };
    const newTab: DiffTabState = { id: tabId, filePath, staged };
    return { diffTabs: [...state.diffTabs, newTab], activeDiffTabId: newTab.id };
  });
}

export function closeDiffTabAction(tabId: string, set: SetFn): void {
  set((state) => {
    const newTabs = state.diffTabs.filter((t) => t.id !== tabId);
    let newActiveId = state.activeDiffTabId;
    if (tabId === state.activeDiffTabId) {
      const idx = state.diffTabs.findIndex((t) => t.id === tabId);
      newActiveId = newTabs[idx]?.id ?? newTabs[idx - 1]?.id ?? null;
    }
    return { diffTabs: newTabs, activeDiffTabId: newActiveId };
  });
}
