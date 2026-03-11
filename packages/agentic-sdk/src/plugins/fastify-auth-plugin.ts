/**
 * Fastify plugin for API key authentication via x-api-key header.
 * Uses timing-safe comparison to prevent timing attacks.
 * Skips auth if no API_ACCESS_KEY is configured, or for health check routes.
 */
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { safeCompare } from '../lib/timing-safe-compare.ts';
import type { EnvConfig } from '../config/env-config.ts';

interface AuthPluginOptions {
  envConfig: EnvConfig;
}

const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (app, opts) => {
  const { apiAccessKey } = opts.envConfig;

  // Skip auth entirely if no key is configured
  if (!apiAccessKey) {
    app.log.warn('No API_ACCESS_KEY configured - all requests will be allowed');
    return;
  }

  app.addHook('onRequest', async (request, reply) => {
    // Skip health check routes
    if (request.url === '/health' || request.url.startsWith('/health?')) {
      return;
    }

    const provided = request.headers['x-api-key'];

    if (typeof provided !== 'string' || !safeCompare(provided, apiAccessKey)) {
      reply.code(401).send({ error: 'Unauthorized: invalid or missing x-api-key header' });
    }
  });
};

export const registerAuthPlugin = fp(authPlugin, {
  name: 'fastify-auth-plugin',
});
