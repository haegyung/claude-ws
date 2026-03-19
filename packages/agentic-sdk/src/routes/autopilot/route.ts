/**
 * Autopilot routes — GET /api/autopilot/status, POST /api/autopilot/toggle
 */
import { FastifyInstance } from 'fastify';

export default async function autopilotRoute(fastify: FastifyInstance) {
  fastify.get('/api/autopilot/status', async (_request, reply) => {
    try {
      if (!fastify.services.autopilot) {
        return reply.code(503).send({ error: 'Autopilot service not configured' });
      }
      return fastify.services.autopilot.getStatus();
    } catch (err) {
      fastify.log.error(err, 'Failed to get autopilot status');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post('/api/autopilot/toggle', async (_request, reply) => {
    try {
      if (!fastify.services.autopilot) {
        return reply.code(503).send({ error: 'Autopilot service not configured' });
      }
      return await fastify.services.autopilot.toggle();
    } catch (err) {
      fastify.log.error(err, 'Failed to toggle autopilot');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
