/**
 * Search routes - search file content by query and search files by name pattern
 */
import { FastifyInstance } from 'fastify';

export default async function searchRoutes(fastify: FastifyInstance) {
  fastify.get('/api/search', async (request, reply) => {
    const { projectPath, query, glob } = request.query as any;
    if (!projectPath || !query) {
      return reply.code(400).send({ error: 'projectPath and query are required' });
    }
    return fastify.services.search.searchContent(projectPath, query, { glob });
  });

  fastify.get('/api/search/files', async (request, reply) => {
    const { projectPath, pattern } = request.query as any;
    if (!projectPath || !pattern) {
      return reply.code(400).send({ error: 'projectPath and pattern are required' });
    }
    return fastify.services.search.searchFiles(projectPath, pattern);
  });
}
