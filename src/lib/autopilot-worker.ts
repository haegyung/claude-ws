import { eq } from 'drizzle-orm';
import { createLogger } from './logger';
import { validateAttemptCompletion } from './autopilot-attempt-completion-validator';

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

      // If any attempt completed, validate before transitioning
      const hasCompleted = attempts.some((a: any) => a.status === 'completed');
      if (hasCompleted) {
        const validation = await validateAttemptCompletion(task.id, db, schema);
        if (validation.valid) {
          await db
            .update(schema.tasks)
            .set({ status: 'in_review', updatedAt: Date.now() })
            .where(eq(schema.tasks.id, task.id));
          recoveredTasks++;
        } else {
          log.info(
            { taskId: task.id, reason: validation.reason },
            'Startup: task incomplete, keeping in_progress',
          );
        }
      }
      // failed/cancelled only → keep in_progress for manual retry
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

    // If ANY attempt has a live agent, the task is still actively being worked on — skip
    const hasLiveAgent = attempts.some(
      (a: any) => a.status === 'running' && agentManager.isRunning(a.id),
    );
    if (hasLiveAgent) return;

    // Get latest attempt by createdAt (don't rely on array order)
    const latestAttempt = attempts.reduce((latest: any, a: any) =>
      (a.createdAt || 0) > (latest.createdAt || 0) ? a : latest,
    );

    // Case 1: Attempt completed/failed in DB, no live agents → recover
    if (latestAttempt.status === 'completed' || latestAttempt.status === 'failed') {
      await this.recoverTask(task, latestAttempt);
      return;
    }

    // Case 2: Attempt 'running' in DB but agent is dead → mark as failed, then recover
    if (latestAttempt.status === 'running' && !agentManager.isRunning(latestAttempt.id)) {
      await db
        .update(schema.attempts)
        .set({ status: 'failed', completedAt: Date.now() })
        .where(eq(schema.attempts.id, latestAttempt.id));

      log.info(
        { taskId: task.id, attemptId: latestAttempt.id },
        'Marked orphaned attempt as failed',
      );

      await this.recoverTask(task, { ...latestAttempt, status: 'failed' });
    }
  }

  private async recoverTask(task: any, attempt: any): Promise<void> {
    const { db, schema, autopilotManager, io } = this.deps;
    const isAutopilot = autopilotManager.isEnabled();

    if (isAutopilot) {
      // Delegate to autopilot's validation + retry/pick-next logic
      await autopilotManager.onTaskFinished(task.id, attempt.status, this.deps);
    } else if (attempt.status === 'completed') {
      // Validate the attempt actually did meaningful work
      const validation = await autopilotManager.validateAttemptCompletion(task.id, this.deps);

      if (validation.valid) {
        await db
          .update(schema.tasks)
          .set({ status: 'in_review', updatedAt: Date.now() })
          .where(eq(schema.tasks.id, task.id));
        log.info({ taskId: task.id }, 'Recovered orphan task → in_review');
      } else {
        log.info(
          { taskId: task.id, reason: validation.reason },
          'Orphan task incomplete, keeping in_progress for retry',
        );
      }
    }
    // Non-autopilot failed → keep in_progress for manual retry

    // Emit events so frontend updates
    io.emit('task:finished', { taskId: task.id, status: attempt.status });

    const updatedTask = await db.query.tasks.findFirst({
      where: eq(schema.tasks.id, task.id),
    });
    if (updatedTask) {
      io.emit('task:updated', updatedTask);
    }
  }
}
