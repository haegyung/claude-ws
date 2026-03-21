import { create } from 'zustand';

export type AutopilotMode = 'off' | 'fully-autonomous' | 'auto-resume';

interface AutopilotState {
  enabled: boolean;
  allowAskUser: boolean;
  mode: AutopilotMode;
  phase: 'idle' | 'planning' | 'processing';
  currentTaskId: string | null;
  processedCount: number;
  retryCount: number;
  skippedTaskIds: string[];
  questionPhase: 'gathering' | 'autonomous' | 'interactive' | 'idle';
  idleTimeoutSeconds: number;
}

interface AutopilotStore extends AutopilotState {
  updateStatus: (data: Record<string, any>) => void;
}

export const useAutopilotStore = create<AutopilotStore>((set) => ({
  enabled: false,
  allowAskUser: false,
  mode: 'off',
  phase: 'idle',
  currentTaskId: null,
  processedCount: 0,
  retryCount: 0,
  skippedTaskIds: [],
  questionPhase: 'idle',
  idleTimeoutSeconds: 60,

  updateStatus: (data) => {
    set((prev) => {
      const update: Partial<AutopilotState> = {};
      if ('enabled' in data) update.enabled = data.enabled;
      if ('allowAskUser' in data) update.allowAskUser = data.allowAskUser;
      if ('mode' in data) update.mode = data.mode;
      if ('phase' in data) update.phase = data.phase;
      if ('currentTaskId' in data) update.currentTaskId = data.currentTaskId;
      if ('processedCount' in data) update.processedCount = data.processedCount;
      if ('retryCount' in data) update.retryCount = data.retryCount;
      if ('skippedTaskIds' in data) update.skippedTaskIds = data.skippedTaskIds;
      if ('questionPhase' in data) update.questionPhase = data.questionPhase;
      if ('idleTimeoutSeconds' in data) update.idleTimeoutSeconds = data.idleTimeoutSeconds;
      return { ...prev, ...update };
    });
  },
}));
