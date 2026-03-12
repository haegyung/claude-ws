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

    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}/stats`);
        if (res.ok) {
          const data = await res.json();
          setTaskStats(data);
        }
      } catch (error) {
        console.error('Failed to fetch task stats:', error);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [taskId]);

  return taskStats;
}
