/**
 * Core Fastify application factory with CORS, content-type parser, and request logging
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import type { EnvConfig } from './config/env-config';

export async function buildFastifyApp(envConfig: EnvConfig) {
  const isDev = envConfig.nodeEnv !== 'production';

  const app = Fastify({
    logger: isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
          level: envConfig.logLevel,
        }
      : { level: envConfig.logLevel },
  });

  // CORS - allow all origins for API server usage
  await app.register(cors, { origin: true, credentials: true });

  // Multipart support for file uploads
  await app.register(multipart);

  // Accept plain text body as JSON fallback
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(null, body);
    }
  });

  // Request logging middleware
  app.addHook('onRequest', async (request) => {
    request.log.debug({ method: request.method, url: request.url }, 'incoming request');
  });

  return app;
}
