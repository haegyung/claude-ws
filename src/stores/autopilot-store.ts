import { create } from 'zustand';

interface AutopilotState {
  enabled: boolean;
  phase: 'idle' | 'planning' | 'processing';
  currentTaskId: string | null;
  processedCount: number;
  retryCount: number;
  skippedTaskIds: string[];
}

interface AutopilotStore extends AutopilotState {
  updateStatus: (data: Record<string, any>) => void;
}

export const useAutopilotStore = create<AutopilotStore>((set) => ({
  enabled: false,
  phase: 'idle',
  currentTaskId: null,
  processedCount: 0,
  retryCount: 0,
  skippedTaskIds: [],

  updateStatus: (data) => {
    set((prev) => {
      const update: Partial<AutopilotState> = {};
      if ('enabled' in data) update.enabled = data.enabled;
      if ('phase' in data) update.phase = data.phase;
      if ('currentTaskId' in data) update.currentTaskId = data.currentTaskId;
      if ('processedCount' in data) update.processedCount = data.processedCount;
      if ('retryCount' in data) update.retryCount = data.retryCount;
      if ('skippedTaskIds' in data) update.skippedTaskIds = data.skippedTaskIds;
      return { ...prev, ...update };
    });
  },
}));
