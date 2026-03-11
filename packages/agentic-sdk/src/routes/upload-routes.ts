/**
 * Upload routes - list, create, get, and delete file uploads associated with attempts
 */
import { FastifyInstance } from 'fastify';

export default async function uploadRoutes(fastify: FastifyInstance) {
  fastify.get('/api/uploads', async (request, reply) => {
    const { attemptId } = request.query as any;
    if (!attemptId) return reply.code(400).send({ error: 'attemptId is required' });
    return fastify.services.upload.list(attemptId);
  });

  fastify.post('/api/uploads', async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'No file provided' });
    const fields = data.fields as any;
    const attemptId = fields?.attemptId?.value;
    if (!attemptId) return reply.code(400).send({ error: 'attemptId is required' });
    const buffer = await data.toBuffer();
    const upload = await fastify.services.upload.save(attemptId, {
      filename: data.filename,
      originalName: data.filename,
      mimeType: data.mimetype,
      size: buffer.length,
      buffer,
    });
    return reply.code(201).send(upload);
  });

  fastify.get('/api/uploads/:id', async (request, reply) => {
    const upload = await fastify.services.upload.getById((request.params as any).id);
    if (!upload) return reply.code(404).send({ error: 'Upload not found' });
    return upload;
  });

  fastify.delete('/api/uploads/:id', async (request, reply) => {
    const existing = await fastify.services.upload.getById((request.params as any).id);
    if (!existing) return reply.code(404).send({ error: 'Upload not found' });
    await fastify.services.upload.remove((request.params as any).id);
    return reply.code(204).send();
  });
}
