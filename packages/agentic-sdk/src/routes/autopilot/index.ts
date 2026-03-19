/**
 * Autopilot domain barrel — registers all autopilot sub-routes with Fastify
 */
import { FastifyInstance } from 'fastify';
import autopilotRoot from './route';

export default async function autopilotDomainRoutes(fastify: FastifyInstance) {
  await fastify.register(autopilotRoot);
}
