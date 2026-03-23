/**
 * Projects root route - list and create projects.
 * Thin transport adapter — all logic in project-crud service.
 */
import { FastifyInstance } from 'fastify';
import { ProjectValidationError } from '../../services/project/project-crud';

export default async function projectsRoute(fastify: FastifyInstance) {
  fastify.get('/api/projects', async () => {
    return fastify.services.project.list();
  });

  fastify.post('/api/projects', async (request, reply) => {
    try {
      const { id, projectId, name, path: projectPath } = request.body as any;
      const project = await fastify.services.project.createProject({ id: projectId || id, name, path: projectPath });
      return reply.code(201).send(project);
    } catch (error: any) {
      if (error instanceof ProjectValidationError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      request.log.error({ err: error }, 'Failed to create project');
      return reply.code(500).send({ error: 'Failed to create project' });
    }
  });
}
