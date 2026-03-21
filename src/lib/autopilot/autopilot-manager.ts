// Main autopilot manager — mode switching, enable/disable, task orchestration
// Reads mode from projects.autopilot_mode DB column (not appSettings)
import { createLogger } from '../logger';
import { nanoid } from 'nanoid';
import { eq, and, asc } from 'drizzle-orm';
import { startWorkerLoop } from './autopilot-worker-loop';
import { readContextFile, writeContextFile, appendValidationResult, appendRetryEntry, appendSkippedEntry, appendCompletedEntry } from './autopilot-context-file';
import { validateTaskCompletion } from './autopilot-task-completion-validator';
import {
  buildAutonomousInitialPrompt,
  buildAutonomousResumePrompt,
  buildAskInitialPrompt,
  buildAskResumePrompt,
} from './autopilot-prompt-builder';
import type { AutopilotMode } from './autopilot-prompt-builder';
import { isValidModelId } from '../models';

export type { AutopilotMode };

const log = createLogger('Autopilot');

/**
 * Resolve model + provider for an autopilot task.
 * Priority: task.lastModel/lastProvider > env defaults.
 * If env model is non-Claude (not in AVAILABLE_MODELS), auto-select SDK provider.
 */
function resolveModelProvider(task: any): { model?: string; provider?: string } {
  // Task has explicit model/provider
  if (task.lastModel && task.lastProvider) {
    return { model: task.lastModel, provider: task.lastProvider };
  }

  // Task has model but no provider — infer provider
  if (task.lastModel) {
    const isClaude = isValidModelId(task.lastModel) || /^claude/i.test(task.lastModel);
    return { model: task.lastModel, provider: isClaude ? 'claude-cli' : 'claude-sdk' };
  }

  // No task model — check env
  const envModel = process.env.ANTHROPIC_MODEL?.trim();
  if (envModel) {
    const isClaude = isValidModelId(envModel) || /^claude/i.test(envModel) || /^(opus|sonnet|haiku)$/i.test(envModel);
    const envProvider = process.env.CLAUDE_PROVIDER === 'sdk' ? 'claude-sdk' : (isClaude ? 'claude-cli' : 'claude-sdk');
    return { model: envModel, provider: envProvider };
  }

  // Full default — let agent-manager handle it
  return {};
}

const MAX_RETRIES = 6;
const PICK_DELAY_MS = 3000;
// Retries 1-3 use session resume, retries 4-6 use fresh session
const SESSION_RESUME_THRESHOLD = 3;

interface AutopilotDeps {
  db: any;
  io: any;
  schema: any;
  agentManager: any;
  sessionManager: any;
}

interface AutopilotStatus {
  mode: AutopilotMode;
  enabled: boolean;
  phase: 'idle' | 'planning' | 'processing';
  currentTaskId: string | null;
  todoCount: number;
  processedCount: number;
  retryCount: number;
  skippedTaskIds: string[];
}

interface TaskContext {
  taskId: string;
  attemptId: string;
  projectId: string;
  title: string;
  description: string;
  allTodoTitles: string[];
  completedTitles: string[];
}

export class AutopilotManager {
  private retryCounts = new Map<string, number>();
  private activeProjects = new Map<string, AutopilotMode>();
  private currentTaskId = new Map<string, string>();
  private processedCounts = new Map<string, number>();
  private skippedTaskIds = new Map<string, string[]>();
  private phase = new Map<string, 'idle' | 'planning' | 'processing'>();
  private taskContexts = new Map<string, TaskContext>();
  private attemptToProject = new Map<string, string>();
  private workerHandles = new Map<string, { stop: () => void }>();
  private questionListenerRegistered = false;
  private deps: AutopilotDeps | null = null;
  // Compact attempts started internally before moving task to in_review.
  // server.ts exit handler should skip autopilot/task:finished processing for these.
  private internalCompactAttempts = new Set<string>();

  /** Check if an attempt is an internal pre-review compact (server.ts should skip autopilot processing) */
  isInternalCompact(attemptId: string): boolean {
    return this.internalCompactAttempts.has(attemptId);
  }

  isEnabled(projectId: string): boolean {
    return this.activeProjects.has(projectId) && this.activeProjects.get(projectId) !== 'off';
  }

  getActiveMode(projectId: string): AutopilotMode {
    return this.activeProjects.get(projectId) || 'off';
  }

  async setMode(projectId: string, mode: AutopilotMode, deps: AutopilotDeps): Promise<void> {
    const currentMode = this.getActiveMode(projectId);
    if (currentMode === mode) return;

    // Update DB
    await deps.db
      .update(deps.schema.projects)
      .set({ autopilotMode: mode })
      .where(eq(deps.schema.projects.id, projectId));

    if (mode === 'off') {
      await this.disable(projectId, deps);
    } else if (currentMode === 'off') {
      await this.enable(projectId, mode, deps);
      await this.planAndReorder(projectId, deps);
    } else {
      // Switching between autonomous ↔ ask — worker adapts on next check
      this.activeProjects.set(projectId, mode);
    }

    this.emitStatus(projectId, deps);
  }

  async enable(projectId: string, mode: AutopilotMode, deps: AutopilotDeps): Promise<void> {
    this.activeProjects.set(projectId, mode);
    this.processedCounts.set(projectId, 0);
    this.skippedTaskIds.set(projectId, []);
    this.phase.set(projectId, 'idle');

    // Start worker loop
    const handle = startWorkerLoop(
      projectId,
      { db: deps.db, schema: deps.schema, agentManager: deps.agentManager },
      () => this.getActiveMode(projectId),
      () => this.retryCounts,
      MAX_RETRIES,
      {
        onResume: async (task, retryCount) => {
          await this.resumeTask(task, retryCount, deps);
        },
        onMaxRetries: async (task) => {
          await this.handleMaxRetries(task, deps);
        },
      }
    );
    this.workerHandles.set(projectId, handle);

    log.info({ projectId, mode }, 'Autopilot enabled');
  }

  async disable(projectId: string, deps: AutopilotDeps): Promise<void> {
    this.activeProjects.delete(projectId);
    this.currentTaskId.delete(projectId);
    this.phase.set(projectId, 'idle');
    this.taskContexts.delete(projectId);

    // Stop worker loop
    const handle = this.workerHandles.get(projectId);
    if (handle) {
      handle.stop();
      this.workerHandles.delete(projectId);
    }

    log.info({ projectId }, 'Autopilot disabled');
  }

  /** Restore active autopilot from DB column on server startup */
  async restoreFromDb(deps: AutopilotDeps): Promise<void> {
    try {
      const projects = await deps.db
        .select()
        .from(deps.schema.projects);

      for (const project of projects) {
        if (project.autopilotMode && project.autopilotMode !== 'off') {
          await this.enable(project.id, project.autopilotMode as AutopilotMode, deps);
          log.info({ projectId: project.id, mode: project.autopilotMode }, 'Restored autopilot from DB');
        }
      }
    } catch (error) {
      log.error({ error }, 'Failed to restore autopilot from DB');
    }
  }

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

      const mode = this.getActiveMode(projectId);
      const ctx = this.taskContexts.get(projectId);
      if (!ctx || ctx.attemptId !== attemptId) return;

      if (mode === 'autonomous') {
        // Suppress questions in autonomous mode (after initial gathering)
        log.info(
          { attemptId, taskId: ctx.taskId, questionCount: questions?.length },
          'Autopilot: suppressing question (autonomous mode)'
        );
        agentManager.clearPersistentQuestion(ctx.taskId);
      }
      // Ask mode: let the question through — worker will wait for answer
    });
  }

  async onTaskFinished(taskId: string, status: string, deps: AutopilotDeps, attemptId?: string, shouldCompact?: boolean): Promise<void> {
    const { db, schema } = deps;
    this.deps = deps;

    const task = await db.query.tasks.findFirst({
      where: eq(schema.tasks.id, taskId),
    });
    if (!task) return;

    const projectId = task.projectId;
    if (!this.isEnabled(projectId)) return;
    if (this.currentTaskId.get(projectId) !== taskId) return;

    // If attemptId provided, verify it matches the tracked attempt to avoid
    // stale exit events (e.g. after server restart) moving tasks incorrectly
    const ctx = this.taskContexts.get(projectId);
    if (attemptId && ctx && ctx.attemptId !== attemptId) {
      log.info({ taskId, attemptId, trackedAttemptId: ctx.attemptId }, 'Autopilot: ignoring stale attempt finish');
      return;
    }

    log.info({ taskId, status, projectId }, 'Autopilot: task finished');

    if (status === 'completed') {
      await this.handleTaskCompleted(task, projectId, deps, shouldCompact);
    } else if (status === 'failed') {
      await this.handleTaskFailed(task, projectId, deps);
    } else if (status === 'cancelled') {
      this.currentTaskId.delete(projectId);
      this.retryCounts.delete(taskId);
      this.emitStatus(projectId, deps);
    }
  }

  private async handleTaskCompleted(task: any, projectId: string, deps: AutopilotDeps, shouldCompact?: boolean): Promise<void> {
    const { db, schema, agentManager, io, sessionManager } = deps;
    const ctx = this.taskContexts.get(projectId);

    // Get project path for validation
    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
    });

    // Validate completion using a cheap model before moving to in_review
    if (project && ctx?.attemptId) {
      log.info({ taskId: task.id, projectId }, 'Autopilot: validating task completion');

      const result = await validateTaskCompletion(task, ctx.attemptId, {
        db, schema, agentManager, projectPath: project.path,
      });

      // Record validation result in context file
      appendValidationResult(project.path, task.id, result.completed, result.reason || 'No reason provided');

      if (!result.completed) {
        log.info({ taskId: task.id, reason: result.reason }, 'Autopilot: validation says task NOT completed, retrying');
        // Treat as failed — retry the task
        await this.handleTaskFailed(task, projectId, deps);
        return;
      }

      log.info({ taskId: task.id, reason: result.reason }, 'Autopilot: validation confirmed task completed');
    }

    // Auto-compact before moving to in_review — ensures clean context for future use
    if (shouldCompact && project) {
      try {
        const autoCompactSetting = await db
          .select()
          .from(schema.appSettings)
          .where(eq(schema.appSettings.key, 'auto_compact_enabled'))
          .limit(1);
        const autoCompactEnabled = autoCompactSetting.length > 0 && autoCompactSetting[0].value === 'true';

        if (autoCompactEnabled) {
          const conversationSummary = await sessionManager.getConversationSummary(task.id);
          const taskModel = task.lastModel || process.env.ANTHROPIC_MODEL || undefined;
          const taskProvider = task.lastProvider
            || (taskModel && !/^claude/i.test(taskModel) && !/^(opus|sonnet|haiku)$/i.test(taskModel) ? 'claude-sdk' : undefined);

          const compactAttemptId = nanoid();
          this.internalCompactAttempts.add(compactAttemptId);

          await db.insert(schema.attempts).values({
            id: compactAttemptId,
            taskId: task.id,
            prompt: 'Auto-compact: summarize conversation context',
            displayPrompt: 'Auto-compacting conversation...',
            status: 'running',
          });

          log.info({ compactAttemptId, taskId: task.id }, 'Autopilot: auto-compacting before in_review');
          io.to(`attempt:${ctx?.attemptId}`).emit('context:compacting', { attemptId: compactAttemptId, taskId: task.id });

          // Wait for compact to finish before proceeding to in_review
          await new Promise<void>((resolve) => {
            let resolved = false;
            const cleanup = () => {
              if (resolved) return;
              resolved = true;
              agentManager.off('exit', exitHandler);
              this.internalCompactAttempts.delete(compactAttemptId);
              clearTimeout(timeout);
              resolve();
            };
            const exitHandler = ({ attemptId: exitId }: { attemptId: string; code: number }) => {
              if (exitId === compactAttemptId) cleanup();
            };
            // Timeout safety — don't block forever if compact hangs
            const timeout = setTimeout(() => {
              log.warn({ compactAttemptId, taskId: task.id }, 'Autopilot: compact timed out, proceeding to in_review');
              cleanup();
            }, 60_000);
            agentManager.on('exit', exitHandler);
            agentManager.compact({
              attemptId: compactAttemptId,
              projectPath: project.path,
              conversationSummary,
              model: taskModel,
              provider: taskProvider as 'claude-cli' | 'claude-sdk' | undefined,
            });
          });

          log.info({ taskId: task.id }, 'Autopilot: compact finished, now moving to in_review');
        }
      } catch (compactError) {
        log.error({ compactError, taskId: task.id }, 'Autopilot: pre-review compact failed, proceeding to in_review');
      }
    }

    // Validated (and compacted if needed) — move to in_review
    if (project?.path) {
      appendCompletedEntry(project.path, task.id);
    }
    await db
      .update(schema.tasks)
      .set({ status: 'in_review', updatedAt: Date.now() })
      .where(eq(schema.tasks.id, task.id));

    if (ctx) {
      ctx.completedTitles.push(task.title);
      const idx = ctx.allTodoTitles.indexOf(task.title);
      if (idx !== -1) ctx.allTodoTitles.splice(idx, 1);
    }

    this.currentTaskId.delete(projectId);
    this.retryCounts.delete(task.id);
    this.attemptToProject.delete(ctx?.attemptId || '');
    this.processedCounts.set(projectId, (this.processedCounts.get(projectId) || 0) + 1);

    log.info({ taskId: task.id, projectId }, 'Autopilot: task → in_review, picking next');

    await this.emitTaskUpdated(task.id, deps);
    this.emitStatus(projectId, deps);

    setTimeout(() => {
      if (this.isEnabled(projectId)) {
        this.pickNextTask(projectId, deps);
      }
    }, PICK_DELAY_MS);
  }

  private async handleTaskFailed(task: any, projectId: string, deps: AutopilotDeps): Promise<void> {
    const retries = (this.retryCounts.get(task.id) || 0) + 1;
    this.retryCounts.set(task.id, retries);

    if (retries < MAX_RETRIES) {
      log.info({ taskId: task.id, retries, maxRetries: MAX_RETRIES }, 'Autopilot: retrying task');
      this.emitStatus(projectId, deps);

      setTimeout(() => {
        if (this.isEnabled(projectId)) {
          this.resumeTask(task, retries, deps);
        }
      }, PICK_DELAY_MS);
    } else {
      await this.handleMaxRetries(task, deps);
    }
  }

  private async handleMaxRetries(task: any, deps: AutopilotDeps): Promise<void> {
    const { db, schema } = deps;
    const projectId = task.projectId;

    log.info({ taskId: task.id }, 'Autopilot: max retries reached, skipping task');

    // Record skip in context file
    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
    });
    if (project?.path) {
      appendSkippedEntry(project.path, task.id, MAX_RETRIES);
    }

    await db
      .update(schema.tasks)
      .set({ status: 'todo', updatedAt: Date.now() })
      .where(eq(schema.tasks.id, task.id));

    this.currentTaskId.delete(projectId);
    this.retryCounts.delete(task.id);

    const skipped = this.skippedTaskIds.get(projectId) || [];
    skipped.push(task.id);
    this.skippedTaskIds.set(projectId, skipped);

    await this.emitTaskUpdated(task.id, deps);
    this.emitStatus(projectId, deps);

    setTimeout(() => {
      if (this.isEnabled(projectId)) {
        this.pickNextTask(projectId, deps);
      }
    }, PICK_DELAY_MS);
  }

  /** Resume a stalled task — uses session resume for retries 1-3, fresh for 4-6 */
  private async resumeTask(task: any, retryCount: number, deps: AutopilotDeps): Promise<void> {
    const { db, schema, agentManager, io } = deps;
    const projectId = task.projectId;
    const mode = this.getActiveMode(projectId);

    this.registerQuestionListener(agentManager);

    // Re-check task status from DB — another process may have moved it already
    const freshTask = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, task.id) });
    if (!freshTask || freshTask.status === 'in_review' || freshTask.status === 'done') {
      log.info({ taskId: task.id, status: freshTask?.status }, 'Autopilot: skipping resume, task already moved');
      this.currentTaskId.delete(projectId);
      this.retryCounts.delete(task.id);
      this.emitStatus(projectId, deps);
      return;
    }

    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
    });
    if (!project) return;

    const attemptId = nanoid();
    const basePrompt = task.description || task.title;

    // Ensure context file exists (may not if task was started manually before autopilot)
    let contextFileContent = readContextFile(project.path, task.id);
    if (!contextFileContent) {
      writeContextFile(project.path, task.id, task.title, basePrompt);
      contextFileContent = readContextFile(project.path, task.id);
    }

    const ctx = this.taskContexts.get(projectId) || {
      taskId: '', attemptId: '', projectId, title: '',
      description: '', allTodoTitles: [], completedTitles: [],
    };
    const taskCtx = { completedTitles: ctx.completedTitles, allTodoTitles: ctx.allTodoTitles };

    // Build mode-appropriate resume prompt
    const prompt = mode === 'autonomous'
      ? buildAutonomousResumePrompt(basePrompt, contextFileContent, taskCtx)
      : buildAskResumePrompt(basePrompt, contextFileContent, taskCtx);

    // Increment retry count
    this.retryCounts.set(task.id, retryCount + 1);

    await db.insert(schema.attempts).values({
      id: attemptId,
      taskId: task.id,
      prompt,
      displayPrompt: "Check if there is remaining work and finish it. If no remaining work, let's finish",
      status: 'running',
      outputFormat: null,
      outputSchema: null,
    });

    this.currentTaskId.set(projectId, task.id);
    this.phase.set(projectId, 'processing');
    this.attemptToProject.set(attemptId, projectId);

    ctx.taskId = task.id;
    ctx.attemptId = attemptId;
    ctx.title = task.title;
    ctx.description = task.description || '';
    this.taskContexts.set(projectId, ctx);

    // Use session resume for retries 1-3, fresh session for 4-6
    const useSessionResume = retryCount < SESSION_RESUME_THRESHOLD;

    // Record retry in context file so next attempt sees the journey
    appendRetryEntry(project.path, task.id, retryCount + 1, MAX_RETRIES, useSessionResume);

    const { model: resolvedModel, provider: resolvedProvider } = resolveModelProvider(task);

    agentManager.start({
      attemptId,
      projectPath: project.path,
      prompt,
      ...(resolvedModel ? { model: resolvedModel } : {}),
      ...(resolvedProvider ? { provider: resolvedProvider } : {}),
      ...(useSessionResume ? { sessionResume: true } : {}),
    });

    log.info({ taskId: task.id, resolvedModel, resolvedProvider }, 'Autopilot: resume model/provider');

    // Emit toast notification for resume
    io.emit('autopilot:task-resumed', {
      projectId,
      taskId: task.id,
      attemptId,
      title: task.title,
      retryCount: retryCount + 1,
    });

    log.info(
      { projectId, taskId: task.id, attemptId, retryCount: retryCount + 1, useSessionResume },
      'Autopilot: resumed task'
    );

    this.emitStatus(projectId, deps);
  }

  async startTask(task: any, deps: AutopilotDeps): Promise<void> {
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
    const mode = this.getActiveMode(projectId);
    const contextPath = `${project.path}/autopilot/${task.id}.md`;

    const ctx = this.taskContexts.get(projectId) || {
      taskId: '', attemptId: '', projectId, title: '',
      description: '', allTodoTitles: [], completedTitles: [],
    };
    const taskCtx = { completedTitles: ctx.completedTitles, allTodoTitles: ctx.allTodoTitles };

    // Build mode-specific initial prompt
    const prompt = mode === 'autonomous'
      ? buildAutonomousInitialPrompt(basePrompt, contextPath, taskCtx)
      : buildAskInitialPrompt(basePrompt, contextPath, taskCtx);

    // Write initial context file
    writeContextFile(project.path, task.id, task.title, basePrompt);

    await db.insert(schema.attempts).values({
      id: attemptId,
      taskId: task.id,
      prompt,
      displayPrompt: basePrompt,
      status: 'running',
      outputFormat: null,
      outputSchema: null,
    });

    await db
      .update(schema.tasks)
      .set({ status: 'in_progress', updatedAt: Date.now() })
      .where(eq(schema.tasks.id, task.id));

    await this.emitTaskUpdated(task.id, deps);

    this.currentTaskId.set(projectId, task.id);
    this.phase.set(projectId, 'processing');
    this.attemptToProject.set(attemptId, projectId);

    ctx.taskId = task.id;
    ctx.attemptId = attemptId;
    ctx.title = task.title;
    ctx.description = task.description || '';
    this.taskContexts.set(projectId, ctx);

    const { model: resolvedModel, provider: resolvedProvider } = resolveModelProvider(task);

    agentManager.start({
      attemptId,
      projectPath: project.path,
      prompt,
      ...(resolvedModel ? { model: resolvedModel } : {}),
      ...(resolvedProvider ? { provider: resolvedProvider } : {}),
    });

    log.info({ projectId, taskId: task.id, attemptId, model: resolvedModel, provider: resolvedProvider }, 'Autopilot: started task');

    io.emit('autopilot:task-started', {
      projectId,
      taskId: task.id,
      attemptId,
      ...this.getStatus(projectId),
    });
    io.emit('task:started', { taskId: task.id });
  }

  async pickNextTask(projectId: string, deps: AutopilotDeps): Promise<void> {
    const { db, schema } = deps;
    if (!this.isEnabled(projectId)) return;
    if (this.currentTaskId.has(projectId)) return;

    const skipped = this.skippedTaskIds.get(projectId) || [];
    const todoTasks = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.projectId, projectId), eq(schema.tasks.status, 'todo')))
      .orderBy(asc(schema.tasks.position));

    const availableTasks = todoTasks.filter((t: any) => !skipped.includes(t.id));

    if (availableTasks.length === 0) {
      log.info({ projectId }, 'Autopilot: no more tasks to process');
      this.phase.set(projectId, 'idle');
      this.emitStatus(projectId, deps);
      return;
    }

    const nextTask = availableTasks[0];
    log.info({ projectId, taskId: nextTask.id, title: nextTask.title }, 'Autopilot: picking next task');
    await this.startTask(nextTask, deps);
  }

  async planAndReorder(projectId: string, deps: AutopilotDeps): Promise<void> {
    const { db, schema, io, agentManager } = deps;
    this.deps = deps;
    this.registerQuestionListener(agentManager);
    this.phase.set(projectId, 'planning');
    this.emitStatus(projectId, deps);

    try {
      const todoTasks = await db
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.projectId, projectId), eq(schema.tasks.status, 'todo')))
        .orderBy(asc(schema.tasks.position));

      const existingCtx = this.taskContexts.get(projectId);
      const completedSoFar = existingCtx?.completedTitles || [];
      this.taskContexts.set(projectId, {
        taskId: '', attemptId: '', projectId, title: '', description: '',
        allTodoTitles: todoTasks.map((t: any) => t.title),
        completedTitles: completedSoFar,
      });

      if (todoTasks.length <= 1) {
        log.info({ projectId, count: todoTasks.length }, 'Autopilot: skipping planning (<=1 tasks)');
        this.phase.set(projectId, 'processing');
        this.emitStatus(projectId, deps);
        if (this.isEnabled(projectId)) this.pickNextTask(projectId, deps);
        return;
      }

      const taskList = todoTasks
        .map((t: any, i: number) => `${i + 1}. [ID: ${t.id}] ${t.title}${t.description ? ': ' + t.description : ''}`)
        .join('\n');

      const planPrompt = `Given these tasks, analyze dependencies and return the optimal execution order. Consider which tasks might depend on others based on their titles and descriptions.\n\nTasks:\n${taskList}\n\nReturn ONLY a JSON array of task IDs in the recommended execution order, like:\n["id1", "id2", "id3"]\n\nDo not include any other text, just the JSON array.`;

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
        id: planTaskId, projectId, title: '[Autopilot] Task dependency analysis',
        description: 'Internal task for autopilot planning phase',
        status: 'in_progress', position: -1, chatInit: false,
        rewindSessionId: null, rewindMessageUuid: null,
        createdAt: Date.now(), updatedAt: Date.now(),
      });

      await db.insert(schema.attempts).values({
        id: planAttemptId, taskId: planTaskId, prompt: planPrompt,
        displayPrompt: null, status: 'running', outputFormat: null, outputSchema: null,
      });

      const onPlanExit = async ({ attemptId: exitAttemptId }: { attemptId: string; code: number | null }) => {
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
                const data = typeof logEntry.content === 'string' ? JSON.parse(logEntry.content) : logEntry.content;
                if (data.type === 'text' && data.text) {
                  const match = data.text.match(/\[[\s\S]*\]/);
                  if (match) {
                    const parsed = JSON.parse(match[0]);
                    if (Array.isArray(parsed) && parsed.every((id: any) => typeof id === 'string')) {
                      reorderedIds = parsed;
                    }
                  }
                }
              } catch { /* Continue looking */ }
            }
          }

          if (reorderedIds && reorderedIds.length > 0) {
            const validIds = todoTasks.map((t: any) => t.id);
            const orderedIds = reorderedIds.filter((id: string) => validIds.includes(id));
            for (const id of validIds) {
              if (!orderedIds.includes(id)) orderedIds.push(id);
            }

            for (let i = 0; i < orderedIds.length; i++) {
              await db.update(schema.tasks)
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

            log.info({ projectId, order: orderedIds }, 'Autopilot: tasks reordered by AI planning');
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
          } catch { /* ignore cleanup errors */ }
        }

        this.phase.set(projectId, 'processing');
        io.emit('autopilot:planned', { projectId, ...this.getStatus(projectId) });

        if (this.isEnabled(projectId)) {
          this.pickNextTask(projectId, deps);
        }
      };

      agentManager.on('exit', onPlanExit);
      agentManager.start({ attemptId: planAttemptId, projectPath: project.path, prompt: planPrompt, maxTurns: 1 });
      log.info({ projectId, planAttemptId }, 'Autopilot: planning agent started');
    } catch (error) {
      log.error({ error, projectId }, 'Autopilot: planning failed');
      this.phase.set(projectId, 'processing');
      this.emitStatus(projectId, deps);
      if (this.isEnabled(projectId)) this.pickNextTask(projectId, deps);
    }
  }

  /** Get taskId for an autopilot-managed attempt (null if not autopilot) */
  getTaskIdForAttempt(attemptId: string): string | null {
    const projectId = this.attemptToProject.get(attemptId);
    if (!projectId || !this.isEnabled(projectId)) return null;
    const ctx = this.taskContexts.get(projectId);
    if (!ctx || ctx.attemptId !== attemptId) return null;
    return ctx.taskId;
  }

  getStatus(projectId: string): AutopilotStatus {
    const mode = this.getActiveMode(projectId);
    return {
      mode,
      enabled: mode !== 'off',
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

  emitStatus(projectId: string, deps: AutopilotDeps): void {
    deps.io.emit('autopilot:status', {
      projectId,
      ...this.getStatus(projectId),
    });
  }

  private async emitTaskUpdated(taskId: string, deps: AutopilotDeps): Promise<void> {
    const task = await deps.db.query.tasks.findFirst({
      where: eq(deps.schema.tasks.id, taskId),
    });
    if (task) deps.io.emit('task:updated', task);
  }
}

export function createAutopilotManager(): AutopilotManager {
  return new AutopilotManager();
}
