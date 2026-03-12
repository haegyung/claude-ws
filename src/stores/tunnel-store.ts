import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  startTunnelAction,
  stopTunnelAction,
  fetchTunnelStatusAction,
  checkOnboardingAction,
  resetOnboardingAction,
  getTunnelConfigAction,
  initSocketListenersAction,
  type TunnelConfig,
} from './tunnel-store-api-and-socket-actions';

interface TunnelState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  url: string | null;
  error: string | null;
  wizardOpen: boolean;
  wizardStep: number;
  selectedMethod: 'ctunnel' | 'cloudflare' | null;
  onboardingCompleted: boolean;

  setWizardOpen: (open: boolean) => void;
  setWizardStep: (step: number) => void;
  setSelectedMethod: (method: 'ctunnel' | 'cloudflare') => void;
  startTunnel: (subdomain?: string) => Promise<void>;
  stopTunnel: () => Promise<void>;
  fetchStatus: () => Promise<void>;
  checkOnboarding: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  resetOnboarding: () => Promise<void>;
  getTunnelConfig: () => Promise<TunnelConfig | null>;
  initSocketListeners: () => void;
}

export const useTunnelStore = create<TunnelState>()(
  persist(
    (set) => ({
      status: 'disconnected',
      url: null,
      error: null,
      wizardOpen: false,
      wizardStep: 0,
      selectedMethod: null,
      onboardingCompleted: false,

      setWizardOpen: (open) => set({ wizardOpen: open }),
      setWizardStep: (step) => set({ wizardStep: step }),
      setSelectedMethod: (method) => set({ selectedMethod: method }),
      completeOnboarding: async () => { set({ onboardingCompleted: true }); },

      // API/socket actions — delegated to tunnel-store-api-and-socket-actions
      startTunnel: (subdomain) => startTunnelAction(subdomain, set),
      stopTunnel: () => stopTunnelAction(set),
      fetchStatus: () => fetchTunnelStatusAction(set),
      checkOnboarding: () => checkOnboardingAction(set),
      resetOnboarding: () => resetOnboardingAction(set),
      getTunnelConfig: () => getTunnelConfigAction(),
      initSocketListeners: () => initSocketListenersAction(set),
    }),
    {
      name: 'tunnel-storage',
      partialize: () => ({}),
    }
  )
);
