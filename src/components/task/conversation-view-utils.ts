import { isProviderAuthError } from '@/components/auth/agent-provider-dialog';
import type { ClaudeOutput, AttemptFile } from '@/types';

export interface ActiveQuestion {
  attemptId: string;
  toolUseId: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
}

export interface ConversationTurn {
  type: 'user' | 'assistant';
  prompt?: string;
  messages: ClaudeOutput[];
  attemptId: string;
  timestamp: number;
  files?: AttemptFile[];
  attemptStatus?: string;
}

export interface ToolResult {
  result: string;
  isError: boolean;
}

/**
 * Build a map of tool_use_id -> result from messages.
 * Extracts results from both top-level tool_result messages
 * and tool_result blocks nested inside user messages.
 */
export function buildToolResultsMap(messages: ClaudeOutput[]): Map<string, ToolResult> {
  const map = new Map<string, ToolResult>();

  for (const msg of messages) {
    if (msg.type === 'tool_result') {
      const toolUseId = (msg.tool_data?.tool_use_id as string) || (msg.tool_data?.id as string);
      if (toolUseId) {
        map.set(toolUseId, {
          result: extractResultString(msg.result),
          isError: msg.is_error || false,
        });
      }
    }

    // CLI outputs tool_result blocks inside user messages
    if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_result') {
          const toolUseId = (block as { tool_use_id?: string }).tool_use_id;
          if (toolUseId) {
            const content = (block as { content?: string }).content;
            map.set(toolUseId, {
              result: typeof content === 'string' ? content : JSON.stringify(content || ''),
              isError: (block as { is_error?: boolean }).is_error || false,
            });
          }
        }
      }
    }
  }

  return map;
}

function extractResultString(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const obj = result as { text?: string };
    return obj.text || JSON.stringify(result);
  }
  return '';
}

/**
 * Check if messages contain visible content (text, thinking, or tool_use).
 * Used to keep the "Thinking..." spinner until actual content appears.
 */
export function hasVisibleContent(messages: ClaudeOutput[]): boolean {
  return messages.some(msg => {
    if (msg.type === 'assistant' && msg.message?.content?.length) {
      return msg.message.content.some(block =>
        (block.type === 'text' && block.text) ||
        (block.type === 'thinking' && block.thinking) ||
        block.type === 'tool_use'
      );
    }
    return msg.type === 'tool_use';
  });
}

/**
 * Check if messages contain an auth/provider error and return the error message.
 */
export function findAuthError(messages: ClaudeOutput[]): string | null {
  for (const msg of messages) {
    if (msg.type === 'tool_result' && msg.is_error && msg.result) {
      const result = typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result);
      if (isProviderAuthError(result)) return result;
    }

    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text && isProviderAuthError(block.text)) {
          return block.text;
        }
      }
    }
  }
  return null;
}

/**
 * Find the last tool_use ID across all messages.
 */
export function findLastToolUseId(messages: ClaudeOutput[]): string | null {
  let lastToolUseId: string | null = null;
  for (const msg of messages) {
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use' && block.id) {
          lastToolUseId = block.id;
        }
      }
    }
    if (msg.type === 'tool_use' && msg.id) {
      lastToolUseId = msg.id;
    }
  }
  return lastToolUseId;
}

/**
 * Check if a tool_use is currently executing (last tool with no result yet).
 */
export function isToolExecuting(
  toolId: string,
  lastToolUseId: string | null,
  toolResultsMap: Map<string, ToolResult>,
  isStreaming: boolean
): boolean {
  if (!isStreaming) return false;
  if (toolResultsMap.has(toolId)) return false;
  return toolId === lastToolUseId;
}

/**
 * Extract tracked tasks from messages (TaskCreate/TaskUpdate tool calls + results).
 * Builds a consolidated task list by scanning tool_use blocks and matching results.
 */
export interface StreamTrackedTask {
  id: string;           // toolUseId
  taskId?: string;      // actual numeric taskId from result
  subject: string;
  status: 'pending' | 'in_progress' | 'completed' | 'deleted';
  owner?: string;
  activeForm?: string;
}

export function buildTrackedTasksFromMessages(messages: ClaudeOutput[]): StreamTrackedTask[] {
  const tasks = new Map<string, StreamTrackedTask>();      // toolUseId → task
  const taskIdToToolId = new Map<string, string>();         // actual taskId → toolUseId

  // Build a tool results map for looking up TaskCreate results
  const resultsMap = buildToolResultsMap(messages);

  // Collect all tool_use entries (both formats: inside assistant messages AND top-level)
  interface ToolEntry { id: string; name: string; input: Record<string, unknown> }
  const toolUses: ToolEntry[] = [];

  for (const msg of messages) {
    // Format 1: assistant message with tool_use blocks in content
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use' && block.id && block.name) {
          toolUses.push({ id: block.id, name: block.name, input: (block.input || {}) as Record<string, unknown> });
        }
      }
    }
    // Format 2: top-level tool_use message
    if (msg.type === 'tool_use' && msg.id && msg.tool_name) {
      toolUses.push({ id: msg.id, name: msg.tool_name, input: (msg.tool_data || {}) as Record<string, unknown> });
    }
  }

  // Pass 1: Find all TaskCreate calls
  for (const tool of toolUses) {
    if (tool.name !== 'TaskCreate') continue;
    const input = tool.input;
    const toolUseId = tool.id;

    tasks.set(toolUseId, {
      id: toolUseId,
      subject: (input.subject as string) || 'Untitled task',
      status: 'pending',
      activeForm: input.activeForm as string | undefined,
    });

    // Check if we have a result with the actual taskId
    const result = resultsMap.get(toolUseId);
    if (result?.result) {
      // Try JSON format: {"taskId": "5", "status": "pending"}
      try {
        const parsed = JSON.parse(result.result);
        if (parsed.taskId) {
          taskIdToToolId.set(String(parsed.taskId), toolUseId);
          tasks.get(toolUseId)!.taskId = String(parsed.taskId);
        }
        if (parsed.status) {
          tasks.get(toolUseId)!.status = parsed.status;
        }
      } catch {
        // Try text format: "Task #5 created successfully: ..."
        const match = result.result.match(/Task\s*#(\d+)/i) ||
                      result.result.match(/taskId["\s:]+(\d+)/);
        if (match) {
          taskIdToToolId.set(match[1], toolUseId);
          tasks.get(toolUseId)!.taskId = match[1];
        }
      }
    }
  }

  // Pass 2: Apply TaskUpdate calls
  for (const tool of toolUses) {
    if (tool.name !== 'TaskUpdate') continue;
    const input = tool.input;
    if (!input.taskId) continue;

    const targetTaskId = String(input.taskId);
    // Resolve: could be an actual taskId or a toolUseId
    const toolUseId = taskIdToToolId.get(targetTaskId) || targetTaskId;
    const task = tasks.get(toolUseId);

    if (task) {
      if (input.status) task.status = input.status as StreamTrackedTask['status'];
      if (input.owner) task.owner = input.owner as string;
      if (input.subject) task.subject = input.subject as string;
      if (input.activeForm) task.activeForm = input.activeForm as string;
    }
  }

  return Array.from(tasks.values());
}

/** Check if a MIME type represents an image. */
export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/** Format a timestamp for display (time-only for today, date+time otherwise). */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}
