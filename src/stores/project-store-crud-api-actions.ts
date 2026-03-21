/**
 * Project Store CRUD API Actions - HTTP fetch actions for project create/read/update/delete
 *
 * Extracted from project-store.ts to keep the store file under 200 lines.
 * All functions call the Next.js API routes and update Zustand state via set/get.
 */

import type { Project } from '@/types';

type SetFn = (
  updater:
    | ((s: ProjectStoreSlice) => Partial<ProjectStoreSlice>)
    | Partial<ProjectStoreSlice>
) => void;

interface ProjectStoreSlice {
  projects: Project[];
  selectedProjectIds: string[];
  activeProjectId: string | null;
  loading: boolean;
  error: string | null;
}

// ── fetchProjects ──────────────────────────────────────────────────────────

export async function fetchProjectsAction(
  set: SetFn,
  get: () => ProjectStoreSlice
): Promise<void> {
  set({ loading: true, error: null });
  try {
    const res = await fetch('/api/projects');
    if (!res.ok) throw new Error('Failed to fetch projects');
    const projects: Project[] = await res.json();

    // Prune stale selectedProjectIds that no longer exist in DB
    const validIds = new Set(projects.map((p: Project) => p.id));
    const { selectedProjectIds, activeProjectId } = get();
    const prunedIds = selectedProjectIds.filter((id) => validIds.has(id));
    const prunedActiveId =
      activeProjectId && validIds.has(activeProjectId) ? activeProjectId : null;

    set({
      projects,
      loading: false,
      selectedProjectIds:
        prunedIds.length !== selectedProjectIds.length ? prunedIds : selectedProjectIds,
      activeProjectId:
        prunedActiveId !== activeProjectId ? prunedActiveId : activeProjectId,
    });
  } catch (error) {
    set({
      error: error instanceof Error ? error.message : 'Unknown error',
      loading: false,
    });
  }
}

// ── createProject ──────────────────────────────────────────────────────────

export async function createProjectAction(
  data: { name: string; path: string },
  set: SetFn
): Promise<Project> {
  set({ loading: true, error: null });
  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create project');
    const project = await res.json();
    set((state) => ({ projects: [...state.projects, project], loading: false }));
    return project;
  } catch (error) {
    set({
      error: error instanceof Error ? error.message : 'Unknown error',
      loading: false,
    });
    throw error;
  }
}

// ── updateProject ──────────────────────────────────────────────────────────

export async function updateProjectAction(
  id: string,
  data: Partial<Pick<Project, 'name' | 'path' | 'autopilotMode'>>,
  set: SetFn
): Promise<void> {
  set({ loading: true, error: null });
  try {
    const res = await fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update project');
    const updated = await res.json();
    set((state) => ({
      projects: state.projects.map((p) => (p.id === id ? updated : p)),
      loading: false,
    }));
  } catch (error) {
    set({
      error: error instanceof Error ? error.message : 'Unknown error',
      loading: false,
    });
    throw error;
  }
}

// ── deleteProject ──────────────────────────────────────────────────────────

export async function deleteProjectAction(id: string, set: SetFn): Promise<void> {
  set({ loading: true, error: null });
  try {
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete project');
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      selectedProjectIds: state.selectedProjectIds.filter((pid) => pid !== id),
      activeProjectId: state.activeProjectId === id ? null : state.activeProjectId,
      loading: false,
    }));
  } catch (error) {
    set({
      error: error instanceof Error ? error.message : 'Unknown error',
      loading: false,
    });
    throw error;
  }
}
