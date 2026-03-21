import { eq } from 'drizzle-orm';
import { createLogger } from './logger';
import { validateAttemptCompletion } from './autopilot-attempt-completion-validator';
import { activityTracker } from './autopilot-activity-tracker';

const log = createLogger('AutopilotWorker');
const SWEEP_INTERVAL_MS = 30_000; // 30 seconds

interface WorkerDeps {
  db: any;
  schema: any;
  io: any;
  agentManager: any;
  autopilotManager: any;
  sessionManager: any;
}

export class AutopilotWorker {
  private interval: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;

  constructor(private deps: WorkerDeps) {}

  start(): void {
    if (this.interval) return;
    log.info('Starting autopilot worker (sweep every 30s)');
    this.interval = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.interval.unref();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      log.info('Autopilot worker stopped');
    }
  }

  /**
   * One-time startup sweep: fix all historically stuck tasks.
   * Runs before accepting connections, no socket events emitted.
   */
  async sweepOnStartup(): Promise<void> {
    const { db, schema, agentManager } = this.deps;

    log.info('Running startup sweep for stuck tasks...');

    // 1. Fix stale 'running' attempts (no live agent)
    const runningAttempts = await db
      .select()
      .from(schema.attempts)
      .where(eq(schema.attempts.status, 'running'));

    let fixedAttempts = 0;
    for (const attempt of runningAttempts) {
      if (!agentManager.isRunning(attempt.id)) {
        await db
          .update(schema.attempts)
          .set({ status: 'failed', completedAt: Date.now() })
          .where(eq(schema.attempts.id, attempt.id));
        fixedAttempts++;
      }
    }

    // 2. Fix in_progress tasks whose latest attempt is completed
    const inProgressTasks = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.status, 'in_progress'));

    let recoveredTasks = 0;
    for (const task of inProgressTasks) {
      const attempts = await db
        .select()
        .from(schema.attempts)
        .where(eq(schema.attempts.taskId, task.id));

      if (attempts.length === 0) continue;

      // Skip if any agent is genuinely still running
      const hasLiveAgent = attempts.some(
        (a: any) => a.status === 'running' && agentManager.isRunning(a.id)
      );
      if (hasLiveAgent) continue;

      // After restart, no live agent → keep in_progress and let autopilot retry.
      // Don't auto-promote to in_review — the task may have been interrupted mid-work.
      const latestAttempt = attempts.reduce((latest: any, a: any) =>
        (a.createdAt || 0) > (latest.createdAt || 0) ? a : latest,
      );
      log.info(
        { taskId: task.id, latestStatus: latestAttempt.status },
        'Startup: no live agent, keeping in_progress for autopilot retry',
      );
      const { autopilotManager } = this.deps;
      if (autopilotManager.isEnabled()) {
        await autopilotManager.onTaskFinished(task.id, latestAttempt.status, this.deps);
        recoveredTasks++;
      }
    }

    log.info(
      { fixedAttempts, recoveredTasks, totalInProgress: inProgressTasks.length },
      'Startup sweep complete'
    );
  }

  /**
   * Periodic sweep: detect orphaned in_progress tasks whose agent died.
   */
  private async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;

    try {
      const { db, schema, agentManager } = this.deps;

      const inProgressTasks = await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.status, 'in_progress'));

      if (inProgressTasks.length === 0) {
        return;
      }

      for (const task of inProgressTasks) {
        await this.checkTask(task);
      }
    } catch (error) {
      log.error({ error }, 'Sweep failed');
    } finally {
      this.sweeping = false;
    }
  }

  private async checkTask(task: any): Promise<void> {
    const { db, schema, agentManager } = this.deps;

    // Find all attempts for this task, ordered by creation time
    const attempts = await db
      .select()
      .from(schema.attempts)
      .where(eq(schema.attempts.taskId, task.id));

    if (attempts.length === 0) return;

    // If ANY attempt has a live agent, check for idle timeout before skipping
    const hasLiveAgent = attempts.some(
      (a: any) => a.status === 'running' && agentManager.isRunning(a.id),
    );
    if (hasLiveAgent) {
      const { autopilotManager } = this.deps;
      if (autopilotManager.isEnabled()) {
        const latestRunning = attempts.find(
          (a: any) => a.status === 'running' && agentManager.isRunning(a.id),
        );
        if (latestRunning) {
          const timeoutMs = autopilotManager.getIdleTimeoutMs();
          if (activityTracker.isIdle(latestRunning.id, timeoutMs)) {
            log.warn(
              { taskId: task.id, attemptId: latestRunning.id, timeoutMs },
              'Idle timeout exceeded, cancelling stale attempt'
            );
            agentManager.cancel(latestRunning.id);
            await db.update(schema.attempts)
              .set({ status: 'failed', completedAt: Date.now() })
              .where(eq(schema.attempts.id, latestRunning.id));
            activityTracker.remove(latestRunning.id);
            await this.recoverTask(task, { ...latestRunning, status: 'failed' });
          }
        }
      }
      return;
    }

    // Get latest attempt by createdAt (don't rely on array order)
    const latestAttempt = attempts.reduce((latest: any, a: any) =>
      (a.createdAt || 0) > (latest.createdAt || 0) ? a : latest,
    );

    // Attempt 'running' in DB but agent is dead → mark as failed first
    if (latestAttempt.status === 'running' && !agentManager.isRunning(latestAttempt.id)) {
      await db
        .update(schema.attempts)
        .set({ status: 'failed', completedAt: Date.now() })
        .where(eq(schema.attempts.id, latestAttempt.id));

      log.info(
        { taskId: task.id, attemptId: latestAttempt.id },
        'Marked orphaned attempt as failed',
      );
    }

    // No live agent → delegate to autopilot for retry (keeps in_progress)
    await this.recoverTask(task, { ...latestAttempt, status: latestAttempt.status === 'running' ? 'failed' : latestAttempt.status });
  }

  private async recoverTask(task: any, attempt: any): Promise<void> {
    const { autopilotManager, io } = this.deps;

    // Sweep-recovered tasks always retry — never auto-promote to in_review.
    // Only the real-time exit handler (server.ts agentManager.on('exit')) should
    // move tasks to in_review. The sweep handles orphans after crashes/restarts.
    if (autopilotManager.isEnabled()) {
      // Force status to 'failed' so onTaskFinished triggers retry, not completion
      await autopilotManager.onTaskFinished(task.id, 'failed', this.deps);
    }
    // Non-autopilot → keep in_progress for manual retry

    // Emit events so frontend updates
    io.emit('task:finished', { taskId: task.id, status: attempt.status });

    const { db: workerDb, schema: workerSchema } = this.deps;
    const updatedTask = await workerDb.query.tasks.findFirst({
      where: eq(workerSchema.tasks.id, task.id),
    });
    if (updatedTask) {
      io.emit('task:updated', updatedTask);
    }
  }
}
