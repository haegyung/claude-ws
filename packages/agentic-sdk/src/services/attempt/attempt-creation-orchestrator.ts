/**
 * Attempt creation orchestrator — single source of truth for the full attempt lifecycle:
 * validation → task resolution → attempt record creation → agent start → sync/queue response.
 * Used by both Next.js and Fastify routes as thin transport adapters.
 */
import { formatOutput } from '../../lib/output-formatter';
import { getContentTypeForFormat } from '../../lib/content-type-map';

/** Input parsed from HTTP request body */
export interface AttemptCreationInput {
  taskId: string;
  prompt: string;
  force_create?: boolean;
  use_hook_template?: boolean;
  projectId?: string;
  projectName?: string;
  taskTitle?: string;
  projectRootPath?: string;
  request_method?: 'sync' | 'queue';
  output_format?: string;
  output_schema?: string;
  timeout?: number;
  model?: string;
  provider?: 'claude-cli' | 'claude-sdk';
}

/** Transport-agnostic result — routes map this to their framework's response */
export type AttemptResult =
  | { type: 'created'; statusCode: 201; data: any }
  | { type: 'json'; statusCode: number; data: any }
  | { type: 'file'; statusCode: 200; content: string; contentType: string }
  | { type: 'error'; statusCode: number; data: { error: string; attemptId?: string; retryUrl?: string } };

/** Typed validation error with HTTP status code */
export class AttemptValidationError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'AttemptValidationError';
  }
}

/** Agent start params passed to the runtime agent manager */
export interface AgentStartParams {
  attemptId: string;
  projectPath: string;
  prompt: string;
  model?: string;
  provider?: 'claude-cli' | 'claude-sdk';
  sessionOptions?: Record<string, any>;
  outputFormat?: string;
  outputSchema?: string;
}

/** Services required by the orchestrator (injected by the caller) */
interface OrchestratorDeps {
  taskService: { getById(id: string): Promise<any>; update(id: string, data: any): Promise<any> };
  projectService: { getById(id: string): Promise<any> };
  attemptService: {
    create(data: any): Promise<any>;
    getById(id: string): Promise<any>;
    getStatus(id: string): Promise<any>;
    getLogs(attemptId: string): Promise<any[]>;
    parseLogsToMessages(logs: any[]): any[];
    readOutputFile(attemptId: string, format: string): Promise<{ content: string; found: true } | { found: false }>;
  };
  forceCreateService: { ensureProjectAndTask(params: any): Promise<any> };
  sessionManager: { getSessionOptionsWithAutoFix(taskId: string): Promise<Record<string, any>> };
  /** Callback to start the agent process (runtime singleton, lives outside SDK) */
  startAgent: (params: AgentStartParams) => void;
  defaultBasePath: string;
  onProjectForceCreated?: (project: any, input: AttemptCreationInput) => Promise<void> | void;
}

export function createAttemptOrchestrator(deps: OrchestratorDeps) {
  const { taskService, projectService, attemptService, forceCreateService, sessionManager, startAgent, defaultBasePath, onProjectForceCreated } = deps;

  return {
    /**
     * Full attempt lifecycle: validate → resolve task → create record → start agent → handle sync/queue.
     * Returns a transport-agnostic result that routes map to HTTP responses.
     */
    async createAndRun(input: AttemptCreationInput): Promise<AttemptResult> {
     try {
      const { request_method = 'queue', output_format, output_schema, timeout = 300000, model, provider } = input;

      // Validate
      this.validate(input);

      // Prepare prompt
      let finalPrompt = input.prompt;
      if (output_format === 'custom' && output_schema) {
        finalPrompt = `${output_schema}\n\n${input.prompt}`;
      }

      // Resolve task (lookup or force-create)
      const { task, projectCreatedByForceCreate } = await this.resolveTask(input);

      // Resolve project
      const project = await projectService.getById(task.projectId);
      if (!project) throw new AttemptValidationError('Project not found', 404);
      if (projectCreatedByForceCreate && onProjectForceCreated) {
        await onProjectForceCreated(project, input);
      }

      // Create attempt record
      const attempt = await attemptService.create({
        taskId: task.id,
        prompt: finalPrompt,
        outputFormat: output_format || undefined,
        outputSchema: output_schema || undefined,
      });

      // Update task status to in_progress if it was todo
      if (task.status === 'todo') {
        await taskService.update(task.id, { status: 'in_progress' });
      }

      // Get session options for conversation continuation
      const sessionOptions = await sessionManager.getSessionOptionsWithAutoFix(task.id);

      // Start the agent
      startAgent({
        attemptId: attempt.id,
        projectPath: project.path,
        prompt: finalPrompt,
        model: model || undefined,
        provider: provider || undefined,
        sessionOptions: Object.keys(sessionOptions).length > 0 ? sessionOptions : undefined,
        outputFormat: output_format || undefined,
        outputSchema: output_schema || undefined,
      });

      // Queue mode: return immediately
      if (request_method === 'queue') {
        return { type: 'created', statusCode: 201, data: attempt };
      }

      // Sync mode: wait for completion and format response
      const waitResult = await this.waitForCompletion(attempt.id, timeout);

      if (waitResult.timedOut) {
        return {
          type: 'error',
          statusCode: 408,
          data: { error: `Attempt timed out after ${timeout}ms`, attemptId: attempt.id, retryUrl: `/api/attempts/${attempt.id}` },
        };
      }

      return this.formatSyncResponse(attempt.id, waitResult.attempt, output_format, output_schema);
     } catch (error: any) {
      // Map DB constraint errors to validation errors
      if (error?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        throw new AttemptValidationError('Task not found', 404);
      }
      throw error;
     }
    },

    /** Validate attempt creation input, throw AttemptValidationError on failure */
    validate(input: AttemptCreationInput) {
      const { taskId, prompt, request_method, output_format } = input;
      if (request_method && request_method !== 'sync' && request_method !== 'queue') {
        throw new AttemptValidationError('Invalid request_method. Must be "sync" or "queue"', 400);
      }
      if (output_format && typeof output_format !== 'string') {
        throw new AttemptValidationError('output_format must be a string', 400);
      }
      if (!taskId || !prompt) {
        throw new AttemptValidationError('taskId and prompt are required', 400);
      }
    },

    /** Resolve task: find existing or force-create project+task */
    async resolveTask(input: AttemptCreationInput): Promise<{ task: any; projectCreatedByForceCreate: boolean }> {
      const { taskId, force_create, projectId, projectName, taskTitle, projectRootPath } = input;

      if (!force_create) {
        const task = await taskService.getById(taskId);
        if (!task) throw new AttemptValidationError('Task not found', 404);
        return { task, projectCreatedByForceCreate: false };
      }

      // Force-create: check if task already exists
      const existingTask = await taskService.getById(taskId);
      if (existingTask) return { task: existingTask, projectCreatedByForceCreate: false };

      // Task doesn't exist — force-create project + task
      if (!projectId) throw new AttemptValidationError('projectId required', 400);

      const result = await forceCreateService.ensureProjectAndTask({
        taskId, projectId, projectName, taskTitle, projectRootPath, defaultBasePath,
      });
      return { task: result.task, projectCreatedByForceCreate: Boolean(result.projectCreated) };
    },

    /** Poll attempt status until terminal state or timeout */
    async waitForCompletion(attemptId: string, timeoutMs: number): Promise<{ attempt: any; timedOut: boolean }> {
      const start = Date.now();
      const pollInterval = 500;

      while (Date.now() - start < timeoutMs) {
        const status = await attemptService.getStatus(attemptId);
        if (status && status.status !== 'running') {
          const attempt = await attemptService.getById(attemptId);
          return { attempt, timedOut: false };
        }
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      const attempt = await attemptService.getById(attemptId);
      return { attempt, timedOut: true };
    },

    /** Format sync-mode response (output file or formatted logs) */
    async formatSyncResponse(attemptId: string, completedAttempt: any, outputFormat?: string, outputSchema?: string): Promise<AttemptResult> {
      if (outputFormat) {
        const fileResult = await attemptService.readOutputFile(attemptId, outputFormat);
        if (fileResult.found) {
          return { type: 'file', statusCode: 200, content: fileResult.content, contentType: getContentTypeForFormat(outputFormat) };
        }
        return { type: 'error', statusCode: 404, data: { error: 'Output file not found', attemptId } };
      }

      const logs = await attemptService.getLogs(attemptId);
      const messages = attemptService.parseLogsToMessages(logs);
      const formatted = formatOutput(messages, 'json', outputSchema || null, {
        id: completedAttempt.id,
        taskId: completedAttempt.taskId,
        prompt: completedAttempt.prompt,
        status: completedAttempt.status,
        createdAt: completedAttempt.createdAt,
        completedAt: completedAttempt.completedAt,
      });

      return { type: 'json', statusCode: 200, data: formatted };
    },
  };
}
