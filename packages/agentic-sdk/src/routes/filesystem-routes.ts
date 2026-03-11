/**
 * Filesystem routes - return server filesystem metadata including cwd, homedir, and platform
 */
import { FastifyInstance } from 'fastify';
import os from 'os';

export default async function filesystemRoutes(fastify: FastifyInstance) {
  fastify.get('/api/filesystem/info', async (_request, _reply) => {
    return {
      cwd: process.cwd(),
      homedir: os.homedir(),
      platform: process.platform,
    };
  });
}
