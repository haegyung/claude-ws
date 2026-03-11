/**
 * Agent factory plugin routes - CRUD, file content, and dependency management for plugins
 */
import { FastifyInstance } from 'fastify';

export default async function agentFactoryPluginRoutes(fastify: FastifyInstance) {
  fastify.get('/api/agent-factory/plugins', async (request, _reply) => {
    const { type, projectId } = request.query as any;
    return fastify.services.agentFactory.listPlugins({ type, projectId });
  });

  fastify.get('/api/agent-factory/plugins/:id', async (request, reply) => {
    const plugin = await fastify.services.agentFactory.getPlugin((request.params as any).id);
    if (!plugin) return reply.code(404).send({ error: 'Plugin not found' });
    return plugin;
  });

  fastify.post('/api/agent-factory/plugins', async (request, reply) => {
    const plugin = await fastify.services.agentFactory.createPlugin(request.body as any);
    return reply.code(201).send(plugin);
  });

  fastify.put('/api/agent-factory/plugins/:id', async (request, reply) => {
    const plugin = await fastify.services.agentFactory.updatePlugin(
      (request.params as any).id,
      request.body as any,
    );
    if (!plugin) return reply.code(404).send({ error: 'Plugin not found' });
    return plugin;
  });

  fastify.delete('/api/agent-factory/plugins/:id', async (request, reply) => {
    const existing = await fastify.services.agentFactory.getPlugin((request.params as any).id);
    if (!existing) return reply.code(404).send({ error: 'Plugin not found' });
    await fastify.services.agentFactory.deletePlugin((request.params as any).id);
    return reply.code(204).send();
  });

  fastify.get('/api/agent-factory/plugins/:id/file', async (request, reply) => {
    const content = await fastify.services.agentFactory.getPluginFile((request.params as any).id);
    if (content === null) return reply.code(404).send({ error: 'Plugin file not found' });
    return content;
  });

  fastify.put('/api/agent-factory/plugins/:id/file', async (request, reply) => {
    const { content } = request.body as any;
    if (content === undefined) return reply.code(400).send({ error: 'content is required' });
    const result = await fastify.services.agentFactory.updatePluginFile(
      (request.params as any).id,
      content,
    );
    if (!result) return reply.code(404).send({ error: 'Plugin not found' });
    return result;
  });

  fastify.get('/api/agent-factory/plugins/:id/dependencies', async (request, reply) => {
    const deps = await fastify.services.agentFactory.listDependencies((request.params as any).id);
    if (!deps) return reply.code(404).send({ error: 'Plugin not found' });
    return deps;
  });

  fastify.post('/api/agent-factory/plugins/:id/dependencies', async (request, reply) => {
    const dep = await fastify.services.agentFactory.addDependency(
      (request.params as any).id,
      request.body as any,
    );
    if (!dep) return reply.code(404).send({ error: 'Plugin not found' });
    return reply.code(201).send(dep);
  });

  fastify.delete('/api/agent-factory/plugins/:id/dependencies/:depId', async (request, reply) => {
    const { id, depId } = request.params as any;
    await fastify.services.agentFactory.removeDependency(depId);
    return reply.code(204).send();
  });
}
