/**
 * Force-create project and task service - handles auto-creation of project directories,
 * project records, and task records when they don't exist during attempt creation.
 * Used by both the Next.js API route and Socket.io handler in server.ts.
 */
import { eq, and, desc } from 'drizzle-orm';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import * as schema from '../db/database-schema';

/** Sanitize directory name: lowercase, remove special chars, hyphenate spaces */
export function sanitizeDirName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface ForceCreateParams {
  taskId: string;
  projectId: string;
  projectName?: string;
  taskTitle: string;
  projectRootPath?: string;
  /** Fallback base path when projectRootPath is not provided (e.g. userCwd or process.cwd()) */
  defaultBasePath: string;
}

export interface ForceCreateResult {
  task: typeof schema.tasks.$inferSelect;
  project: typeof schema.projects.$inferSelect;
}

export function createForceCreateService(db: any) {
  return {
    /**
     * Ensure project and task exist, creating them if needed.
     * Returns the resolved task and project records.
     * Throws descriptive errors on validation failures.
     */
    async ensureProjectAndTask(params: ForceCreateParams): Promise<ForceCreateResult> {
      const { taskId, projectId, projectName, taskTitle, projectRootPath, defaultBasePath } = params;

      // Check if project exists
      let project = await db.select().from(schema.projects)
        .where(eq(schema.projects.id, projectId)).get();

      // Create project if it doesn't exist
      if (!project) {
        if (!projectName || projectName.trim() === '') {
          throw new ForceCreateError('projectName required', 400);
        }

        const sanitized = sanitizeDirName(projectName);
        if (!sanitized) {
          throw new ForceCreateError('projectName must contain at least one alphanumeric character', 400);
        }

        const projectDirName = projectId;
        const projectPath = projectRootPath
          ? join(projectRootPath, projectDirName)
          : join(defaultBasePath, 'data', 'projects', projectDirName);

        // Create directory
        try {
          await mkdir(projectPath, { recursive: true });
        } catch (err: any) {
          if (err?.code !== 'EEXIST') {
            throw new ForceCreateError('Failed to create project folder: ' + err.message, 500);
          }
        }

        // Insert project record
        await db.insert(schema.projects).values({
          id: projectId,
          name: projectName,
          path: projectPath,
          createdAt: Date.now(),
        });

        project = await db.select().from(schema.projects)
          .where(eq(schema.projects.id, projectId)).get();
      }

      // Create task
      if (!taskTitle || taskTitle.trim() === '') {
        throw new ForceCreateError('taskTitle required', 400);
      }

      const tasksInStatus = await db.select().from(schema.tasks)
        .where(and(eq(schema.tasks.projectId, projectId), eq(schema.tasks.status, 'todo')))
        .orderBy(desc(schema.tasks.position))
        .limit(1);

      const position = tasksInStatus.length > 0 ? tasksInStatus[0].position + 1 : 0;
      const now = Date.now();

      await db.insert(schema.tasks).values({
        id: taskId,
        projectId,
        title: taskTitle,
        description: null,
        status: 'todo',
        position,
        chatInit: false,
        rewindSessionId: null,
        rewindMessageUuid: null,
        createdAt: now,
        updatedAt: now,
      });

      const task = await db.select().from(schema.tasks)
        .where(eq(schema.tasks.id, taskId)).get();

      return { task, project };
    },
  };
}

/** Typed error with HTTP status code for force-create failures */
export class ForceCreateError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'ForceCreateError';
  }
}
