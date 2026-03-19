'use client';

import { useCallback, useEffect } from 'react';
import { useAutopilotStore } from '@/stores/autopilot-store';

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

/** Workspace-wide autopilot hook */
export function useAutopilot() {
  const { enabled, phase, currentTaskId, processedCount, retryCount, skippedTaskIds } = useAutopilotStore();

  // Poll status on mount + every 5s
  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const toggle = useCallback(async () => {
    try {
      const res = await fetch('/api/autopilot/toggle', { method: 'POST' });
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
    phase,
    currentTaskId,
    processedCount,
    retryCount,
    skippedTaskIds,
    toggle,
  };
}
