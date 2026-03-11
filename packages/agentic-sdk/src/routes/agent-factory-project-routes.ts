/**
 * Agent factory project routes - discover plugins, and associate/disassociate plugins with projects
 */
import { FastifyInstance } from 'fastify';

export default async function agentFactoryProjectRoutes(fastify: FastifyInstance) {
  fastify.post('/api/agent-factory/discover', async (request, reply) => {
    const { path } = request.body as any;
    if (!path) return reply.code(400).send({ error: 'path is required' });
    const plugins = await fastify.services.agentFactory.discoverPlugins(path);
    return reply.code(200).send(plugins);
  });

  fastify.get('/api/agent-factory/projects/:projectId/plugins', async (request, _reply) => {
    return fastify.services.agentFactory.listProjectPlugins((request.params as any).projectId);
  });

  fastify.post('/api/agent-factory/projects/:projectId/plugins/:pluginId', async (request, reply) => {
    const { projectId, pluginId } = request.params as any;
    const result = await fastify.services.agentFactory.associatePlugin(projectId, pluginId);
    if (!result) return reply.code(404).send({ error: 'Project or plugin not found' });
    return reply.code(201).send(result);
  });

  fastify.delete('/api/agent-factory/projects/:projectId/plugins/:pluginId', async (request, reply) => {
    const { projectId, pluginId } = request.params as any;
    await fastify.services.agentFactory.disassociatePlugin(projectId, pluginId);
    return reply.code(204).send();
  });
}
