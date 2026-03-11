/**
 * Authentication routes - API key verification
 */
import { FastifyInstance } from 'fastify';

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.get('/api/auth/verify', async (_request, _reply) => {
    return { authenticated: true };
  });
}
