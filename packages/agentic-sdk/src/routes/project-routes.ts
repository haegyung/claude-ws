/**
 * Project routes - CRUD operations for projects
 */
import { FastifyInstance } from 'fastify';

export default async function projectRoutes(fastify: FastifyInstance) {
  fastify.get('/api/projects', async (_request, _reply) => {
    return fastify.services.project.list();
  });

  fastify.get('/api/projects/:id', async (request, reply) => {
    const project = await fastify.services.project.getById((request.params as any).id);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return project;
  });

  fastify.post('/api/projects', async (request, reply) => {
    const { name, path } = request.body as any;
    if (!name || !path) return reply.code(400).send({ error: 'name and path are required' });
    const project = await fastify.services.project.create({ name, path });
    return reply.code(201).send(project);
  });

  fastify.put('/api/projects/:id', async (request, reply) => {
    const project = await fastify.services.project.update(
      (request.params as any).id,
      request.body as any,
    );
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return project;
  });

  fastify.delete('/api/projects/:id', async (request, reply) => {
    const existing = await fastify.services.project.getById((request.params as any).id);
    if (!existing) return reply.code(404).send({ error: 'Project not found' });
    await fastify.services.project.remove((request.params as any).id);
    return reply.code(204).send();
  });
}
