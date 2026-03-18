'use client';

import { useCallback, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAutopilotStore } from '@/stores/autopilot-store';

export function useAutopilot(projectId: string | null) {
  const socketRef = useRef<Socket | null>(null);
  const { getProjectState, updateStatus } = useAutopilotStore();

  const state = projectId ? getProjectState(projectId) : {
    enabled: false,
    phase: 'idle' as const,
    currentTaskId: null,
    todoCount: 0,
    processedCount: 0,
    retryCount: 0,
    skippedTaskIds: [],
  };

  useEffect(() => {
    if (!projectId) return;

    const socket = io({
      reconnection: true,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      // Request current status on connect
      socket.emit('autopilot:status-request', { projectId });
    });

    socket.on('autopilot:status', (data: { projectId: string } & Record<string, any>) => {
      if (data.projectId === projectId) {
        updateStatus(data.projectId, data);
      }
    });

    socket.on('autopilot:task-started', (data: { projectId: string } & Record<string, any>) => {
      if (data.projectId === projectId) {
        updateStatus(data.projectId, data);
      }
    });

    socket.on('autopilot:planned', (data: { projectId: string } & Record<string, any>) => {
      if (data.projectId === projectId) {
        updateStatus(data.projectId, data);
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [projectId, updateStatus]);

  const toggle = useCallback(() => {
    if (!projectId || !socketRef.current) return;

    if (state.enabled) {
      socketRef.current.emit('autopilot:disable', { projectId });
    } else {
      socketRef.current.emit('autopilot:enable', { projectId });
    }
  }, [projectId, state.enabled]);

  return {
    enabled: state.enabled,
    phase: state.phase,
    currentTaskId: state.currentTaskId,
    todoCount: state.todoCount,
    processedCount: state.processedCount,
    retryCount: state.retryCount,
    skippedTaskIds: state.skippedTaskIds,
    toggle,
  };
}
