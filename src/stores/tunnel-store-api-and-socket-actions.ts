/**
 * Tunnel Store API and Socket Actions - HTTP fetch and Socket.io actions for tunnel lifecycle management
 *
 * Extracted from tunnel-store.ts to keep the store file under 200 lines.
 * Contains: startTunnel, stopTunnel, fetchStatus, checkOnboarding,
 * resetOnboarding, getTunnelConfig, initSocketListeners.
 */

import { getSocket } from '@/lib/socket-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('TunnelStore');

interface TunnelStoreSlice {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  url: string | null;
  error: string | null;
  onboardingCompleted: boolean;
  wizardOpen: boolean;
  wizardStep: number;
}

type SetFn = (
  updater:
    | ((s: TunnelStoreSlice) => Partial<TunnelStoreSlice>)
    | Partial<TunnelStoreSlice>
) => void;

// Track if socket listeners have been initialized to prevent duplicates
let socketListenersInitialized = false;

// ── startTunnel ────────────────────────────────────────────────────────────

export async function startTunnelAction(subdomain: string | undefined, set: SetFn): Promise<void> {
  set({ status: 'connecting', error: null });
  try {
    const res = await fetch('/api/tunnel/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subdomain }),
    });
    const data = await res.json();
    if (data.success) {
      set({ status: 'connected', url: data.url });
    } else {
      set({ status: 'error', error: data.error || 'Failed to start tunnel' });
    }
  } catch (err) {
    set({ status: 'error', error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

// ── stopTunnel ─────────────────────────────────────────────────────────────

export async function stopTunnelAction(set: SetFn): Promise<void> {
  try {
    await fetch('/api/tunnel/stop', { method: 'POST' });
    set({ status: 'disconnected', url: null, error: null });
  } catch (err) {
    log.error({ err }, 'Failed to stop tunnel');
  }
}

// ── fetchStatus ────────────────────────────────────────────────────────────

export async function fetchTunnelStatusAction(set: SetFn): Promise<void> {
  try {
    const res = await fetch('/api/tunnel/status');
    if (res.status === 401) return; // Not authenticated, skip
    const data = await res.json();
    set({ status: data.status, url: data.url, error: data.error });
  } catch (err) {
    log.error({ err }, 'Failed to fetch tunnel status');
  }
}

// ── checkOnboarding ────────────────────────────────────────────────────────

export async function checkOnboardingAction(set: SetFn): Promise<void> {
  try {
    const localCompleted = localStorage.getItem('onboarding_completed') === 'true';
    if (localCompleted) {
      set({ onboardingCompleted: true });
      return;
    }

    const res = await fetch('/api/settings?keys=tunnel_subdomain,tunnel_apikey');
    if (res.status === 401) {
      set({ wizardOpen: false });
      return;
    }
    const data = await res.json();
    const completed = !!(data.tunnel_subdomain && data.tunnel_apikey);
    set({ onboardingCompleted: completed });
  } catch (err) {
    log.error({ err }, 'Failed to check onboarding');
  }
}

// ── resetOnboarding ────────────────────────────────────────────────────────

export async function resetOnboardingAction(set: SetFn): Promise<void> {
  try {
    await fetch('/api/tunnel/stop', { method: 'POST' });
    await fetch(
      '/api/settings?keys=tunnel_subdomain,tunnel_email,tunnel_apikey,tunnel_plan,tunnel_url,tunnel_enabled',
      { method: 'DELETE' }
    );
    localStorage.removeItem('onboarding_completed');
    set({
      onboardingCompleted: false,
      wizardStep: 0,
      wizardOpen: true,
      status: 'disconnected',
      url: null,
      error: null,
    });
  } catch (err) {
    log.error({ err }, 'Failed to reset onboarding');
  }
}

export interface TunnelPlan {
  type: string;
  name: string;
  status: string;
  ends_at: string;
  days: number;
  price_cents: number;
}

export interface TunnelConfig {
  subdomain: string | null;
  email: string | null;
  apiKey: string | null;
  plan: TunnelPlan | null;
}

// ── getTunnelConfig ────────────────────────────────────────────────────────

export async function getTunnelConfigAction(): Promise<TunnelConfig | null> {
  try {
    const res = await fetch('/api/settings?keys=tunnel_subdomain,tunnel_email,tunnel_apikey,tunnel_plan');
    if (res.status === 401) return null;
    const data = await res.json();

    if (!data.tunnel_subdomain || !data.tunnel_apikey) return null;

    let plan = null;
    if (data.tunnel_plan) {
      try { plan = JSON.parse(data.tunnel_plan); } catch { plan = null; }
    }

    return {
      subdomain: data.tunnel_subdomain || null,
      email: data.tunnel_email || null,
      apiKey: data.tunnel_apikey || null,
      plan,
    };
  } catch (err) {
    log.error({ err }, 'Failed to get tunnel config');
    return null;
  }
}

// ── initSocketListeners ────────────────────────────────────────────────────

export function initSocketListenersAction(set: SetFn): void {
  if (socketListenersInitialized) return;

  const socket = getSocket();

  socket.on('tunnel:status', (data) => {
    set({ status: data.status, url: data.url, error: data.error });
  });

  socket.on('tunnel:connected', ({ url }) => {
    set({ status: 'connected', url, error: null });
  });

  socket.on('tunnel:error', ({ error }) => {
    set({ status: 'error', error });
  });

  socket.on('tunnel:closed', () => {
    set({ status: 'disconnected', url: null, error: null });
  });

  socket.on('connect', async () => {
    try {
      const res = await fetch('/api/tunnel/status');
      const data = await res.json();
      set({ status: data.status, url: data.url, error: data.error });
    } catch {
      // Ignore fetch errors on connect
    }
  });

  socketListenersInitialized = true;
}
