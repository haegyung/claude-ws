import { createLogger } from './logger';
import { nanoid } from 'nanoid';
import { eq, and, asc, desc } from 'drizzle-orm';
import { validateAttemptCompletion } from './autopilot-attempt-completion-validator';

const log = createLogger('Autopilot');

const MAX_RETRIES = 3;
const PICK_DELAY_MS = 3000;

interface AutopilotDeps {
  db: any;
  io: any;
  schema: any;
  agentManager: any;
  sessionManager: any;
}

export type AutopilotMode = 'off' | 'fully-autonomous' | 'auto-resume';

interface AutopilotStatus {
  enabled: boolean;
  allowAskUser: boolean;
  mode: AutopilotMode;
  phase: 'idle' | 'planning' | 'processing';
  currentTaskId: string | null;
  processedCount: number;
  retryCount: number;
  skippedTaskIds: string[];
  questionPhase: 'gathering' | 'autonomous' | 'interactive' | 'idle';
  idleTimeoutSeconds: number;
}

/** Context the master agent keeps for each running task */
interface TaskContext {
  taskId: string;
  attemptId: string;
  projectId: string;
  title: string;
  description: string;
  allTodoTitles: string[];
  completedTitles: string[];
  questionPhase: 'gathering' | 'autonomous' | 'interactive';
}

export class AutopilotManager {
  /** Autopilot mode: off, fully-autonomous, or auto-resume */
  private _mode: AutopilotMode = 'fully-autonomous';

  /** Idle timeout in seconds — agent with no activity beyond this is considered stuck */
  private _idleTimeoutSeconds = 60;

  /** Derived: is autopilot enabled */
  get _enabled(): boolean { return this._mode !== 'off'; }
  /** Derived: is AskUserQuestion allowed (auto-resume mode) */
  get _allowAskUser(): boolean { return this._mode === 'auto-resume'; }

  private retryCounts = new Map<string, number>();
  private currentTaskId = new Map<string, string>();
  private processedCounts = new Map<string, number>();
  private skippedTaskIds = new Map<string, string[]>();
  private phase = new Map<string, 'idle' | 'planning' | 'processing'>();

  /** Master agent context per project */
  private taskContexts = new Map<string, TaskContext>();

  /** Track attemptId → projectId for question handler lookup */
  private attemptToProject = new Map<string, string>();

  private deps: AutopilotDeps | null = null;
  private runtimeDeps: { io: any; agentManager: any; sessionManager: any } | null = null;
  private questionListenerRegistered = false;
  private restartCommandAttempts = new Set<string>();

  private readonly RESTART_PATTERNS = [
    /pm2\s+restart\s+claude-ws/,
    /pm2\s+restart\s+all/,
    /service\s+\w+\s+restart/,
    /systemctl\s+restart/,
    /restart\.sh/,
  ];

  /** Check if autopilot is enabled (workspace-wide) */
  isEnabled(): boolean {
    return this._enabled;
  }

  /** Check if AskUserQuestion is allowed in autopilot mode */
  isAllowAskUser(): boolean {
    return this._allowAskUser;
  }

  /** Get idle timeout in milliseconds */
  getIdleTimeoutMs(): number {
    return this._idleTimeoutSeconds * 1000;
  }

  /** Set idle timeout and persist to DB */
  async setIdleTimeout(db: any, schema: any, seconds: number): Promise<void> {
    this._idleTimeoutSeconds = seconds;
    await db.insert(schema.appSettings)
      .values({ key: 'autopilot_idle_timeout_seconds', value: String(seconds), updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: { value: String(seconds), updatedAt: Date.now() },
      });
    log.info({ seconds }, 'Autopilot: idle timeout updated');
  }

  /** Get current autopilot mode */
  getMode(): AutopilotMode { return this._mode; }

  /** Set autopilot mode and persist to DB */
  async setMode(db: any, schema: any, mode: AutopilotMode): Promise<void> {
    const wasEnabled = this._enabled;
    this._mode = mode;

    await db.insert(schema.appSettings)
      .values({ key: 'autopilot_mode', value: mode, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: { value: mode, updatedAt: Date.now() },
      });

    // Clean up contexts when switching to off
    if (mode === 'off' && wasEnabled) {
      for (const [, ctx] of this.taskContexts) {
        if (ctx.attemptId) this.restartCommandAttempts.delete(ctx.attemptId);
      }
      this.currentTaskId.clear();
      this.taskContexts.clear();
      this.phase.clear();
    }

    log.info({ mode }, 'Autopilot: mode changed');
  }

  // Legacy methods — delegate to setMode for backward compatibility
  async enableAskUser(db: any, schema: any): Promise<void> { await this.setMode(db, schema, 'auto-resume'); }
  async disableAskUser(db: any, schema: any): Promise<void> { await this.setMode(db, schema, 'fully-autonomous'); }

  /** Set runtime deps (io, agentManager, sessionManager) — called once from server.ts */
  setDeps(deps: { io: any; agentManager: any; sessionManager: any }): void {
    this.runtimeDeps = deps;
  }

  /** Get runtime deps for use by Next.js API routes */
  getDeps(): { io: any; agentManager: any; sessionManager: any } | null {
    return this.runtimeDeps;
  }

  async enable(db: any, schema: any): Promise<void> {
    // Preserve current sub-mode when re-enabling
    if (this._mode === 'off') await this.setMode(db, schema, 'fully-autonomous');
  }

  async disable(db: any, schema: any): Promise<void> {
    await this.setMode(db, schema, 'off');
  }

  async restoreFromSettings(db: any, schema: any): Promise<void> {
    try {
      // Restore mode (new unified setting)
      const modeSetting = await db
        .select()
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, 'autopilot_mode'))
        .limit(1);

      if (modeSetting.length > 0) {
        const mode = modeSetting[0].value as AutopilotMode;
        if (['off', 'fully-autonomous', 'auto-resume'].includes(mode)) {
          this._mode = mode;
        }
        log.info({ mode: this._mode }, 'Restored autopilot mode from DB');
      } else {
        // Migrate from old boolean settings
        const enabledSetting = await db
          .select()
          .from(schema.appSettings)
          .where(eq(schema.appSettings.key, 'autopilot_enabled'))
          .limit(1);
        const askUserSetting = await db
          .select()
          .from(schema.appSettings)
          .where(eq(schema.appSettings.key, 'autopilot_allow_ask_user'))
          .limit(1);

        const wasEnabled = enabledSetting.length === 0 || enabledSetting[0].value === 'true';
        const wasAskUser = askUserSetting.length > 0 && askUserSetting[0].value === 'true';

        if (!wasEnabled) this._mode = 'off';
        else if (wasAskUser) this._mode = 'auto-resume';
        else this._mode = 'fully-autonomous';

        log.info({ mode: this._mode }, 'Migrated autopilot mode from legacy settings');
      }

      // Restore idle timeout setting
      const idleSetting = await db
        .select()
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, 'autopilot_idle_timeout_seconds'))
        .limit(1);

      if (idleSetting.length > 0) {
        this._idleTimeoutSeconds = parseInt(idleSetting[0].value, 10) || 60;
        log.info({ idleTimeoutSeconds: this._idleTimeoutSeconds }, 'Restored autopilot idle timeout from DB');
      }

      // Clean up old per-project keys (migration)
      const allSettings = await db.select().from(schema.appSettings);
      for (const s of allSettings) {
        if (s.key.startsWith('autopilot_enabled_')) {
          await db.delete(schema.appSettings)
            .where(eq(schema.appSettings.key, s.key));
          log.info({ key: s.key }, 'Cleaned up old per-project autopilot key');
        }
      }
    } catch (error) {
      log.error({ error }, 'Failed to restore autopilot settings');
    }
  }

  private isRestartCommand(command: string): boolean {
    const normalizedCommand = command.toLowerCase().trim();
    return this.RESTART_PATTERNS.some(pattern => pattern.test(normalizedCommand));
  }

  registerQuestionListener(agentManager: any): void {
    if (this.questionListenerRegistered) return;
    this.questionListenerRegistered = true;

    agentManager.on('question', ({ attemptId, toolUseId, questions }: {
      attemptId: string;
      toolUseId: string;
      questions: unknown[];
    }) => {
      if (!this._enabled) return;
      // When allowAskUser is on (interactive mode), let questions through
      if (this._allowAskUser) return;

      const projectId = this.attemptToProject.get(attemptId);
      if (!projectId) return;

      const ctx = this.taskContexts.get(projectId);
      if (!ctx || ctx.attemptId !== attemptId) return;

      if (ctx.questionPhase === 'gathering') {
        // Allow question during gathering phase — don't suppress
        log.info(
          { attemptId, taskId: ctx.taskId, questionCount: questions?.length },
          'Autopilot: question allowed (gathering phase)'
        );
        return;
      }

      // Autonomous phase — suppress
      log.info(
        { attemptId, taskId: ctx.taskId, questionCount: questions?.length },
        'Autopilot: suppressing question (autonomous phase)'
      );
      agentManager.clearPersistentQuestion(ctx.taskId);
    });

    // Transition from gathering → autonomous when question is resolved
    agentManager.on('questionResolved', ({ attemptId }: { attemptId: string }) => {
      if (!this._enabled || this._allowAskUser) return;

      const projectId = this.attemptToProject.get(attemptId);
      if (!projectId) return;
      const ctx = this.taskContexts.get(projectId);
      if (!ctx || ctx.attemptId !== attemptId) return;

      if (ctx.questionPhase === 'gathering') {
        ctx.questionPhase = 'autonomous';
        log.info(
          { attemptId, taskId: ctx.taskId, projectId },
          'Autopilot: transitioned to autonomous phase after Q&A'
        );
      }
    });

    agentManager.on('json', ({ attemptId, data }: { attemptId: string; data: any }) => {
      if (!this._enabled) return;

      const projectId = this.attemptToProject.get(attemptId);
      if (!projectId) return;

      const ctx = this.taskContexts.get(projectId);
      if (!ctx || ctx.attemptId !== attemptId) return;

      if (data.type === 'tool_use' && data.name === 'Bash' && data.input?.command) {
        const command = data.input.command;
        if (this.isRestartCommand(command)) {
          log.info(
            { attemptId, taskId: ctx.taskId, command },
            'Autopilot: detected restart command, will treat exit as completion'
          );
          this.restartCommandAttempts.add(attemptId);
        }
      }
    });
  }

  async onTaskFinished(
    taskId: string,
    status: string,
    deps: AutopilotDeps
  ): Promise<void> {
    const { db, schema } = deps;
    this.deps = deps;

    if (!this._enabled) return;

    const task = await db.query.tasks.findFirst({
      where: eq(schema.tasks.id, taskId),
    });

    if (!task) return;

    const projectId = task.projectId;

    // If this task wasn't tracked by autopilot (manually started), still handle completion
    const isAutopilotTask = this.currentTaskId.get(projectId) === taskId;

    if (!isAutopilotTask) {
      // Manually started task — trust SDK completion signal directly
      if (status === 'completed' && task.status === 'in_progress') {
        await db
          .update(schema.tasks)
          .set({ status: 'in_review', updatedAt: Date.now() })
          .where(eq(schema.tasks.id, taskId));
        log.info({ taskId, projectId }, 'Autopilot: manually-started task → in_review');
        await this.emitTaskUpdated(taskId, deps);
      } else if (status === 'failed' && task.status === 'in_progress') {
        // Manually started task failed — retry with same MAX_RETRIES guard
        const retries = (this.retryCounts.get(taskId) || 0) + 1;
        this.retryCounts.set(taskId, retries);

        if (retries < MAX_RETRIES) {
          log.info({ taskId, projectId, retries, maxRetries: MAX_RETRIES },
            'Autopilot: manually-started task failed, retrying');
          this.currentTaskId.set(projectId, taskId);
          setTimeout(() => {
            if (this._enabled) {
              this.retryTask(task, deps);
            }
          }, PICK_DELAY_MS);
        } else {
          log.info({ taskId, projectId, retries },
            'Autopilot: manually-started task max retries, skipping');
          this.retryCounts.delete(taskId);
          const skipped = this.skippedTaskIds.get(projectId) || [];
          skipped.push(taskId);
          this.skippedTaskIds.set(projectId, skipped);
          // Pick next task if autopilot has queued work
          setTimeout(() => {
            if (this._enabled) {
              this.pickNextTask(projectId, deps);
            }
          }, PICK_DELAY_MS);
        }
      }
      return;
    }

    log.info({ taskId, status, projectId }, 'Autopilot: task finished');

    const ctx = this.taskContexts.get(projectId);
    const attemptId = ctx?.attemptId || '';
    const hasRestartCommand = this.restartCommandAttempts.has(attemptId);

    if (attemptId) {
      this.restartCommandAttempts.delete(attemptId);
    }

    const effectiveStatus = (hasRestartCommand && status === 'failed') ? 'completed' : status;

    log.info(
      { taskId, originalStatus: status, effectiveStatus, hasRestartCommand },
      'Autopilot: determined effective task status'
    );

    if (effectiveStatus === 'completed') {
      // Trust SDK completion signal — move directly to in_review
      await db
        .update(schema.tasks)
        .set({ status: 'in_review', updatedAt: Date.now() })
        .where(eq(schema.tasks.id, taskId));

      if (ctx) {
        ctx.completedTitles.push(task.title);
        const idx = ctx.allTodoTitles.indexOf(task.title);
        if (idx !== -1) ctx.allTodoTitles.splice(idx, 1);
      }

      this.currentTaskId.delete(projectId);
      this.retryCounts.delete(taskId);
      this.attemptToProject.delete(ctx?.attemptId || '');
      this.processedCounts.set(
        projectId,
        (this.processedCounts.get(projectId) || 0) + 1,
      );

      log.info({ taskId, projectId }, 'Autopilot: task → in_review, picking next');

      await this.emitTaskUpdated(taskId, deps);

      setTimeout(() => {
        if (this._enabled) {
          this.pickNextTask(projectId, deps);
        }
      }, PICK_DELAY_MS);
    } else if (effectiveStatus === 'failed') {
      const retries = (this.retryCounts.get(taskId) || 0) + 1;
      this.retryCounts.set(taskId, retries);

      if (retries < MAX_RETRIES) {
        log.info(
          { taskId, retries, maxRetries: MAX_RETRIES },
          'Autopilot: retrying task'
        );

        setTimeout(() => {
          if (this._enabled) {
            this.retryTask(task, deps);
          }
        }, PICK_DELAY_MS);
      } else {
        log.info(
          { taskId, retries },
          'Autopilot: max retries reached, skipping task'
        );

        await db
          .update(schema.tasks)
          .set({ status: 'todo', updatedAt: Date.now() })
          .where(eq(schema.tasks.id, taskId));

        this.currentTaskId.delete(projectId);
        this.retryCounts.delete(taskId);

        const skipped = this.skippedTaskIds.get(projectId) || [];
        skipped.push(taskId);
        this.skippedTaskIds.set(projectId, skipped);

        await this.emitTaskUpdated(taskId, deps);


        setTimeout(() => {
          if (this._enabled) {
            this.pickNextTask(projectId, deps);
          }
        }, PICK_DELAY_MS);
      }
    } else if (effectiveStatus === 'cancelled') {
      this.currentTaskId.delete(projectId);
      this.retryCounts.delete(taskId);

    }
  }

  async planAndReorder(projectId: string, deps: AutopilotDeps): Promise<void> {
    const { db, schema, io, agentManager } = deps;
    this.deps = deps;

    this.registerQuestionListener(agentManager);

    this.phase.set(projectId, 'planning');

    try {
      const todoTasks = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.projectId, projectId),
            eq(schema.tasks.status, 'todo')
          )
        )
        .orderBy(asc(schema.tasks.position));

      const existingCtx = this.taskContexts.get(projectId);
      const completedSoFar = existingCtx?.completedTitles || [];
      this.taskContexts.set(projectId, {
        taskId: '',
        attemptId: '',
        projectId,
        title: '',
        description: '',
        allTodoTitles: todoTasks.map((t: any) => t.title),
        completedTitles: completedSoFar,
        questionPhase: this._allowAskUser ? 'interactive' : 'gathering',
      });

      if (todoTasks.length <= 1) {
        log.info({ projectId, count: todoTasks.length }, 'Autopilot: skipping planning (<=1 tasks)');
        this.phase.set(projectId, 'processing');


        if (this._enabled) {
          this.pickNextTask(projectId, deps);
        }
        return;
      }

      const taskList = todoTasks
        .map(
          (t: any, i: number) =>
            `${i + 1}. [ID: ${t.id}] ${t.title}${t.description ? ': ' + t.description : ''}`
        )
        .join('\n');

      const planPrompt = `Given these tasks, analyze dependencies and return the optimal execution order. Consider which tasks might depend on others based on their titles and descriptions.

Tasks:
${taskList}

Return ONLY a JSON array of task IDs in the recommended execution order, like:
["id1", "id2", "id3"]

Do not include any other text, just the JSON array.`;

      const project = await db.query.projects.findFirst({
        where: eq(schema.projects.id, projectId),
      });

      if (!project) {
        log.error({ projectId }, 'Autopilot: project not found for planning');
        this.phase.set(projectId, 'processing');
        return;
      }

      const planAttemptId = nanoid();
      const planTaskId = nanoid();

      await db.insert(schema.tasks).values({
        id: planTaskId,
        projectId,
        title: '[Autopilot] Task dependency analysis',
        description: 'Internal task for autopilot planning phase',
        status: 'in_progress',
        position: -1,
        chatInit: false,
        rewindSessionId: null,
        rewindMessageUuid: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await db.insert(schema.attempts).values({
        id: planAttemptId,
        taskId: planTaskId,
        prompt: planPrompt,
        displayPrompt: null,
        status: 'running',
        outputFormat: null,
        outputSchema: null,
      });

      const onPlanExit = async ({ attemptId: exitAttemptId, code }: { attemptId: string; code: number | null }) => {
        if (exitAttemptId !== planAttemptId) return;
        agentManager.removeListener('exit', onPlanExit);

        try {
          const logs = await db.query.attemptLogs.findMany({
            where: eq(schema.attemptLogs.attemptId, planAttemptId),
          });

          let reorderedIds: string[] | null = null;

          for (const logEntry of logs) {
            if (logEntry.type === 'json') {
              try {
                const data = typeof logEntry.content === 'string'
                  ? JSON.parse(logEntry.content)
                  : logEntry.content;

                if (data.type === 'text' && data.text) {
                  const match = data.text.match(/\[[\s\S]*\]/);
                  if (match) {
                    const parsed = JSON.parse(match[0]);
                    if (Array.isArray(parsed) && parsed.every((id: any) => typeof id === 'string')) {
                      reorderedIds = parsed;
                    }
                  }
                }
              } catch {
                // Continue looking
              }
            }
          }

          if (reorderedIds && reorderedIds.length > 0) {
            const validIds = todoTasks.map((t: any) => t.id);
            const orderedIds = reorderedIds.filter((id: string) => validIds.includes(id));

            for (const id of validIds) {
              if (!orderedIds.includes(id)) {
                orderedIds.push(id);
              }
            }

            for (let i = 0; i < orderedIds.length; i++) {
              await db
                .update(schema.tasks)
                .set({ position: i, updatedAt: Date.now() })
                .where(eq(schema.tasks.id, orderedIds[i]));
            }

            const reorderedTitles = orderedIds.map((id: string) => {
              const t = todoTasks.find((task: any) => task.id === id);
              return t?.title || id;
            });
            const ctx = this.taskContexts.get(projectId);
            if (ctx) ctx.allTodoTitles = reorderedTitles;

            for (const id of orderedIds) {
              await this.emitTaskUpdated(id, deps);
            }

            log.info(
              { projectId, order: orderedIds },
              'Autopilot: tasks reordered by AI planning'
            );
          } else {
            log.warn({ projectId }, 'Autopilot: could not parse planning response, keeping original order');
          }

          await db.delete(schema.attempts).where(eq(schema.attempts.taskId, planTaskId));
          await db.delete(schema.tasks).where(eq(schema.tasks.id, planTaskId));

        } catch (error) {
          log.error({ error, projectId }, 'Autopilot: error processing planning result');
          try {
            await db.delete(schema.attempts).where(eq(schema.attempts.taskId, planTaskId));
            await db.delete(schema.tasks).where(eq(schema.tasks.id, planTaskId));
          } catch { }
        }

        this.phase.set(projectId, 'processing');

        if (this._enabled) {
          this.pickNextTask(projectId, deps);
        }
      };

      agentManager.on('exit', onPlanExit);

      agentManager.start({
        attemptId: planAttemptId,
        projectPath: project.path,
        prompt: planPrompt,
        maxTurns: 1,
      });

      log.info({ projectId, planAttemptId }, 'Autopilot: planning agent started');
    } catch (error) {
      log.error({ error, projectId }, 'Autopilot: planning failed');
      this.phase.set(projectId, 'processing');


      if (this._enabled) {
        this.pickNextTask(projectId, deps);
      }
    }
  }

  async pickNextTask(projectId: string, deps: AutopilotDeps): Promise<void> {
    const { db, schema } = deps;

    if (!this._enabled) return;

    // Don't pick if already processing a task in this project
    if (this.currentTaskId.has(projectId)) return;

    const skipped = this.skippedTaskIds.get(projectId) || [];

    const todoTasks = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.projectId, projectId),
          eq(schema.tasks.status, 'todo')
        )
      )
      .orderBy(asc(schema.tasks.position));

    const availableTasks = todoTasks.filter(
      (t: any) => !skipped.includes(t.id)
    );

    if (availableTasks.length === 0) {
      log.info({ projectId }, 'Autopilot: no more tasks in this project');
      this.phase.set(projectId, 'idle');

      return;
    }

    const nextTask = availableTasks[0];
    log.info(
      { projectId, taskId: nextTask.id, title: nextTask.title },
      'Autopilot: picking next task'
    );

    await this.startTask(nextTask, deps);
  }

  /**
   * Retry a failed task — resume prior session context if available,
   * otherwise start fresh. Uses a continuation prompt so the agent
   * picks up where the previous attempt left off.
   */
  async retryTask(task: any, deps: AutopilotDeps): Promise<void> {
    const { db, schema, sessionManager } = deps;

    // Get model/provider from the last attempt so retry uses same config
    const lastAttempt = await db.query.attempts.findFirst({
      where: eq(schema.attempts.taskId, task.id),
      orderBy: [desc(schema.attempts.createdAt)],
    });

    // Use stored model/provider, fall back to env defaults
    const envModel = process.env.ANTHROPIC_MODEL?.trim() || undefined;
    const model = lastAttempt?.model || envModel;
    // If model is non-Claude (custom), force SDK provider since CLI doesn't support custom models
    const isCustomModel = model && !model.startsWith('claude-');
    const provider = lastAttempt?.provider || (isCustomModel ? 'claude-sdk' : undefined);

    // Try to resume from last valid session
    const sessionOptions = await sessionManager.getSessionOptionsWithAutoFix(task.id);
    const hasSession = !!(sessionOptions.resume || sessionOptions.resumeSessionAt);

    try {
      if (hasSession) {
        log.info(
          { taskId: task.id, sessionId: sessionOptions.resume, model, provider },
          'Autopilot: retrying with session continuation',
        );
        const continuePrompt = `Your previous attempt on this task was interrupted. Review what you've already done and continue working to complete the task. Do not repeat work that's already been done — check the current state of files and pick up where you left off.`;
        await this.startTask(task, deps, { sessionOptions, overridePrompt: continuePrompt, model, provider });
      } else {
        log.info({ taskId: task.id, model, provider }, 'Autopilot: retrying fresh (no prior session)');
        await this.startTask(task, deps, { model, provider });
      }
    } catch (error) {
      // Model/provider no longer available — fall back to defaults
      log.warn(
        { taskId: task.id, model, provider, error },
        'Autopilot: retry failed with saved model/provider, falling back to defaults',
      );
      await this.startTask(task, deps);
    }
  }

  async startTask(task: any, deps: AutopilotDeps, retryOptions?: {
    sessionOptions?: { resume?: string; resumeSessionAt?: string };
    overridePrompt?: string;
    model?: string;
    provider?: string;
  }): Promise<void> {
    const { db, io, schema, agentManager } = deps;
    this.deps = deps;

    const projectId = task.projectId;

    this.registerQuestionListener(agentManager);

    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
    });

    if (!project) {
      log.error({ projectId }, 'Autopilot: project not found');
      return;
    }

    const attemptId = nanoid();
    const basePrompt = task.description || task.title;

    const ctx = this.taskContexts.get(projectId);
    const progressInfo = ctx && ctx.completedTitles.length > 0
      ? `\n\nTasks already completed: ${ctx.completedTitles.join(', ')}`
      : '';
    const remainingInfo = ctx && ctx.allTodoTitles.length > 0
      ? `\nRemaining tasks after this: ${ctx.allTodoTitles.join(', ')}`
      : '';

    const isRetryWithSession = retryOptions?.sessionOptions?.resume;

    let askUserLine = '';
    let initialPhase: TaskContext['questionPhase'] = 'interactive';

    if (!this._allowAskUser) {
      // Skip gathering phase on retries — agent already asked questions in the original attempt
      if (isRetryWithSession) {
        initialPhase = 'autonomous';
        askUserLine = `[AUTOPILOT MODE] You are running in fully autonomous mode. Do NOT use AskUserQuestion. Make all decisions yourself and complete the task.
${progressInfo}${remainingInfo}`;
      } else {
        initialPhase = 'gathering';
        askUserLine = `[AUTOPILOT MODE - GATHERING PHASE] You are about to run in autonomous mode.
BEFORE you start working, ask ALL clarifying questions you have about this task in a SINGLE AskUserQuestion call.
Include questions about:
- Ambiguous requirements
- Technical approach preferences
- Any assumptions you're making
After your questions are answered, you will proceed fully autonomously with NO further user interaction.
If you have no questions, proceed immediately without calling AskUserQuestion.
${progressInfo}${remainingInfo}`;
      }
    }

    // For retries with session, use continuation prompt; otherwise use task prompt
    const prompt = isRetryWithSession
      ? `${retryOptions.overridePrompt || 'Continue working on this task.'}\n${askUserLine}`
      : `${basePrompt}\n${askUserLine}`;

    await db.insert(schema.attempts).values({
      id: attemptId,
      taskId: task.id,
      prompt,
      displayPrompt: isRetryWithSession ? 'Autopilot: resuming previous session' : basePrompt,
      status: 'running',
      outputFormat: null,
      outputSchema: null,
      model: retryOptions?.model || null,
      provider: retryOptions?.provider || null,
    });

    await db
      .update(schema.tasks)
      .set({ status: 'in_progress', updatedAt: Date.now() })
      .where(eq(schema.tasks.id, task.id));

    await this.emitTaskUpdated(task.id, deps);

    this.currentTaskId.set(projectId, task.id);
    this.phase.set(projectId, 'processing');
    this.attemptToProject.set(attemptId, projectId);

    const taskCtx = this.taskContexts.get(projectId) || {
      taskId: '',
      attemptId: '',
      projectId,
      title: '',
      description: '',
      allTodoTitles: [],
      completedTitles: [],
      questionPhase: initialPhase,
    };
    taskCtx.taskId = task.id;
    taskCtx.attemptId = attemptId;
    taskCtx.title = task.title;
    taskCtx.description = task.description || '';
    taskCtx.questionPhase = initialPhase;
    this.taskContexts.set(projectId, taskCtx);

    // 30s fallback: if no AskUserQuestion asked during gathering, auto-transition to autonomous
    if (initialPhase === 'gathering') {
      setTimeout(() => {
        const currentCtx = this.taskContexts.get(projectId);
        if (currentCtx?.attemptId === attemptId && currentCtx.questionPhase === 'gathering') {
          currentCtx.questionPhase = 'autonomous';
          log.info({ taskId: task.id }, 'Autopilot: auto-transitioned to autonomous (no questions within 30s)');
        }
      }, 30_000);
    }

    const sessionOpts = retryOptions?.sessionOptions;
    agentManager.start({
      attemptId,
      projectPath: project.path,
      prompt,
      ...(retryOptions?.model && { model: retryOptions.model }),
      ...(retryOptions?.provider && { provider: retryOptions.provider }),
      ...(sessionOpts && Object.keys(sessionOpts).length > 0 && { sessionOptions: sessionOpts }),
    });

    log.info(
      { projectId, taskId: task.id, attemptId, questionPhase: initialPhase, hasSession: !!isRetryWithSession, model: retryOptions?.model, provider: retryOptions?.provider },
      'Autopilot: started task'
    );

    io.emit('task:started', { taskId: task.id });
  }

  /** Get workspace-wide autopilot status */
  getStatus(): AutopilotStatus {
    // Aggregate phase: processing > planning > idle
    let aggregatedPhase: 'idle' | 'planning' | 'processing' = 'idle';
    for (const [, p] of this.phase) {
      if (p === 'processing') { aggregatedPhase = 'processing'; break; }
      if (p === 'planning') aggregatedPhase = 'planning';
    }

    // Sum processed counts across projects
    let totalProcessed = 0;
    for (const [, count] of this.processedCounts) {
      totalProcessed += count;
    }

    // Aggregate skipped task IDs
    const allSkipped: string[] = [];
    for (const [, ids] of this.skippedTaskIds) {
      allSkipped.push(...ids);
    }

    // Get current task (first active one found)
    let currentTask: string | null = null;
    for (const [, taskId] of this.currentTaskId) {
      currentTask = taskId;
      break;
    }

    // Get question phase from first active task context
    let questionPhase: AutopilotStatus['questionPhase'] = 'idle';
    for (const [, ctx] of this.taskContexts) {
      if (ctx.attemptId && this.currentTaskId.has(ctx.projectId)) {
        questionPhase = ctx.questionPhase;
        break;
      }
    }

    return {
      enabled: this._enabled,
      allowAskUser: this._allowAskUser,
      mode: this._mode,
      phase: aggregatedPhase,
      currentTaskId: currentTask,
      processedCount: totalProcessed,
      retryCount: currentTask
        ? this.retryCounts.get(currentTask) || 0
        : 0,
      skippedTaskIds: allSkipped,
      questionPhase,
      idleTimeoutSeconds: this._idleTimeoutSeconds,
    };
  }

  private async emitTaskUpdated(taskId: string, deps: AutopilotDeps): Promise<void> {
    const task = await deps.db.query.tasks.findFirst({
      where: eq(deps.schema.tasks.id, taskId),
    });
    if (task) {
      deps.io.emit('task:updated', task);
    }
  }

  /** Validate whether an attempt actually did meaningful work */
  async validateAttemptCompletion(
    taskId: string,
    deps: AutopilotDeps,
  ): Promise<{ valid: boolean; reason: string }> {
    return validateAttemptCompletion(taskId, deps.db, deps.schema);
  }
}

// Export singleton instance (global for cross-module access in bundled/unbundled contexts)
const globalKey = '__claude_autopilot_manager__' as const;

declare global {
  var __claude_autopilot_manager__: AutopilotManager | undefined;
}

export const autopilotManager: AutopilotManager =
  (globalThis as any)[globalKey] ?? new AutopilotManager();

if (!(globalThis as any)[globalKey]) {
  (globalThis as any)[globalKey] = autopilotManager;
}

/** @deprecated Use `autopilotManager` singleton directly */
export function createAutopilotManager(): AutopilotManager {
  return autopilotManager;
}
