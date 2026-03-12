import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  openTabAction,
  closeTabAction,
  closeTabByFilePathAction,
  updateTabDirtyAction,
  openDiffTabAction,
  closeDiffTabAction,
} from './sidebar-store-tab-and-diff-actions';

type SidebarTab = 'files' | 'git';

export interface EditorTabState {
  id: string;
  filePath: string;
  isDirty: boolean;
}

export interface DiffTabState {
  id: string;
  filePath: string;
  staged: boolean;
}

interface SidebarState {
  isOpen: boolean;
  activeTab: SidebarTab;
  expandedFolders: Set<string>;
  selectedFile: string | null;
  openTabs: EditorTabState[];
  activeTabId: string | null;
  sidebarWidth: number;
  editorPosition: { lineNumber?: number; column?: number; matchLength?: number } | null;
  pendingEditorPosition: { filePath: string; lineNumber: number; column?: number; matchLength?: number } | null;
  diffFile: string | null;
  diffStaged: boolean;
  diffTabs: DiffTabState[];
  activeDiffTabId: string | null;
}

interface SidebarActions {
  toggleSidebar: () => void;
  setIsOpen: (isOpen: boolean) => void;
  setActiveTab: (tab: SidebarTab) => void;
  toggleFolder: (path: string) => void;
  expandFolder: (path: string) => void;
  collapseFolder: (path: string) => void;
  setSelectedFile: (path: string | null) => void;
  openTab: (filePath: string) => void;
  closeTab: (tabId: string) => void;
  closeTabByFilePath: (filePath: string) => void;
  closeAllTabs: () => void;
  setActiveTabId: (tabId: string) => void;
  updateTabDirty: (tabId: string, isDirty: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setEditorPosition: (position: { lineNumber?: number; column?: number; matchLength?: number } | null) => void;
  setPendingEditorPosition: (pending: { filePath: string; lineNumber: number; column?: number; matchLength?: number } | null) => void;
  clearPendingEditorPosition: () => void;
  setDiffFile: (path: string | null, staged?: boolean) => void;
  closeDiff: () => void;
  openDiffTab: (filePath: string, staged: boolean) => void;
  closeDiffTab: (tabId: string) => void;
  closeAllDiffTabs: () => void;
  setActiveDiffTabId: (tabId: string) => void;
}

type SidebarStore = SidebarState & SidebarActions;

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      isOpen: false,
      activeTab: 'files',
      expandedFolders: new Set<string>(),
      selectedFile: null,
      openTabs: [],
      activeTabId: null,
      sidebarWidth: 280,
      editorPosition: null,
      pendingEditorPosition: null,
      diffFile: null,
      diffStaged: false,
      diffTabs: [],
      activeDiffTabId: null,

      toggleSidebar: () => set((state) => ({ isOpen: !state.isOpen })),
      setIsOpen: (isOpen) => set({ isOpen }),
      setActiveTab: (activeTab) => set({ activeTab }),

      toggleFolder: (path) =>
        set((state) => {
          const newExpanded = new Set(state.expandedFolders);
          if (newExpanded.has(path)) newExpanded.delete(path);
          else newExpanded.add(path);
          return { expandedFolders: newExpanded };
        }),

      expandFolder: (path) =>
        set((state) => {
          const newExpanded = new Set(state.expandedFolders);
          newExpanded.add(path);
          return { expandedFolders: newExpanded };
        }),

      collapseFolder: (path) =>
        set((state) => {
          const newExpanded = new Set(state.expandedFolders);
          newExpanded.delete(path);
          return { expandedFolders: newExpanded };
        }),

      setSelectedFile: (selectedFile) => set({ selectedFile }),

      // Tab actions — delegated to sidebar-store-tab-and-diff-actions
      openTab: (filePath) => openTabAction(filePath, set),
      closeTab: (tabId) => closeTabAction(tabId, set),
      closeTabByFilePath: (filePath) => closeTabByFilePathAction(filePath, set),
      closeAllTabs: () => set({ openTabs: [], activeTabId: null }),
      setActiveTabId: (activeTabId) => set({ activeTabId }),
      updateTabDirty: (tabId, isDirty) => updateTabDirtyAction(tabId, isDirty, set),

      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setEditorPosition: (editorPosition) => set({ editorPosition }),
      setPendingEditorPosition: (pendingEditorPosition) => set({ pendingEditorPosition }),
      clearPendingEditorPosition: () => set({ pendingEditorPosition: null }),

      setDiffFile: (diffFile, staged = false) => set({ diffFile, diffStaged: staged }),
      closeDiff: () => set({ diffFile: null }),

      // Diff tab actions — delegated to sidebar-store-tab-and-diff-actions
      openDiffTab: (filePath, staged) => openDiffTabAction(filePath, staged, set),
      closeDiffTab: (tabId) => closeDiffTabAction(tabId, set),
      closeAllDiffTabs: () => set({ diffTabs: [], activeDiffTabId: null }),
      setActiveDiffTabId: (activeDiffTabId) => set({ activeDiffTabId }),
    }),
    {
      name: 'sidebar-store',
      partialize: (state) => ({
        isOpen: state.isOpen,
        activeTab: state.activeTab,
        sidebarWidth: state.sidebarWidth,
        openTabs: state.openTabs.map((t) => ({ id: t.id, filePath: t.filePath, isDirty: false })),
        activeTabId: state.activeTabId,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<SidebarState>),
        expandedFolders: new Set<string>(),
      }),
    }
  )
);

