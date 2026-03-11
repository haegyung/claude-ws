/**
 * Attempt workflow tree service - queries subagents from DB and builds workflow tree
 * for completed attempts. Live/running attempts use workflowTracker (in-memory, stays in route).
 */
import { eq } from 'drizzle-orm';
import * as schema from '../db/database-schema.ts';

export function createAttemptWorkflowService(db: any) {
  return {
    /** Get workflow tree from DB for a completed attempt */
    async getWorkflowFromDb(attemptId: string) {
      const subagents = await db.query.subagents.findMany({
        where: eq(schema.subagents.attemptId, attemptId),
      });

      if (subagents.length === 0) {
        return {
          source: 'db' as const,
          nodes: [],
          messages: [],
          summary: { chain: [] as string[], completedCount: 0, activeCount: 0, totalCount: 0 },
        };
      }

      const rootNodes = subagents.filter((s: any) => !s.parentId);
      const chain = rootNodes.map((s: any) => s.name || s.type);
      const completedCount = subagents.filter((s: any) => s.status === 'completed').length;
      const activeCount = subagents.filter((s: any) => s.status === 'in_progress').length;

      const nodes = subagents
        .sort((a: any, b: any) => {
          if (a.depth !== b.depth) return a.depth - b.depth;
          return (a.startedAt || 0) - (b.startedAt || 0);
        })
        .map((s: any) => ({
          id: s.id,
          type: s.type,
          name: s.name,
          status: s.status,
          parentId: s.parentId,
          depth: s.depth,
          teamName: s.teamName,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
          durationMs: s.durationMs,
          error: s.error,
        }));

      return {
        source: 'db' as const,
        nodes,
        messages: [],
        summary: { chain, completedCount, activeCount, totalCount: subagents.length },
      };
    },
  };
}
