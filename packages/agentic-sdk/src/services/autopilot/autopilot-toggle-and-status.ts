/**
 * Autopilot service — toggle and status operations.
 * Wraps an AutopilotManager instance for use by SDK routes and Next.js API routes.
 */
import { eq, and, asc } from 'drizzle-orm';

export interface AutopilotStatus {
  enabled: boolean;
  phase: 'idle' | 'planning' | 'processing';
  currentTaskId: string | null;
  processedCount: number;
  retryCount: number;
  skippedTaskIds: string[];
}

export interface AutopilotManagerLike {
  isEnabled(): boolean;
  enable(db: any, schema: any): Promise<void>;
  disable(db: any, schema: any): Promise<void>;
  getStatus(): AutopilotStatus;
  planAndReorder(projectId: string, deps: any): Promise<void>;
}

export interface AutopilotServiceDeps {
  db: any;
  schema: any;
  io: any;
  agentManager: any;
  sessionManager: any;
}

export function createAutopilotService(
  manager: AutopilotManagerLike,
  deps: AutopilotServiceDeps,
) {
  return {
    getStatus(): AutopilotStatus {
      return manager.getStatus();
    },

    async toggle(): Promise<AutopilotStatus> {
      const { db, schema, io, agentManager, sessionManager } = deps;
      const wasEnabled = manager.isEnabled();

      if (wasEnabled) {
        await manager.disable(db, schema);
      } else {
        await manager.enable(db, schema);
      }

      const status = manager.getStatus();

      // If just enabled, start planning for all projects with todo tasks
      if (!wasEnabled) {
        const projects = await db.select().from(schema.projects);
        for (const project of projects) {
          const todoTasks = await db
            .select()
            .from(schema.tasks)
            .where(
              and(
                eq(schema.tasks.projectId, project.id),
                eq(schema.tasks.status, 'todo'),
              ),
            )
            .limit(1);

          if (todoTasks.length > 0) {
            manager.planAndReorder(project.id, {
              db, io, schema, agentManager, sessionManager,
            });
          }
        }
      }

      return status;
    },
  };
}

export type AutopilotService = ReturnType<typeof createAutopilotService>;
