import { createLogger } from './logger';
import { nanoid } from 'nanoid';
import { eq, and, asc } from 'drizzle-orm';

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

interface AutopilotStatus {
  enabled: boolean;
  phase: 'idle' | 'planning' | 'processing';
  currentTaskId: string | null;
  todoCount: number;
  processedCount: number;
  retryCount: number;
  skippedTaskIds: string[];
}

/** Context the master agent keeps for each running task */
interface TaskContext {
  taskId: string;
  attemptId: string;
  projectId: string;
  title: string;
  description: string;
  /** All todo tasks at the time autopilot started — for big-picture awareness */
  allTodoTitles: string[];
  /** Tasks already completed in this autopilot run */
  completedTitles: string[];
}

export class AutopilotManager {
  private retryCounts = new Map<string, number>();
  private activeProjects = new Set<string>();
  private currentTaskId = new Map<string, string>();
  private processedCounts = new Map<string, number>();
  private skippedTaskIds = new Map<string, string[]>();
  private phase = new Map<string, 'idle' | 'planning' | 'processing'>();

  /** Master agent context per project — knows what's being done and progress */
  private taskContexts = new Map<string, TaskContext>();

  /** Track attemptId → projectId for question handler lookup */
  private attemptToProject = new Map<string, string>();

  /** Stores deps so question handler can access them */
  private deps: AutopilotDeps | null = null;

  /** Track the question listener to avoid duplicate registrations */
  private questionListenerRegistered = false;

  isEnabled(projectId: string): boolean {
    return this.activeProjects.has(projectId);
  }

  async enable(projectId: string, db: any, schema: any): Promise<void> {
    this.activeProjects.add(projectId);
    this.processedCounts.set(projectId, 0);
    this.skippedTaskIds.set(projectId, []);
    this.phase.set(projectId, 'idle');

    // Persist to appSettings
    await db
      .insert(schema.appSettings)
      .values({
        key: `autopilot_enabled_${projectId}`,
        value: 'true',
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: { value: 'true', updatedAt: Date.now() },
      });

    log.info({ projectId }, 'Autopilot enabled');
  }

  async disable(projectId: string, db: any, schema: any): Promise<void> {
    this.activeProjects.delete(projectId);
    this.currentTaskId.delete(projectId);
    this.phase.set(projectId, 'idle');

    // Clean up context
    this.taskContexts.delete(projectId);

    // Remove from appSettings
    await db
      .delete(schema.appSettings)
      .where(eq(schema.appSettings.key, `autopilot_enabled_${projectId}`));

    log.info({ projectId }, 'Autopilot disabled');
  }

  async restoreFromSettings(db: any, schema: any): Promise<void> {
    try {
      const allSettings = await db
        .select()
        .from(schema.appSettings);

      for (const setting of allSettings) {
        if (setting.key.startsWith('autopilot_enabled_') && setting.value === 'true') {
          const projectId = setting.key.replace('autopilot_enabled_', '');
          this.activeProjects.add(projectId);
          this.processedCounts.set(projectId, 0);
          this.skippedTaskIds.set(projectId, []);
          this.phase.set(projectId, 'idle');
          log.info({ projectId }, 'Restored autopilot state from settings');
        }
      }
    } catch (error) {
      log.error({ error }, 'Failed to restore autopilot settings');
    }
  }

  /**
   * Register the question auto-answer listener on agentManager.
   * Called once during server init — the listener checks if the attempt
   * belongs to an autopilot task before acting.
   */
  registerQuestionListener(agentManager: any): void {
    if (this.questionListenerRegistered) return;
    this.questionListenerRegistered = true;

    agentManager.on('question', ({ attemptId, toolUseId, questions }: {
      attemptId: string;
      toolUseId: string;
      questions: unknown[];
    }) => {
      const projectId = this.attemptToProject.get(attemptId);
      if (!projectId || !this.isEnabled(projectId)) return;

      const ctx = this.taskContexts.get(projectId);
      if (!ctx || ctx.attemptId !== attemptId) return;

      // Autopilot mode: don't answer via writeToolResult — CLI already auto-handles
      // AskUserQuestion with its own tool_result. Writing a second tool_result causes
      // duplicate user messages → API 400 "assistant message prefill" error.
      // Instead, just clear persistent question so UI doesn't show pending state.
      log.info(
        { attemptId, taskId: ctx.taskId, questionCount: questions?.length },
        'Autopilot: suppressing question (CLI auto-handles)'
      );

      agentManager.clearPersistentQuestion(ctx.taskId);
    });
  }

  async onTaskFinished(
    taskId: string,
    status: string,
    deps: AutopilotDeps
  ): Promise<void> {
    const { db, schema } = deps;
    this.deps = deps;

    // Find which project this task belongs to
    const task = await db.query.tasks.findFirst({
      where: eq(schema.tasks.id, taskId),
    });

    if (!task) return;

    const projectId = task.projectId;

    // Check if autopilot is enabled for this project
    if (!this.isEnabled(projectId)) return;

    // Check if this is the current autopilot task
    if (this.currentTaskId.get(projectId) !== taskId) return;

    log.info({ taskId, status, projectId }, 'Autopilot: task finished');

    if (status === 'completed') {
      // Move task to in_review (not done — human reviews autopilot work)
      await db
        .update(schema.tasks)
        .set({ status: 'in_review', updatedAt: Date.now() })
        .where(eq(schema.tasks.id, taskId));

      // Track completed title for master context
      const ctx = this.taskContexts.get(projectId);
      if (ctx) {
        ctx.completedTitles.push(task.title);
        // Remove from allTodoTitles
        const idx = ctx.allTodoTitles.indexOf(task.title);
        if (idx !== -1) ctx.allTodoTitles.splice(idx, 1);
      }

      this.currentTaskId.delete(projectId);
      this.retryCounts.delete(taskId);
      this.attemptToProject.delete(ctx?.attemptId || '');
      this.processedCounts.set(
        projectId,
        (this.processedCounts.get(projectId) || 0) + 1
      );

      log.info({ taskId, projectId }, 'Autopilot: task → in_review, picking next');

      await this.emitTaskUpdated(taskId, deps);
      this.emitStatus(projectId, deps);

      // Delay before picking next task
      setTimeout(() => {
        if (this.isEnabled(projectId)) {
          this.pickNextTask(projectId, deps);
        }
      }, PICK_DELAY_MS);
    } else if (status === 'failed') {
      const retries = (this.retryCounts.get(taskId) || 0) + 1;
      this.retryCounts.set(taskId, retries);

      if (retries < MAX_RETRIES) {
        log.info(
          { taskId, retries, maxRetries: MAX_RETRIES },
          'Autopilot: retrying task'
        );

        this.emitStatus(projectId, deps);

        // Retry after delay - start fresh (no session resume)
        setTimeout(() => {
          if (this.isEnabled(projectId)) {
            this.startTask(task, deps);
          }
        }, PICK_DELAY_MS);
      } else {
        // Max retries reached - move back to todo and skip
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
        this.emitStatus(projectId, deps);

        setTimeout(() => {
          if (this.isEnabled(projectId)) {
            this.pickNextTask(projectId, deps);
          }
        }, PICK_DELAY_MS);
      }
    } else if (status === 'cancelled') {
      this.currentTaskId.delete(projectId);
      this.retryCounts.delete(taskId);
      this.emitStatus(projectId, deps);
    }
  }

  async planAndReorder(projectId: string, deps: AutopilotDeps): Promise<void> {
    const { db, schema, io, agentManager } = deps;
    this.deps = deps;

    // Register question listener if not already done
    this.registerQuestionListener(agentManager);

    this.phase.set(projectId, 'planning');
    this.emitStatus(projectId, deps);

    try {
      // Query all todo tasks for this project
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

      // Initialize master context with all todo titles
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
      });

      if (todoTasks.length <= 1) {
        log.info({ projectId, count: todoTasks.length }, 'Autopilot: skipping planning (<=1 tasks)');
        this.phase.set(projectId, 'processing');
        this.emitStatus(projectId, deps);

        if (this.isEnabled(projectId)) {
          this.pickNextTask(projectId, deps);
        }
        return;
      }

      // Build prompt for planning
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

      // Get project for path
      const project = await db.query.projects.findFirst({
        where: eq(schema.projects.id, projectId),
      });

      if (!project) {
        log.error({ projectId }, 'Autopilot: project not found for planning');
        this.phase.set(projectId, 'processing');
        return;
      }

      // Spawn one-shot agent for planning
      const planAttemptId = nanoid();
      const planTaskId = nanoid();

      // Create a temporary internal task for planning
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

      // Listen for the planning agent to finish
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

            // Update master context with reordered titles
            const reorderedTitles = orderedIds.map((id: string) => {
              const t = todoTasks.find((task: any) => task.id === id);
              return t?.title || id;
            });
            const ctx = this.taskContexts.get(projectId);
            if (ctx) ctx.allTodoTitles = reorderedTitles;

            // Emit updates for all reordered tasks
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

          // Clean up internal planning task
          await db.delete(schema.attempts).where(eq(schema.attempts.taskId, planTaskId));
          await db.delete(schema.tasks).where(eq(schema.tasks.id, planTaskId));

        } catch (error) {
          log.error({ error, projectId }, 'Autopilot: error processing planning result');
          try {
            await db.delete(schema.attempts).where(eq(schema.attempts.taskId, planTaskId));
            await db.delete(schema.tasks).where(eq(schema.tasks.id, planTaskId));
          } catch {}
        }

        // Emit planned event
        this.phase.set(projectId, 'processing');
        io.emit('autopilot:planned', {
          projectId,
          ...this.getStatus(projectId, deps),
        });

        // Start processing
        if (this.isEnabled(projectId)) {
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
      this.emitStatus(projectId, deps);

      if (this.isEnabled(projectId)) {
        this.pickNextTask(projectId, deps);
      }
    }
  }

  async pickNextTask(projectId: string, deps: AutopilotDeps): Promise<void> {
    const { db, schema } = deps;

    if (!this.isEnabled(projectId)) return;

    // Don't pick if already processing a task
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
      log.info({ projectId }, 'Autopilot: no more tasks to process');
      this.phase.set(projectId, 'idle');
      this.emitStatus(projectId, deps);
      return;
    }

    const nextTask = availableTasks[0];
    log.info(
      { projectId, taskId: nextTask.id, title: nextTask.title },
      'Autopilot: picking next task'
    );

    await this.startTask(nextTask, deps);
  }

  async startTask(task: any, deps: AutopilotDeps): Promise<void> {
    const { db, io, schema, agentManager } = deps;
    this.deps = deps;

    const projectId = task.projectId;

    // Register question listener if not already done
    this.registerQuestionListener(agentManager);

    // Get project
    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
    });

    if (!project) {
      log.error({ projectId }, 'Autopilot: project not found');
      return;
    }

    // Create attempt
    const attemptId = nanoid();
    const basePrompt = task.description || task.title;

    // Build autopilot-aware prompt: instruct agent to NOT use AskUserQuestion
    const ctx = this.taskContexts.get(projectId);
    const progressInfo = ctx && ctx.completedTitles.length > 0
      ? `\n\nTasks already completed: ${ctx.completedTitles.join(', ')}`
      : '';
    const remainingInfo = ctx && ctx.allTodoTitles.length > 0
      ? `\nRemaining tasks after this: ${ctx.allTodoTitles.join(', ')}`
      : '';

    const prompt = `${basePrompt}

[AUTOPILOT MODE] You are running in fully autonomous mode. Important rules:
- Do NOT use AskUserQuestion tool. There is no human available to answer.
- Make all decisions yourself based on the task description.
- If something is ambiguous, choose the most reasonable approach and proceed.
- If you need to pick between options, choose what best fits the task goal.
- For any permission or confirmation, proceed with YES/allow.
- Complete the task fully without asking for clarification.${progressInfo}${remainingInfo}`;

    await db.insert(schema.attempts).values({
      id: attemptId,
      taskId: task.id,
      prompt,
      displayPrompt: basePrompt,
      status: 'running',
      outputFormat: null,
      outputSchema: null,
    });

    // Update task status to in_progress
    await db
      .update(schema.tasks)
      .set({ status: 'in_progress', updatedAt: Date.now() })
      .where(eq(schema.tasks.id, task.id));

    await this.emitTaskUpdated(task.id, deps);

    // Track current task + master context
    this.currentTaskId.set(projectId, task.id);
    this.phase.set(projectId, 'processing');
    this.attemptToProject.set(attemptId, projectId);

    // Update master context for this task
    const taskCtx = this.taskContexts.get(projectId) || {
      taskId: '',
      attemptId: '',
      projectId,
      title: '',
      description: '',
      allTodoTitles: [],
      completedTitles: [],
    };
    taskCtx.taskId = task.id;
    taskCtx.attemptId = attemptId;
    taskCtx.title = task.title;
    taskCtx.description = task.description || '';
    this.taskContexts.set(projectId, taskCtx);

    // Start agent (fresh session - no resume for autopilot retries)
    agentManager.start({
      attemptId,
      projectPath: project.path,
      prompt,
    });

    log.info(
      { projectId, taskId: task.id, attemptId },
      'Autopilot: started task'
    );

    // Emit events
    io.emit('autopilot:task-started', {
      projectId,
      taskId: task.id,
      attemptId,
      ...this.getStatus(projectId, deps),
    });
    io.emit('task:started', { taskId: task.id });
  }

  getStatus(projectId: string, deps?: AutopilotDeps): AutopilotStatus {
    return {
      enabled: this.isEnabled(projectId),
      phase: this.phase.get(projectId) || 'idle',
      currentTaskId: this.currentTaskId.get(projectId) || null,
      todoCount: 0,
      processedCount: this.processedCounts.get(projectId) || 0,
      retryCount: this.currentTaskId.has(projectId)
        ? this.retryCounts.get(this.currentTaskId.get(projectId)!) || 0
        : 0,
      skippedTaskIds: this.skippedTaskIds.get(projectId) || [],
    };
  }

  private emitStatus(projectId: string, deps: AutopilotDeps): void {
    deps.io.emit('autopilot:status', {
      projectId,
      ...this.getStatus(projectId, deps),
    });
  }

  /** Emit task:updated so client kanban board updates in realtime */
  private async emitTaskUpdated(taskId: string, deps: AutopilotDeps): Promise<void> {
    const task = await deps.db.query.tasks.findFirst({
      where: eq(deps.schema.tasks.id, taskId),
    });
    if (task) {
      deps.io.emit('task:updated', task);
    }
  }
}

export function createAutopilotManager(): AutopilotManager {
  return new AutopilotManager();
}
