import { useState, useEffect } from 'react';

export interface TaskStats {
  totalTokens: number;
  totalCostUSD: number;
  totalTurns: number;
  totalDurationMs: number;
  totalAdditions: number;
  totalDeletions: number;
  filesChanged: number;
  contextUsed: number;
  contextLimit: number;
  contextPercentage: number;
}

// Polls /api/tasks/:id/stats every 5s while mounted
export function useTaskStats(taskId?: string) {
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null);

  useEffect(() => {
    if (!taskId) return;

    const controller = new AbortController();

    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}/stats`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          setTaskStats(data);
        }
      } catch {
        // Silently ignore — polling retries in 5s anyway.
        // Common causes: component unmount (AbortError), HMR rebuild, pm2 restart.
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [taskId]);

  return taskStats;
}
