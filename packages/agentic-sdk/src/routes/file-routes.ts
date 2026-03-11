/**
 * File routes - list, read, write, and delete files within a project path
 */
import { FastifyInstance } from 'fastify';

export default async function fileRoutes(fastify: FastifyInstance) {
  fastify.get('/api/files', async (request, reply) => {
    const { projectPath, subPath } = request.query as any;
    if (!projectPath) return reply.code(400).send({ error: 'projectPath is required' });
    return fastify.services.file.listFiles(projectPath, subPath);
  });

  fastify.get('/api/files/content', async (request, reply) => {
    const { projectPath, filePath } = request.query as any;
    if (!projectPath || !filePath) {
      return reply.code(400).send({ error: 'projectPath and filePath are required' });
    }
    try {
      const content = await fastify.services.file.getFileContent(projectPath, filePath);
      return { content };
    } catch {
      return reply.code(404).send({ error: 'File not found' });
    }
  });

  fastify.post('/api/files', async (request, reply) => {
    const { projectPath, filePath, content } = request.body as any;
    if (!projectPath || !filePath || content === undefined) {
      return reply.code(400).send({ error: 'projectPath, filePath, and content are required' });
    }
    await fastify.services.file.writeFile(projectPath, filePath, content);
    return reply.code(201).send({ success: true });
  });

  fastify.delete('/api/files', async (request, reply) => {
    const { projectPath, filePath } = request.query as any;
    if (!projectPath || !filePath) {
      return reply.code(400).send({ error: 'projectPath and filePath are required' });
    }
    try {
      await fastify.services.file.deleteFile(projectPath, filePath);
      return reply.code(204).send();
    } catch {
      return reply.code(404).send({ error: 'File not found' });
    }
  });
}
