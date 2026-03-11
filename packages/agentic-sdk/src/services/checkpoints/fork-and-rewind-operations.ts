/**
 * Checkpoint fork and rewind DB operations service.
 * Handles complex DB transactions for forking a task from a checkpoint
 * and rewinding (deleting) attempts/checkpoints after a given checkpoint.
 */
import { eq, desc, and, lt, gte, asc } from 'drizzle-orm';
import * as schema from '../db/database-schema.ts';
import { generateId } from '../lib/nanoid-id-generator.ts';

export function createCheckpointOperationsService(db: any) {
  return {
    /**
     * Fork a new task from a checkpoint. Copies attempts/checkpoints before the fork point.
     * Returns new task data, original task, checkpoint, and attempt info.
     */
    async fork(checkpointId: string) {
      const checkpoint = await db.select().from(schema.checkpoints)
        .where(eq(schema.checkpoints.id, checkpointId)).get();
      if (!checkpoint) throw new Error('Checkpoint not found');

      const originalTask = await db.select().from(schema.tasks)
        .where(eq(schema.tasks.id, checkpoint.taskId)).get();
      if (!originalTask) throw new Error('Original task not found');

      const attempt = await db.select().from(schema.attempts)
        .where(eq(schema.attempts.id, checkpoint.attemptId)).get();

      // Determine position in todo column
      const tasksInTodo = await db.select().from(schema.tasks)
        .where(and(
          eq(schema.tasks.projectId, originalTask.projectId),
          eq(schema.tasks.status, 'todo')
        ))
        .orderBy(desc(schema.tasks.position))
        .limit(1);

      const position = tasksInTodo.length > 0 ? tasksInTodo[0].position + 1 : 0;
      const newTaskId = generateId('task');
      const truncatedTitle = originalTask.title.length > 74
        ? originalTask.title.slice(0, 74) + '...'
        : originalTask.title;

      const newTask = {
        id: newTaskId,
        projectId: originalTask.projectId,
        title: `Fork: ${truncatedTitle}`,
        description: originalTask.description,
        status: 'todo' as const,
        position,
        chatInit: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await db.insert(schema.tasks).values(newTask);

      // Get checkpoint attempt timestamp for copy boundary
      const checkpointAttempt = await db.select().from(schema.attempts)
        .where(eq(schema.attempts.id, checkpoint.attemptId)).get();
      const cutoffTime = checkpointAttempt?.createdAt ?? checkpoint.createdAt;

      // Copy attempts before the checkpoint
      const attemptIdMap = await this.copyAttemptsBeforeCheckpoint(originalTask.id, newTaskId, cutoffTime);

      // Copy checkpoints before the fork point
      await this.copyCheckpointsBeforeForkPoint(originalTask.id, newTaskId, checkpoint.createdAt, attemptIdMap);

      return {
        newTask,
        newTaskId,
        originalTask,
        checkpoint,
        attempt,
      };
    },

    /**
     * Copy attempts (and their logs) created before the cutoff time from one task to another.
     * Returns a map of old attempt ID -> new attempt ID.
     */
    async copyAttemptsBeforeCheckpoint(
      originalTaskId: string,
      newTaskId: string,
      cutoffTime: number
    ): Promise<Map<string, string>> {
      const originalAttempts = await db.select().from(schema.attempts)
        .where(and(eq(schema.attempts.taskId, originalTaskId), lt(schema.attempts.createdAt, cutoffTime)))
        .orderBy(asc(schema.attempts.createdAt))
        .all();

      const attemptIdMap = new Map<string, string>();

      for (const orig of originalAttempts) {
        const newAttemptId = generateId('atmp');
        attemptIdMap.set(orig.id, newAttemptId);

        await db.insert(schema.attempts).values({
          id: newAttemptId,
          taskId: newTaskId,
          prompt: orig.prompt,
          displayPrompt: orig.displayPrompt,
          status: orig.status,
          sessionId: orig.sessionId,
          branch: orig.branch,
          diffAdditions: orig.diffAdditions,
          diffDeletions: orig.diffDeletions,
          totalTokens: orig.totalTokens,
          inputTokens: orig.inputTokens,
          outputTokens: orig.outputTokens,
          cacheCreationTokens: orig.cacheCreationTokens,
          cacheReadTokens: orig.cacheReadTokens,
          totalCostUSD: orig.totalCostUSD,
          numTurns: orig.numTurns,
          durationMs: orig.durationMs,
          contextUsed: orig.contextUsed,
          contextLimit: orig.contextLimit,
          contextPercentage: orig.contextPercentage,
          baselineContext: orig.baselineContext,
          createdAt: orig.createdAt,
          completedAt: orig.completedAt,
          outputFormat: orig.outputFormat,
          outputSchema: orig.outputSchema,
        });

        // Copy attempt logs
        const logs = await db.select().from(schema.attemptLogs)
          .where(eq(schema.attemptLogs.attemptId, orig.id))
          .orderBy(asc(schema.attemptLogs.createdAt))
          .all();

        for (const logEntry of logs) {
          await db.insert(schema.attemptLogs).values({
            attemptId: newAttemptId,
            type: logEntry.type,
            content: logEntry.content,
            createdAt: logEntry.createdAt,
          });
        }
      }

      return attemptIdMap;
    },

    /**
     * Copy checkpoints created before the fork point from one task to another.
     * Returns count of checkpoints copied.
     */
    async copyCheckpointsBeforeForkPoint(
      originalTaskId: string,
      newTaskId: string,
      forkCheckpointCreatedAt: number,
      attemptIdMap: Map<string, string>
    ): Promise<number> {
      const originalCheckpoints = await db.select().from(schema.checkpoints)
        .where(and(
          eq(schema.checkpoints.taskId, originalTaskId),
          lt(schema.checkpoints.createdAt, forkCheckpointCreatedAt)
        ))
        .orderBy(asc(schema.checkpoints.createdAt))
        .all();

      for (const origCp of originalCheckpoints) {
        const newAttemptId = attemptIdMap.get(origCp.attemptId);
        if (!newAttemptId) continue;
        await db.insert(schema.checkpoints).values({
          id: generateId('chkpt'),
          taskId: newTaskId,
          attemptId: newAttemptId,
          sessionId: origCp.sessionId,
          gitCommitHash: origCp.gitCommitHash,
          messageCount: origCp.messageCount,
          summary: origCp.summary,
          createdAt: origCp.createdAt,
        });
      }

      return originalCheckpoints.length;
    },

    /**
     * Fetch a checkpoint and its related task, attempt, and project data.
     * Used before rewind so callers can perform SDK file rewind with project path.
     */
    async getCheckpointWithRelated(checkpointId: string) {
      const checkpoint = await db.select().from(schema.checkpoints)
        .where(eq(schema.checkpoints.id, checkpointId)).get();
      if (!checkpoint) return null;

      const task = await db.select().from(schema.tasks)
        .where(eq(schema.tasks.id, checkpoint.taskId)).get();

      const attempt = await db.select().from(schema.attempts)
        .where(eq(schema.attempts.id, checkpoint.attemptId)).get();

      const project = task
        ? await db.select().from(schema.projects)
            .where(eq(schema.projects.id, task.projectId)).get()
        : null;

      return { checkpoint, task, attempt, project };
    },

    /**
     * Delete the checkpoint's own attempt and all later attempts (with their logs/files),
     * then delete the checkpoint and all later checkpoints for the same task.
     * Returns counts of deleted items.
     */
    async rewindWithCleanup(checkpointId: string) {
      const checkpoint = await db.select().from(schema.checkpoints)
        .where(eq(schema.checkpoints.id, checkpointId)).get();
      if (!checkpoint) throw new Error('Checkpoint not found');

      const task = await db.select().from(schema.tasks)
        .where(eq(schema.tasks.id, checkpoint.taskId)).get();

      const attempt = await db.select().from(schema.attempts)
        .where(eq(schema.attempts.id, checkpoint.attemptId)).get();

      // Get later attempts + checkpoint's own attempt
      const laterAttempts = await db.select().from(schema.attempts)
        .where(and(
          eq(schema.attempts.taskId, checkpoint.taskId),
          gte(schema.attempts.createdAt, checkpoint.createdAt)
        ))
        .all();

      const attemptIdsToDelete = new Set<string>(laterAttempts.map((a: any) => a.id as string));
      attemptIdsToDelete.add(checkpoint.attemptId as string);

      // Delete attempts and their logs/files
      for (const attemptId of attemptIdsToDelete) {
        await db.delete(schema.attemptLogs).where(eq(schema.attemptLogs.attemptId, attemptId));
        await db.delete(schema.attemptFiles).where(eq(schema.attemptFiles.attemptId, attemptId));
        await db.delete(schema.attempts).where(eq(schema.attempts.id, attemptId));
      }

      // Delete this checkpoint and all after it
      const deletedCheckpoints = await db.delete(schema.checkpoints).where(
        and(
          eq(schema.checkpoints.taskId, checkpoint.taskId),
          gte(schema.checkpoints.createdAt, checkpoint.createdAt)
        )
      ).returning();

      return {
        checkpoint,
        task,
        attempt,
        deletedAttemptCount: attemptIdsToDelete.size,
        deletedCheckpointCount: deletedCheckpoints.length,
      };
    },
  };
}
