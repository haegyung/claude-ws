/**
 * Attempt routes - create, get, status, cancel, and answer for agent task attempts
 */
import { FastifyInstance } from 'fastify';

export default async function attemptRoutes(fastify: FastifyInstance) {
  fastify.post('/api/attempts', async (request, reply) => {
    const body = request.body as any;
    const {
      taskId,
      prompt,
      force_create,
      projectId,
      projectName,
      taskTitle,
      projectRootPath,
      request_method = 'queue',
      output_format,
      output_schema,
      timeout = 300000,
    } = body;

    if (!prompt) return reply.code(400).send({ error: 'prompt is required' });

    let resolvedTaskId = taskId;

    // Auto-create project+task if force_create is enabled
    if (force_create && !taskId) {
      if (!projectName && !projectId) {
        return reply.code(400).send({ error: 'projectId or projectName required with force_create' });
      }
      if (!taskTitle) return reply.code(400).send({ error: 'taskTitle required with force_create' });

      let pid = projectId;
      if (!pid) {
        const project = await fastify.services.project.create({
          name: projectName,
          path: projectRootPath || process.cwd(),
        });
        pid = project.id;
      }

      const task = await fastify.services.task.create({ projectId: pid, title: taskTitle });
      resolvedTaskId = task.id;
    }

    if (!resolvedTaskId) return reply.code(400).send({ error: 'taskId is required' });

    const task = await fastify.services.task.getById(resolvedTaskId);
    if (!task) return reply.code(404).send({ error: 'Task not found' });

    // Find project to get projectPath
    const project = await fastify.services.project.getById(task.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const attempt = await fastify.services.attempt.create({
      taskId: resolvedTaskId,
      prompt,
      outputFormat: output_format,
      outputSchema: output_schema,
    });

    // Start agent asynchronously
    fastify.agentManager.start({
      attemptId: attempt.id,
      projectPath: project.path,
      prompt,
      outputFormat: output_format,
      outputSchema: output_schema,
    });

    if (request_method === 'sync') {
      // Poll for completion
      const result = await waitForCompletion(fastify, attempt.id, timeout);
      if (!result) {
        return reply.code(408).send({
          error: 'Attempt timed out',
          attemptId: attempt.id,
          retryUrl: `/api/attempts/${attempt.id}`,
        });
      }
      return reply.code(200).send(result);
    }

    return reply.code(201).send(attempt);
  });

  fastify.get('/api/attempts/:id', async (request, reply) => {
    const { id } = request.params as any;
    const attempt = await fastify.services.attempt.getById(id);
    if (!attempt) return reply.code(404).send({ error: 'Attempt not found' });
    return attempt;
  });

  fastify.get('/api/attempts/:id/status', async (request, reply) => {
    const status = await fastify.services.attempt.getStatus((request.params as any).id);
    if (!status) return reply.code(404).send({ error: 'Attempt not found' });
    return status;
  });

  fastify.post('/api/attempts/:id/cancel', async (request, reply) => {
    const { id } = request.params as any;
    const cancelled = fastify.agentManager.cancel(id);
    await fastify.services.attempt.cancel(id);
    return { success: true };
  });

  fastify.post('/api/attempts/:id/answer', async (request, reply) => {
    const { id } = request.params as any;
    const { toolUseId, questions, answers } = request.body as any;
    if (!answers) return reply.code(400).send({ error: 'answers is required' });
    const result = fastify.agentManager.answerQuestion(id, toolUseId, questions || [], answers);
    if (!result) return reply.code(404).send({ error: 'No pending question for this attempt' });
    return { success: true };
  });
}

/** Poll attempt status until completed/failed/cancelled or timeout */
async function waitForCompletion(fastify: FastifyInstance, attemptId: string, timeoutMs: number) {
  const start = Date.now();
  const pollInterval = 500;

  while (Date.now() - start < timeoutMs) {
    const status = await fastify.services.attempt.getStatus(attemptId);
    if (status && status.status !== 'running') {
      return fastify.services.attempt.getById(attemptId);
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  return null;
}
