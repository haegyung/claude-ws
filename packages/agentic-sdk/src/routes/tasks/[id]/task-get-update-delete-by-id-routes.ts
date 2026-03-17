/**
 * Task by ID routes - GET, PUT, PATCH, DELETE /api/tasks/:id
 */
import { FastifyInstance } from 'fastify';
import { VALID_TASK_STATUSES } from '../../../constants/valid-task-statuses';

const VALID_STATUSES = VALID_TASK_STATUSES as unknown as string[];

export default async function taskGetUpdateDeleteByIdRoutes(fastify: FastifyInstance) {
  // GET /api/tasks/:id - get single task by id
  fastify.get('/api/tasks/:id', async (request, reply) => {
    try {
      const task = await fastify.services.task.getById((request.params as any).id);
      if (!task) return reply.code(404).send({ error: 'Task not found' });
      return task;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // Shared PUT/PATCH handler - update selective task fields
  const handleUpdate = async (request: any, reply: any) => {
    try {
      const id = request.params.id;
      const { title, description, status, position, chatInit, lastModel, lastProvider } = request.body as any;

      // Validate at least one field is provided
      if (
        !title &&
        !description &&
        !status &&
        position === undefined &&
        chatInit === undefined &&
        lastModel === undefined &&
        lastProvider === undefined
      ) {
        return reply.code(400).send({ error: 'No fields to update' });
      }

      // Validate status value if provided
      if (status !== undefined && !VALID_STATUSES.includes(status)) {
        return reply.code(400).send({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
      }

      // Check existence before update
      const existing = await fastify.services.task.getById(id);
      if (!existing) return reply.code(404).send({ error: 'Task not found' });

      // Build selective update object
      const updateData: Record<string, any> = { updatedAt: Date.now() };
      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (status !== undefined) updateData.status = status;
      if (position !== undefined) updateData.position = position;
      if (chatInit !== undefined) updateData.chatInit = chatInit ? 1 : 0;
      if (lastModel !== undefined) updateData.lastModel = lastModel;
      if (lastProvider !== undefined) {
        if (!['claude-cli', 'claude-sdk'].includes(lastProvider)) {
          return reply.code(400).send({ error: 'Invalid lastProvider value' });
        }
        updateData.lastProvider = lastProvider;
      }

      const task = await fastify.services.task.update(id, updateData);
      return task;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  };

  // PUT /api/tasks/:id - update task fields
  fastify.put('/api/tasks/:id', handleUpdate);

  // PATCH /api/tasks/:id - alias for PUT
  fastify.patch('/api/tasks/:id', handleUpdate);

  // DELETE /api/tasks/:id - delete task and clean up associated upload files
  fastify.delete('/api/tasks/:id', async (request, reply) => {
    try {
      const id = (request.params as any).id;

      // Check existence before delete
      const existing = await fastify.services.task.getById(id);
      if (!existing) return reply.code(404).send({ error: 'Task not found' });

      // Query all attempts for this task to clean up upload files
      const attempts = await fastify.services.task.getAttempts(id);

      // Delete physical upload files for each attempt via service
      for (const attempt of attempts) {
        await fastify.services.upload.cleanupAttemptFiles(attempt.id);
      }

      await fastify.services.task.remove(id);
      return reply.code(200).send({ success: true });
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
