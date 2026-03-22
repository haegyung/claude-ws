'use client';

import { create } from 'zustand';
import { Model, DEFAULT_MODEL_ID, getModelShortName } from '@/lib/models';
import { createLogger } from '@/lib/logger';

const log = createLogger('ModelStore');

const LAST_USED_MODEL_KEY = 'claudews-last-used-model';
const LAST_USED_PROVIDER_KEY = 'claudews-last-used-provider';

interface ModelStore {
  // Global default model (from env/cached/default)
  defaultModel: string;
  defaultProvider: string;
  // Last used model (persisted across sessions via localStorage)
  lastUsedModel: string | null;
  lastUsedProvider: string | null;
  // Per-task model overrides
  taskModels: Record<string, string>;
  taskProviders: Record<string, string>;
  availableModels: Model[];
  isLoading: boolean;
  source: 'env' | 'cached' | 'default' | null;
  loadModels: () => Promise<void>;
  setModel: (modelId: string, taskId?: string) => Promise<void>;
  getTaskModel: (taskId: string, taskLastModel?: string | null) => string;
  getTaskProvider: (taskId: string, taskLastProvider?: string | null) => string;
  getShortName: (taskId?: string, taskLastModel?: string | null) => string;
}

export const useModelStore = create<ModelStore>((set, get) => ({
  defaultModel: DEFAULT_MODEL_ID,
  defaultProvider: 'claude-cli', // Will be updated after loading models based on availability
  lastUsedModel: typeof window !== 'undefined' ? localStorage.getItem(LAST_USED_MODEL_KEY) : null,
  lastUsedProvider: typeof window !== 'undefined' ? localStorage.getItem(LAST_USED_PROVIDER_KEY) : null,
  taskModels: {},
  taskProviders: {},
  availableModels: [],
  isLoading: false,
  source: null,

  loadModels: async () => {
    try {
      set({ isLoading: true });

      const response = await fetch('/api/models', {
        headers: {
          'x-api-key': localStorage.getItem('apiKey') || '',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch models');
      }

      const data = await response.json();

      // Determine default provider based on available models
      // If CLI models exist, default to claude-cli, otherwise claude-sdk
      const hasCliModels = data.models?.some((m: Model) => m.provider === 'claude-cli' || !m.provider);
      const defaultProvider = data.currentProvider || (hasCliModels ? 'claude-cli' : 'claude-sdk');

      set({
        availableModels: data.models,
        defaultModel: data.current,
        defaultProvider,
        source: data.source,
        isLoading: false,
      });
    } catch (error) {
      log.error({ error }, 'Error loading models');
      set({ isLoading: false });
    }
  },

  // Set model for a task (saves to task.lastModel + lastProvider)
  setModel: async (modelId: string, taskId?: string) => {
    const { taskModels, taskProviders, availableModels } = get();
    const model = availableModels.find(m => m.id === modelId);

    // Determine provider from model, or infer from available models
    let provider = model?.provider;
    if (!provider && availableModels.length > 0) {
      const hasCliModels = availableModels.some(m => m.provider === 'claude-cli' || !m.provider);
      provider = hasCliModels ? 'claude-cli' : 'claude-sdk';
    }
    provider = provider || 'claude-sdk';

    // Always persist as last-used model for new task creation
    try {
      localStorage.setItem(LAST_USED_MODEL_KEY, modelId);
      localStorage.setItem(LAST_USED_PROVIDER_KEY, provider);
    } catch { /* localStorage unavailable */ }
    set({ lastUsedModel: modelId, lastUsedProvider: provider });

    if (taskId) {
      // Update local state for this task
      set({
        taskModels: { ...taskModels, [taskId]: modelId },
        taskProviders: { ...taskProviders, [taskId]: provider },
      });

      // Save to task's lastModel + lastProvider
      try {
        const response = await fetch(`/api/tasks/${taskId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': localStorage.getItem('apiKey') || '',
          },
          body: JSON.stringify({ lastModel: modelId, lastProvider: provider }),
        });

        if (!response.ok) {
          // 404 is expected for temp tasks (task not yet created)
          // Keep local state but don't throw - task will get model on creation
          if (response.status === 404) {
            log.debug({ taskId }, 'Task not found (temp task), keeping local state only');
            return;
          }
          // Rollback on other errors
          const newTaskModels = { ...taskModels };
          const newTaskProviders = { ...taskProviders };
          delete newTaskModels[taskId];
          delete newTaskProviders[taskId];
          set({ taskModels: newTaskModels, taskProviders: newTaskProviders });
          const errorText = await response.text();
          log.error({ status: response.status, errorText }, 'Failed to save task model');
          throw new Error(`Failed to save task model: ${response.status}`);
        }
      } catch (error) {
        log.error({ error, taskId }, 'Error setting model');
      }
    } else {
      // No taskId: save as global default
      try {
        const response = await fetch('/api/models', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': localStorage.getItem('apiKey') || '',
          },
          body: JSON.stringify({ model: modelId }),
        });

        if (!response.ok) {
          throw new Error('Failed to save model');
        }

        set({ defaultModel: modelId, source: 'cached' });
      } catch (error) {
        log.error({ error, modelId }, 'Error setting model');
      }
    }
  },

  // Get model for a specific task
  getTaskModel: (taskId: string, taskLastModel?: string | null) => {
    const { taskModels, defaultModel, availableModels, lastUsedModel } = get();
    // Priority: local state > task.lastModel > last used > default
    const candidate = taskModels[taskId] || taskLastModel || lastUsedModel || defaultModel;

    // Validate that the model exists in available models
    // If not (due to provider change), fall back to default
    if (availableModels.length > 0 && candidate !== defaultModel) {
      const modelExists = availableModels.some((m) => m.id === candidate);
      if (!modelExists) {
        return defaultModel;
      }
    }

    return candidate;
  },

  // Get provider for a specific task
  getTaskProvider: (taskId: string, taskLastProvider?: string | null) => {
    const { taskProviders, defaultProvider, lastUsedProvider, availableModels } = get();

    // Determine provider from various sources with proper fallback
    let provider = taskProviders[taskId] || taskLastProvider || lastUsedProvider || defaultProvider;

    // If still no provider, infer from available models
    if (!provider && availableModels.length > 0) {
      const hasCliModels = availableModels.some(m => m.provider === 'claude-cli' || !m.provider);
      provider = hasCliModels ? 'claude-cli' : 'claude-sdk';
    }

    return provider || 'claude-sdk';
  },

  getShortName: (taskId?: string, taskLastModel?: string | null) => {
    const { taskModels, defaultModel, availableModels, lastUsedModel } = get();
    let model = taskId
      ? taskModels[taskId] || taskLastModel || lastUsedModel || defaultModel
      : defaultModel;

    // Validate that the model exists in available models
    // If not (due to provider change), fall back to default
    if (availableModels.length > 0 && model !== defaultModel) {
      const modelExists = availableModels.some((m) => m.id === model);
      if (!modelExists) {
        model = defaultModel;
      }
    }

    return getModelShortName(model || defaultModel);
  },
}));
