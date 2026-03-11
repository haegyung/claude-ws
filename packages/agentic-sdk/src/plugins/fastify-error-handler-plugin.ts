/**
 * Fastify plugin that sets a global error handler.
 * Maps validation errors to 400, not-found to 404, and logs all errors with pino.
 */
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

const errorHandlerPlugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode ?? 500;

    // Log at appropriate level
    if (statusCode >= 500) {
      request.log.error({ err: error, url: request.url }, error.message);
    } else {
      request.log.warn({ err: error, url: request.url }, error.message);
    }

    // Fastify validation errors
    if (error.validation) {
      return reply.code(400).send({ error: 'Validation error', details: error.validation });
    }

    return reply.code(statusCode).send({ error: error.message || 'Internal server error' });
  });

  // 404 handler for unmatched routes
  app.setNotFoundHandler((request, reply) => {
    request.log.debug({ url: request.url }, 'route not found');
    reply.code(404).send({ error: `Route ${request.method} ${request.url} not found` });
  });
};

export const registerErrorHandlerPlugin = fp(errorHandlerPlugin, {
  name: 'fastify-error-handler-plugin',
});
