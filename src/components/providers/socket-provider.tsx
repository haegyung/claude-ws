'use client';

import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useRunningTasksStore } from '@/stores/running-tasks-store';
import { useAutopilotStore } from '@/stores/autopilot-store';
import { useTaskStore } from '@/stores/task-store';
import type { Task } from '@/types';

/**
 * Global socket provider that listens for task status updates
 * This ensures task cards show correct status even when task isn't opened
 */
export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const socketInstance = io({
      reconnection: true,
      reconnectionDelay: 1000,
    });

    socketInstance.on('connect', () => {
      // Defer setSocket to avoid setState during render
      Promise.resolve().then(() => setSocket(socketInstance));
    });

    socketInstance.on('disconnect', () => {
      // Socket disconnected
    });

    socketInstance.on('connect_error', () => {
      // Socket connect error
    });

    // Global: Listen for any task starting
    socketInstance.on('task:started', (data: { taskId: string }) => {
      useRunningTasksStore.getState().addRunningTask(data.taskId);
    });

    // Global: Listen for any task finishing
    socketInstance.on('task:finished', (data: { taskId: string; status: string }) => {
      useRunningTasksStore.getState().removeRunningTask(data.taskId);
      if (data.status === 'completed') {
        useRunningTasksStore.getState().markTaskCompleted(data.taskId);
      }
    });

    // Realtime task updates (from autopilot or server-side changes)
    socketInstance.on('task:updated', (task: Task) => {
      const store = useTaskStore.getState();
      const exists = store.tasks.some((t) => t.id === task.id);
      if (exists) {
        store.updateTask(task.id, task);
      } else {
        store.addTask(task);
      }
    });

    // Autopilot status listeners
    socketInstance.on('autopilot:status', (data: { projectId: string } & Record<string, any>) => {
      useAutopilotStore.getState().updateStatus(data.projectId, data);
    });

    socketInstance.on('autopilot:task-started', (data: { projectId: string; taskId: string } & Record<string, any>) => {
      useAutopilotStore.getState().updateStatus(data.projectId, data);
      useRunningTasksStore.getState().addRunningTask(data.taskId);
    });

    socketInstance.on('autopilot:planned', (data: { projectId: string } & Record<string, any>) => {
      useAutopilotStore.getState().updateStatus(data.projectId, data);
    });

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  return <>{children}</>;
}
