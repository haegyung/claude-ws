/**
 * Task pending question routes
 * - GET  /api/tasks/:id/pending-question         — get persistent pending question for a task
 * - POST /api/tasks/:id/pending-question/answer   — submit answer to a pending question
 */
import { FastifyInstance } from 'fastify';

export default async function taskPendingQuestionRoutes(fastify: FastifyInstance) {
  // GET — retrieve pending question (includes answer if already answered)
  fastify.get('/api/tasks/:id/pending-question', async (request, _reply) => {
    const { id: taskId } = request.params as any;

    const data = (fastify.agentManager as any).getPersistentQuestion?.(taskId);
    if (!data) return { question: null };

    return {
      question: {
        attemptId: data.attemptId,
        toolUseId: data.toolUseId,
        questions: data.questions,
        answer: data.answer || null,
        answeredAt: data.answeredAt || null,
      },
    };
  });

  // POST — submit answer to pending question (idempotent)
  fastify.post('/api/tasks/:id/pending-question/answer', async (request, reply) => {
    const { id: taskId } = request.params as any;
    const { toolUseId, answers } = request.body as {
      toolUseId?: string;
      answers: Record<string, string>;
    };

    if (!answers || typeof answers !== 'object' || Object.keys(answers).length === 0) {
      return reply.status(400).send({ error: 'answers must be a non-empty object' });
    }

    const agentManager = fastify.agentManager as any;
    const data = agentManager.getPersistentQuestion?.(taskId);

    if (!data) {
      return reply.status(404).send({ error: 'No pending question for this task' });
    }

    // Idempotent: already answered
    if (data.answer) {
      return { ok: true, alreadyAnswered: true };
    }

    // Store answer in persistent store
    agentManager.questionStore?.setAnswer(taskId, answers);

    // Deliver to agent (resolves SDK Promise or writes CLI stdin)
    const resolvedToolUseId = toolUseId || data.toolUseId;
    const success = agentManager.answerQuestion(
      data.attemptId,
      resolvedToolUseId,
      data.questions,
      answers,
    );

    if (success) {
      agentManager.clearPersistentQuestion(taskId);
    }

    return { ok: success };
  });
}
