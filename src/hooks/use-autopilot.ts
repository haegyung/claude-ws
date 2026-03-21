'use client';

import { useCallback, useEffect } from 'react';
import { useAutopilotStore, type AutopilotMode } from '@/stores/autopilot-store';

const POLL_INTERVAL_MS = 5000;

/** Fetch autopilot status from server */
async function fetchStatus() {
  try {
    const res = await fetch('/api/autopilot/status');
    if (res.ok) {
      const data = await res.json();
      useAutopilotStore.getState().updateStatus(data);
    }
  } catch {
    // Silently fail — next poll will retry
  }
}

/** Cycle order for the 3-mode toggle */
const MODE_CYCLE: AutopilotMode[] = ['off', 'fully-autonomous', 'auto-resume'];

/** Workspace-wide autopilot hook */
export function useAutopilot() {
  const { enabled, allowAskUser, mode, phase, currentTaskId, processedCount, retryCount, skippedTaskIds, questionPhase, idleTimeoutSeconds } = useAutopilotStore();

  // Poll status on mount + every 5s
  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  /** Set autopilot mode directly */
  const setMode = useCallback(async (newMode: AutopilotMode) => {
    try {
      const res = await fetch('/api/autopilot/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      if (res.ok) {
        const data = await res.json();
        useAutopilotStore.getState().updateStatus(data);
      }
    } catch {
      // Next poll will sync
    }
  }, []);

  /** Cycle through modes: off → fully-autonomous → auto-resume → off */
  const cycleMode = useCallback(async () => {
    const currentIndex = MODE_CYCLE.indexOf(mode);
    const nextMode = MODE_CYCLE[(currentIndex + 1) % MODE_CYCLE.length];
    await setMode(nextMode);
  }, [mode, setMode]);

  // Legacy toggle — kept for backward compat (kanban toggle)
  const toggle = useCallback(async () => {
    await setMode(enabled ? 'off' : 'fully-autonomous');
  }, [enabled, setMode]);

  const toggleAllowAskUser = useCallback(async () => {
    await setMode(allowAskUser ? 'fully-autonomous' : 'auto-resume');
  }, [allowAskUser, setMode]);

  const setIdleTimeout = useCallback(async (seconds: number) => {
    try {
      const res = await fetch('/api/autopilot/idle-timeout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seconds }),
      });
      if (res.ok) {
        const data = await res.json();
        useAutopilotStore.getState().updateStatus(data);
      }
    } catch {
      // Next poll will sync
    }
  }, []);

  return {
    enabled,
    allowAskUser,
    mode,
    phase,
    currentTaskId,
    processedCount,
    retryCount,
    skippedTaskIds,
    questionPhase,
    idleTimeoutSeconds,
    toggle,
    toggleAllowAskUser,
    cycleMode,
    setMode,
    setIdleTimeout,
  };
}
