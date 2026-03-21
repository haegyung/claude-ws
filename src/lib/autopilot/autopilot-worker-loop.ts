// Worker loop that polls for stalled in_progress tasks and resumes them
// Runs on a 30s interval per active project
import { eq, and, asc } from 'drizzle-orm';
import { createLogger } from '../logger';
import type { AutopilotMode } from './autopilot-prompt-builder';

const log = createLogger('AutopilotWorker');

const WORKER_INTERVAL_MS = 30_000;

interface WorkerDeps {
  db: any;
  schema: any;
  agentManager: any;
}

interface WorkerCallbacks {
  onResume: (task: any, retryCount: number) => Promise<void>;
  onMaxRetries: (task: any) => Promise<void>;
}

interface WorkerHandle {
  stop: () => void;
}

/**
 * Start a worker loop for a project that checks for stalled in_progress tasks.
 * Returns a handle to stop the interval.
 */
export function startWorkerLoop(
  projectId: string,
  deps: WorkerDeps,
  getMode: () => AutopilotMode,
  getRetryCounts: () => Map<string, number>,
  maxRetries: number,
  callbacks: WorkerCallbacks
): WorkerHandle {
  const intervalId = setInterval(async () => {
    try {
      await checkStalledTasks(projectId, deps, getMode, getRetryCounts, maxRetries, callbacks);
    } catch (err) {
      log.error({ err, projectId }, 'Worker loop error');
    }
  }, WORKER_INTERVAL_MS);

  log.info({ projectId }, 'Worker loop started');

  return {
    stop: () => {
      clearInterval(intervalId);
      log.info({ projectId }, 'Worker loop stopped');
    },
  };
}

async function checkStalledTasks(
  projectId: string,
  deps: WorkerDeps,
  getMode: () => AutopilotMode,
  getRetryCounts: () => Map<string, number>,
  maxRetries: number,
  callbacks: WorkerCallbacks
): Promise<void> {
  const mode = getMode();
  if (mode === 'off') return;

  const { db, schema, agentManager } = deps;

  // Find in_progress tasks for this project
  const inProgressTasks = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.projectId, projectId),
        eq(schema.tasks.status, 'in_progress')
      )
    )
    .orderBy(asc(schema.tasks.position));

  for (const task of inProgressTasks) {
    // Get latest attempt for this task
    const attempts = await db
      .select()
      .from(schema.attempts)
      .where(eq(schema.attempts.taskId, task.id))
      .orderBy(asc(schema.attempts.createdAt));

    const latestAttempt = attempts[attempts.length - 1];
    if (!latestAttempt) continue;

    // Check: is agent still running for this attempt?
    if (agentManager.isRunning(latestAttempt.id)) continue;

    // Check: is there a pending question? (ask mode waits for answers)
    if (agentManager.hasPendingQuestion(latestAttempt.id)) {
      if (mode === 'ask') continue; // wait for user answer
      // autonomous mode: clear question, proceed to resume
      agentManager.clearPersistentQuestion(task.id);
    }

    // Check retry count
    const retryCounts = getRetryCounts();
    const retries = retryCounts.get(task.id) || 0;
    if (retries >= maxRetries) {
      await callbacks.onMaxRetries(task);
      continue;
    }

    // Task is stalled — resume it
    log.info(
      { taskId: task.id, retries, projectId },
      'Worker: detected stalled task, resuming'
    );
    await callbacks.onResume(task, retries);
  }
}
