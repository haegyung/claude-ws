import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Project } from '@/types';
import { useTaskStore } from './task-store';
import { useInteractiveCommandStore } from './interactive-command-store';
import { useSidebarStore } from './sidebar-store';
import { useFloatingWindowsStore } from './floating-windows-store';
import {
  fetchProjectsAction,
  createProjectAction,
  updateProjectAction,
  deleteProjectAction,
} from './project-store-crud-api-actions';

interface ProjectState {
  projects: Project[];
  selectedProjectIds: string[];
  activeProjectId: string | null;
  loading: boolean;
  error: string | null;
}

interface ProjectActions {
  toggleProjectSelection: (projectId: string) => void;
  setSelectedProjectIds: (ids: string[]) => void;
  selectAllProjects: () => void;
  setActiveProjectId: (id: string | null) => void;
  isAllProjectsMode: () => boolean;
  getActiveProject: () => Project | null;
  getSelectedProjects: () => Project[];
  fetchProjects: () => Promise<void>;
  createProject: (data: { name: string; path: string }) => Promise<Project>;
  updateProject: (id: string, data: Partial<Pick<Project, 'name' | 'path' | 'autopilotMode'>>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  /** @deprecated Use getActiveProject() instead */
  currentProject: Project | null;
  /** @deprecated Use setActiveProjectId() instead */
  setCurrentProject: (project: Project | null) => void;
}

type ProjectStore = ProjectState & ProjectActions;

/** Close sidebar + tabs whenever project selection changes */
function closeSidebarAndTabs() {
  const sidebar = useSidebarStore.getState();
  sidebar.setIsOpen(false);
  sidebar.closeAllTabs();
  sidebar.closeAllDiffTabs();
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      projects: [],
      selectedProjectIds: [],
      activeProjectId: null,
      loading: true,
      error: null,

      get currentProject() {
        return get().getActiveProject();
      },

      toggleProjectSelection: (projectId) => {
        const { selectedProjectIds, activeProjectId } = get();

        if (selectedProjectIds.length === 0) {
          set({ selectedProjectIds: [projectId], activeProjectId: projectId });
        } else if (selectedProjectIds.includes(projectId)) {
          useFloatingWindowsStore.getState().closeWindowsByProject(projectId);
          const newIds = selectedProjectIds.filter((id) => id !== projectId);
          const newActiveId =
            newIds.length === 1
              ? newIds[0]
              : newIds.includes(activeProjectId || '')
                ? activeProjectId
                : null;
          set({ selectedProjectIds: newIds, activeProjectId: newActiveId });
        } else {
          const newIds = [...selectedProjectIds, projectId];
          const newActiveId = newIds.length === 1 ? newIds[0] : activeProjectId;
          set({ selectedProjectIds: newIds, activeProjectId: newActiveId });
        }

        useTaskStore.getState().selectTask(null);
        useInteractiveCommandStore.getState().closeCommand();
        closeSidebarAndTabs();
      },

      setSelectedProjectIds: (ids) => {
        const { selectedProjectIds } = get();
        const deselected = selectedProjectIds.filter((id) => !ids.includes(id));
        const floatingStore = useFloatingWindowsStore.getState();
        deselected.forEach((projectId) => floatingStore.closeWindowsByProject(projectId));

        set({ selectedProjectIds: ids, activeProjectId: ids.length === 1 ? ids[0] : null });
        useTaskStore.getState().selectTask(null);
        useInteractiveCommandStore.getState().closeCommand();
        closeSidebarAndTabs();
      },

      selectAllProjects: () => {
        set({ selectedProjectIds: [], activeProjectId: null });
        useTaskStore.getState().selectTask(null);
        useInteractiveCommandStore.getState().closeCommand();
      },

      setActiveProjectId: (id) => set({ activeProjectId: id }),

      isAllProjectsMode: () => get().selectedProjectIds.length === 0,

      getActiveProject: () => {
        const { projects, activeProjectId, selectedProjectIds } = get();
        if (selectedProjectIds.length === 1) {
          return projects.find((p) => p.id === selectedProjectIds[0]) || null;
        }
        if (!activeProjectId) return null;
        return projects.find((p) => p.id === activeProjectId) || null;
      },

      getSelectedProjects: () => {
        const { projects, selectedProjectIds } = get();
        if (selectedProjectIds.length === 0) return projects;
        return projects.filter((p) => selectedProjectIds.includes(p.id));
      },

      setCurrentProject: (project) => {
        if (project) {
          set({ selectedProjectIds: [project.id], activeProjectId: project.id });
        } else {
          set({ selectedProjectIds: [], activeProjectId: null });
        }
      },

      fetchProjects: () => fetchProjectsAction(set, get),
      createProject: (data) => createProjectAction(data, set),
      updateProject: (id, data) => updateProjectAction(id, data, set),
      deleteProject: (id) => deleteProjectAction(id, set),
    }),
    {
      name: 'project-store',
      partialize: (state) => ({
        selectedProjectIds: state.selectedProjectIds,
        activeProjectId: state.activeProjectId,
      }),
      skipHydration: true,
    }
  )
);
