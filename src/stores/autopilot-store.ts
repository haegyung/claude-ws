import { create } from 'zustand';

interface AutopilotState {
  mode: 'off' | 'autonomous' | 'ask';
  enabled: boolean;
  phase: 'idle' | 'planning' | 'processing';
  currentTaskId: string | null;
  todoCount: number;
  processedCount: number;
  retryCount: number;
  skippedTaskIds: string[];
}

interface AutopilotStore {
  projects: Map<string, AutopilotState>;
  updateStatus: (projectId: string, state: Record<string, any>) => void;
  isEnabled: (projectId: string) => boolean;
  getProjectState: (projectId: string) => AutopilotState;
}

const defaultState: AutopilotState = {
  mode: 'off',
  enabled: false,
  phase: 'idle',
  currentTaskId: null,
  todoCount: 0,
  processedCount: 0,
  retryCount: 0,
  skippedTaskIds: [],
};

export const useAutopilotStore = create<AutopilotStore>((set, get) => ({
  projects: new Map<string, AutopilotState>(),

  updateStatus: (projectId, data) => {
    set((prev) => {
      const newMap = new Map(prev.projects);
      const current = newMap.get(projectId) || { ...defaultState };
      const update: Partial<AutopilotState> = {};
      if ('mode' in data) {
        update.mode = data.mode;
        update.enabled = data.mode !== 'off';
      }
      if ('enabled' in data) update.enabled = data.enabled;
      if ('phase' in data) update.phase = data.phase;
      if ('currentTaskId' in data) update.currentTaskId = data.currentTaskId;
      if ('todoCount' in data) update.todoCount = data.todoCount;
      if ('processedCount' in data) update.processedCount = data.processedCount;
      if ('retryCount' in data) update.retryCount = data.retryCount;
      if ('skippedTaskIds' in data) update.skippedTaskIds = data.skippedTaskIds;
      newMap.set(projectId, { ...current, ...update });
      return { projects: newMap };
    });
  },

  isEnabled: (projectId) => {
    return get().projects.get(projectId)?.enabled ?? false;
  },

  getProjectState: (projectId) => {
    return get().projects.get(projectId) || { ...defaultState };
  },
}));
