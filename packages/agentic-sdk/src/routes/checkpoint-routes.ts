/**
 * Checkpoint routes - create, list, rewind, and backfill conversation checkpoints per task
 */
import { FastifyInstance } from 'fastify';

export default async function checkpointRoutes(fastify: FastifyInstance) {
  fastify.get('/api/tasks/:taskId/checkpoints', async (request, _reply) => {
    return fastify.services.checkpoint.list((request.params as any).taskId);
  });

  fastify.post('/api/tasks/:taskId/checkpoints', async (request, reply) => {
    const checkpoint = await fastify.services.checkpoint.create({
      taskId: (request.params as any).taskId,
      ...(request.body as any),
    });
    return reply.code(201).send(checkpoint);
  });

  fastify.post('/api/tasks/:taskId/checkpoints/:id/rewind', async (request, reply) => {
    const { taskId, id } = request.params as any;
    const result = await fastify.services.checkpoint.rewind(taskId, id);
    if (!result) return reply.code(404).send({ error: 'Checkpoint not found' });
    return result;
  });

  fastify.post('/api/tasks/:taskId/checkpoints/backfill', async (request, reply) => {
    const { taskId } = request.params as any;
    const { checkpoints } = request.body as any;
    if (!Array.isArray(checkpoints)) {
      return reply.code(400).send({ error: 'checkpoints array is required' });
    }
    const result = await fastify.services.checkpoint.backfill(taskId, checkpoints);
    return reply.code(201).send(result);
  });
}
