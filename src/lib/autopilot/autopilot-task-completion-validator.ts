// Validates whether an autopilot task was actually completed
// Uses a one-shot lightweight agent call with context file + recent chat history
// Selects cheapest model matching the task's provider (haiku for CLI, flash/air for SDK)
import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createLogger } from '../logger';
import { readContextFile } from './autopilot-context-file';
import type { ProviderId } from '../providers';
import { AVAILABLE_MODELS } from '../models';

const log = createLogger('AutopilotValidator');

// Keywords that indicate a cheap/fast/lightweight model (case-insensitive)
const CHEAP_MODEL_KEYWORDS = ['haiku', 'flash', 'air', 'mini', 'small', 'lite', 'turbo', 'nano'];

/**
 * Resolve the cheapest/fastest model for validation.
 * Strategy:
 * 1. CLI provider → check ANTHROPIC_DEFAULT_HAIKU_MODEL env, then scan AVAILABLE_MODELS for haiku tier
 * 2. SDK provider → scan the task's model name for family prefix, then find a cheap variant
 *    by appending cheap keywords (flash, mini, air, etc.)
 * 3. Fallback → task's own model or env default
 */
function resolveCheapModel(lastModel: string | null, lastProvider: string | null): { model: string; provider?: ProviderId } {
  // CLI provider → "haiku" alias > ANTHROPIC_DEFAULT_HAIKU_MODEL > ANTHROPIC_MODEL
  if (!lastProvider || lastProvider === 'claude-cli') {
    return { model: 'haiku', provider: 'claude-cli' };
  }

  // SDK provider → same priority chain: env haiku → available cheap → replace tier
  // 1. Check env for configured haiku model (works across providers)
  const sdkEnvHaiku = process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL?.trim();
  if (sdkEnvHaiku) return { model: sdkEnvHaiku, provider: 'claude-sdk' };

  // 2. Scan AVAILABLE_MODELS for any cheap keyword
  const sdkCheapModel = AVAILABLE_MODELS.find(m =>
    CHEAP_MODEL_KEYWORDS.some(kw => m.id.toLowerCase().includes(kw) || m.name.toLowerCase().includes(kw))
  );
  if (sdkCheapModel) return { model: sdkCheapModel.id, provider: 'claude-sdk' };

  // 3. Try to derive a cheap variant from the task's model
  if (lastModel) {
    const modelLower = lastModel.toLowerCase();

    // If task already uses a cheap model, reuse it
    if (CHEAP_MODEL_KEYWORDS.some(kw => modelLower.includes(kw))) {
      return { model: lastModel, provider: 'claude-sdk' };
    }

    // Replace tier words with cheap keywords
    const tierPattern = /pro|opus|sonnet|large|medium|plus|ultra/i;
    if (tierPattern.test(lastModel)) {
      for (const kw of CHEAP_MODEL_KEYWORDS) {
        const candidate: string = lastModel.replace(tierPattern, kw);
        if (candidate !== lastModel) {
          return { model: candidate, provider: 'claude-sdk' };
        }
      }
    }

    // No cheap variant derivable — use the task's own model
    return { model: lastModel, provider: 'claude-sdk' };
  }

  // No model info — fallback to env default
  const envDefault = process.env.ANTHROPIC_MODEL?.trim();
  return { model: envDefault || 'claude-haiku-4-5-20251001', provider: lastProvider as ProviderId || 'claude-cli' };
}

interface ValidationDeps {
  db: any;
  schema: any;
  agentManager: any;
  projectPath: string;
}

interface ValidationResult {
  completed: boolean;
  reason: string;
}

/**
 * Validate if a task was actually completed by examining context + chat history.
 * Spawns a one-shot agent with maxTurns=1 using a cheap model.
 * Returns a promise that resolves when validation is done.
 */
export async function validateTaskCompletion(
  task: any,
  attemptId: string,
  deps: ValidationDeps
): Promise<ValidationResult> {
  const { db, schema, agentManager, projectPath } = deps;

  // 1. Read context file
  const contextContent = readContextFile(projectPath, task.id) || 'No context file available.';

  // 2. Get last 10 chat messages from attempt_logs
  const recentLogs = await db
    .select()
    .from(schema.attemptLogs)
    .where(eq(schema.attemptLogs.attemptId, attemptId))
    .orderBy(desc(schema.attemptLogs.createdAt))
    .limit(10);

  // Extract text content from logs (reverse to chronological order)
  const chatHistory = recentLogs
    .reverse()
    .map((logEntry: any) => {
      if (logEntry.type === 'json') {
        try {
          const data = typeof logEntry.content === 'string'
            ? JSON.parse(logEntry.content) : logEntry.content;
          if (data.type === 'text' && data.text) return data.text;
          if (data.type === 'tool_use') return `[Tool: ${data.name}]`;
          if (data.type === 'tool_result') return `[Tool result: ${String(data.content).slice(0, 200)}]`;
        } catch { /* skip unparseable */ }
      }
      return logEntry.type === 'stderr' ? null : logEntry.content?.slice(0, 300);
    })
    .filter(Boolean)
    .join('\n---\n');

  // 3. Build validation prompt
  const validationPrompt = `You are a task completion validator. Analyze whether this task was fully completed.

TASK: ${task.title}
${task.description ? `DESCRIPTION: ${task.description}` : ''}

CONTEXT FILE:
${contextContent.slice(0, 2000)}

RECENT CHAT HISTORY (last 10 messages):
${chatHistory.slice(0, 3000)}

Based on the above, was this task fully completed? Consider:
- Did the agent implement what was asked?
- Are there remaining TODOs or errors mentioned?
- Did the agent indicate it finished or got stuck?

Respond with ONLY a JSON object, no other text:
{"completed": true/false, "reason": "brief explanation"}`;

  // 4. Resolve cheap model based on task's last model/provider
  const { model: validatorModel, provider: validatorProvider } = resolveCheapModel(
    task.lastModel || null,
    task.lastProvider || null
  );

  log.info({ taskId: task.id, validatorModel, validatorProvider, taskModel: task.lastModel, taskProvider: task.lastProvider }, 'Resolved validator model');

  // 5. Spawn one-shot validation agent
  return new Promise<ValidationResult>((resolve) => {
    const valAttemptId = nanoid();
    const valTaskId = nanoid();

    const setup = async () => {
      try {
        await db.insert(schema.tasks).values({
          id: valTaskId, projectId: task.projectId,
          title: '[Autopilot] Task completion validation',
          description: 'Internal validation check',
          status: 'in_progress', position: -2, chatInit: false,
          rewindSessionId: null, rewindMessageUuid: null,
          createdAt: Date.now(), updatedAt: Date.now(),
        });

        await db.insert(schema.attempts).values({
          id: valAttemptId, taskId: valTaskId, prompt: validationPrompt,
          displayPrompt: null, status: 'running',
          outputFormat: null, outputSchema: null,
        });

        const onExit = async ({ attemptId: exitId }: { attemptId: string; code: number | null }) => {
          if (exitId !== valAttemptId) return;
          agentManager.removeListener('exit', onExit);

          let result: ValidationResult = { completed: false, reason: 'Validation could not parse response, defaulting to not completed' };

          try {
            const logs = await db.query.attemptLogs.findMany({
              where: eq(schema.attemptLogs.attemptId, valAttemptId),
            });

            for (const logEntry of logs) {
              if (logEntry.type === 'json') {
                try {
                  const data = typeof logEntry.content === 'string'
                    ? JSON.parse(logEntry.content) : logEntry.content;
                  if (data.type === 'text' && data.text) {
                    const match = data.text.match(/\{[\s\S]*"completed"[\s\S]*\}/);
                    if (match) {
                      const parsed = JSON.parse(match[0]);
                      if (typeof parsed.completed === 'boolean') {
                        result = { completed: parsed.completed, reason: parsed.reason || '' };
                      }
                    }
                  }
                } catch { /* continue */ }
              }
            }
          } catch (err) {
            log.error({ err, taskId: task.id }, 'Validation response parsing failed');
          }

          // Cleanup internal task
          try {
            await db.delete(schema.attempts).where(eq(schema.attempts.taskId, valTaskId));
            await db.delete(schema.tasks).where(eq(schema.tasks.id, valTaskId));
          } catch { /* ignore cleanup errors */ }

          log.info({ taskId: task.id, completed: result.completed, reason: result.reason }, 'Validation result');
          resolve(result);
        };

        agentManager.on('exit', onExit);

        agentManager.start({
          attemptId: valAttemptId,
          projectPath,
          prompt: validationPrompt,
          maxTurns: 1,
          model: validatorModel,
          ...(validatorProvider ? { provider: validatorProvider } : {}),
        });

        log.info({ taskId: task.id, valAttemptId, model: validatorModel, provider: validatorProvider }, 'Validation agent started');
      } catch (err) {
        log.error({ err, taskId: task.id }, 'Failed to start validation');
        // Cleanup on failure
        try {
          await db.delete(schema.attempts).where(eq(schema.attempts.taskId, valTaskId));
          await db.delete(schema.tasks).where(eq(schema.tasks.id, valTaskId));
        } catch { /* ignore */ }
        resolve({ completed: false, reason: 'Validation setup failed, defaulting to not completed' });
      }
    };

    setup();
  });
}
