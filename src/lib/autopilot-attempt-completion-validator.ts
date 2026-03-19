/**
 * Validates whether an attempt actually completed a task by using AI
 * to read the last conversation messages and judge the outcome.
 * Prevents false completions where the agent exited with code 0
 * but didn't actually implement anything.
 */
import { eq, and, desc } from 'drizzle-orm';
import { createLogger } from './logger';
import { cliQuery } from './cli-query';

const log = createLogger('AutopilotValidator');

// Number of recent conversation messages to feed the validator
const MAX_MESSAGES_FOR_VALIDATION = 10;

export interface ValidationResult {
  valid: boolean;
  reason: string;
}

/**
 * Use AI to validate whether the latest completed attempt actually solved the task.
 * Reads the last N conversation messages and asks the LLM to judge completion.
 */
export async function validateAttemptCompletion(
  taskId: string,
  db: any,
  schema: any,
): Promise<ValidationResult> {
  // Get the task details
  const task = await db.query.tasks.findFirst({
    where: eq(schema.tasks.id, taskId),
  });

  if (!task) {
    return { valid: false, reason: 'Task not found' };
  }

  // Get the latest completed attempt
  const attempts = await db
    .select()
    .from(schema.attempts)
    .where(
      and(
        eq(schema.attempts.taskId, taskId),
        eq(schema.attempts.status, 'completed'),
      ),
    );

  if (attempts.length === 0) {
    return { valid: false, reason: 'No completed attempt found' };
  }

  const attempt = attempts.reduce((latest: any, a: any) =>
    (a.createdAt || 0) > (latest.createdAt || 0) ? a : latest,
  );

  // Quick pre-check: if 0 tokens and 0 turns, agent never ran — skip AI call
  const turns = attempt.numTurns || 0;
  const tokens = attempt.totalTokens || 0;
  if (turns === 0 && tokens === 0) {
    return {
      valid: false,
      reason: 'Agent never executed (0 turns, 0 tokens)',
    };
  }

  // Get last N conversation logs (assistant/user messages only)
  const logs = await db
    .select()
    .from(schema.attemptLogs)
    .where(eq(schema.attemptLogs.attemptId, attempt.id));

  // Filter to conversation messages and extract text content
  const conversationMessages = extractConversationSummary(logs);

  if (conversationMessages.length === 0) {
    return { valid: false, reason: 'No conversation messages found' };
  }

  // Take last N messages
  const recentMessages = conversationMessages.slice(-MAX_MESSAGES_FOR_VALIDATION);

  // Build validation prompt
  const taskDescription = task.description || task.title;
  const conversationText = recentMessages.join('\n\n');

  const validationPrompt = `You are a task completion validator. Your job is to determine if an AI agent successfully completed the assigned task based on its conversation log.

TASK: ${taskDescription}

LAST ${recentMessages.length} CONVERSATION MESSAGES:
${conversationText}

INSTRUCTIONS:
- Analyze whether the agent actually worked on and completed the task
- "Completed" means the agent made meaningful progress: wrote code, made changes, provided the requested output, etc.
- If the agent only acknowledged the task, started thinking, or crashed before doing real work, that is NOT completed
- If the agent explicitly said it completed the task and showed evidence of changes, that IS completed

Respond with EXACTLY one line in this format:
VERDICT: COMPLETED or VERDICT: INCOMPLETE
REASON: <brief explanation>`;

  try {
    // Resolve project CWD for the CLI query
    const project = await db.query.projects.findFirst({
      where: eq(schema.projects.id, task.projectId),
    });
    const cwd = project?.path || process.cwd();

    log.info({ taskId, attemptId: attempt.id, messageCount: recentMessages.length }, 'Running AI validation');

    const result = await cliQuery({
      prompt: validationPrompt,
      cwd,
      maxTurns: 1,
      noTools: true,
      lite: true,
    });

    const response = result.text.trim();
    const isCompleted = response.toUpperCase().includes('VERDICT: COMPLETED');
    const reasonMatch = response.match(/REASON:\s*(.+)/i);
    const reason = reasonMatch?.[1]?.trim() || response.substring(0, 200);

    log.info({ taskId, isCompleted, reason }, 'AI validation result');

    return {
      valid: isCompleted,
      reason,
    };
  } catch (error: any) {
    log.error({ taskId, error: error.message }, 'AI validation failed, falling back to heuristic');
    // Fallback: if AI call fails, use simple heuristic
    return heuristicValidation(attempt);
  }
}

/**
 * Extract readable conversation messages from attempt logs.
 * Returns array of formatted message strings.
 */
function extractConversationSummary(logs: any[]): string[] {
  const messages: string[] = [];

  for (const l of logs) {
    if (l.type !== 'json') continue;
    try {
      const parsed = JSON.parse(l.content);

      if (parsed?.type === 'assistant' && parsed?.message?.content) {
        const textBlocks = parsed.message.content
          .filter((block: any) => block.type === 'text' || block.type === 'tool_use')
          .map((block: any) => {
            if (block.type === 'text') return block.text;
            if (block.type === 'tool_use') return `[Tool: ${block.name}]`;
            return '';
          })
          .filter(Boolean);

        if (textBlocks.length > 0) {
          // Truncate long messages to save tokens
          const combined = textBlocks.join('\n');
          const truncated = combined.length > 500
            ? combined.substring(0, 500) + '...(truncated)'
            : combined;
          messages.push(`ASSISTANT: ${truncated}`);
        }
      }

      if (parsed?.type === 'user' && parsed?.message?.content) {
        const text = typeof parsed.message.content === 'string'
          ? parsed.message.content
          : JSON.stringify(parsed.message.content);
        const truncated = text.length > 300
          ? text.substring(0, 300) + '...(truncated)'
          : text;
        messages.push(`USER: ${truncated}`);
      }

      // Include tool results as context
      if (parsed?.type === 'result') {
        const text = typeof parsed.content === 'string'
          ? parsed.content
          : JSON.stringify(parsed.content || '');
        const truncated = text.length > 200
          ? text.substring(0, 200) + '...(truncated)'
          : text;
        messages.push(`TOOL_RESULT: ${truncated}`);
      }
    } catch {
      // Skip unparseable logs
    }
  }

  return messages;
}

/** Fallback heuristic when AI validation is unavailable */
function heuristicValidation(attempt: any): ValidationResult {
  const turns = attempt.numTurns || 0;
  const tokens = attempt.totalTokens || 0;
  const duration = attempt.durationMs || 0;

  if (turns >= 3 && tokens >= 500 && duration >= 10000) {
    return { valid: true, reason: 'Heuristic: sufficient turns/tokens/duration' };
  }

  return {
    valid: false,
    reason: `Heuristic: insufficient work (${turns} turns, ${tokens} tokens, ${duration}ms)`,
  };
}
