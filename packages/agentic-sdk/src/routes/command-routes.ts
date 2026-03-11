/**
 * Command routes - list available Claude Code slash commands
 */
import { FastifyInstance } from 'fastify';

export default async function commandRoutes(fastify: FastifyInstance) {
  fastify.get('/api/commands', async (_request, _reply) => {
    return fastify.services.command.list();
  });
}
