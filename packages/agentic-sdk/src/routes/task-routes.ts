/**
 * Task routes - CRUD, reorder, attempts, and conversation history
 */
import { FastifyInstance } from 'fastify';

export default async function taskRoutes(fastify: FastifyInstance) {
  fastify.get('/api/tasks', async (request, _reply) => {
    const { projectId } = request.query as any;
    return fastify.services.task.list(projectId);
  });

  fastify.get('/api/tasks/:id', async (request, reply) => {
    const task = await fastify.services.task.getById((request.params as any).id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    return task;
  });

  fastify.post('/api/tasks', async (request, reply) => {
    const { projectId, title, description } = request.body as any;
    if (!projectId || !title) return reply.code(400).send({ error: 'projectId and title are required' });
    const task = await fastify.services.task.create({ projectId, title, description });
    return reply.code(201).send(task);
  });

  fastify.put('/api/tasks/:id', async (request, reply) => {
    const task = await fastify.services.task.update(
      (request.params as any).id,
      request.body as any,
    );
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    return task;
  });

  fastify.delete('/api/tasks/:id', async (request, reply) => {
    const existing = await fastify.services.task.getById((request.params as any).id);
    if (!existing) return reply.code(404).send({ error: 'Task not found' });
    await fastify.services.task.remove((request.params as any).id);
    return reply.code(204).send();
  });

  fastify.put('/api/tasks/:id/reorder', async (request, reply) => {
    const { position, status } = request.body as any;
    const task = await fastify.services.task.reorder(
      (request.params as any).id,
      position,
      status,
    );
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    return task;
  });

  fastify.get('/api/tasks/:id/attempts', async (request, reply) => {
    const attempts = await fastify.services.task.getAttempts((request.params as any).id);
    return attempts;
  });

  fastify.get('/api/tasks/:id/conversation', async (request, reply) => {
    const conversation = await fastify.services.task.getConversation((request.params as any).id);
    if (!conversation) return reply.code(404).send({ error: 'Conversation not found' });
    return conversation;
  });
}
