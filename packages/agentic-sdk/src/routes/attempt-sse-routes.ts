/**
 * Attempt SSE routes - Server-Sent Events streaming for real-time agent output
 */
import { FastifyInstance } from 'fastify';

export default async function attemptSseRoutes(fastify: FastifyInstance) {
  fastify.get('/api/attempts/:id/stream', async (request, reply) => {
    const attemptId = (request.params as any).id;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const onJson = (data: any) => {
      if (data.attemptId === attemptId) {
        reply.raw.write(`data: ${JSON.stringify(data.data)}\n\n`);
      }
    };

    const onExit = (data: any) => {
      if (data.attemptId === attemptId) {
        reply.raw.write(`event: done\ndata: ${JSON.stringify({ code: data.code })}\n\n`);
        reply.raw.end();
        cleanup();
      }
    };

    function cleanup() {
      fastify.agentManager.removeListener('json', onJson);
      fastify.agentManager.removeListener('exit', onExit);
    }

    fastify.agentManager.on('json', onJson);
    fastify.agentManager.on('exit', onExit);

    request.raw.on('close', cleanup);
  });
}
