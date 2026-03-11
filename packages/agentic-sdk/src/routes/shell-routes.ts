/**
 * Shell routes - list, create, update, and get shell process records per project
 */
import { FastifyInstance } from 'fastify';

export default async function shellRoutes(fastify: FastifyInstance) {
  fastify.get('/api/shells', async (request, reply) => {
    const { projectId } = request.query as any;
    if (!projectId) return reply.code(400).send({ error: 'projectId is required' });
    return fastify.services.shell.list(projectId);
  });

  fastify.post('/api/shells', async (request, reply) => {
    const shell = await fastify.services.shell.create(request.body as any);
    return reply.code(201).send(shell);
  });

  fastify.put('/api/shells/:id', async (request, reply) => {
    const { status, exitCode, exitSignal, stoppedAt } = request.body as any;
    if (!status) return reply.code(400).send({ error: 'status is required' });
    const shell = await fastify.services.shell.updateStatus(
      (request.params as any).id,
      status,
      { exitCode, exitSignal, stoppedAt },
    );
    if (!shell) return reply.code(404).send({ error: 'Shell not found' });
    return shell;
  });

  fastify.get('/api/shells/:id', async (request, reply) => {
    const shell = await fastify.services.shell.getById((request.params as any).id);
    if (!shell) return reply.code(404).send({ error: 'Shell not found' });
    return shell;
  });
}
