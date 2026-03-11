/**
 * Claude SDK message-to-output adapter — normalizes SDK stream messages to internal ClaudeOutput format.
 * Handles system, assistant, user, result, and stream_event message types.
 * Detects AskUserQuestion tool use and background shell (run_in_background=true).
 */

import { createLogger } from '../lib/pino-logger';
import type { BackgroundShellInfo } from './agent-start-options-and-event-types';

const log = createLogger('SDKAdapter');

// --- SDK message types ---

export interface MCPServerStatus {
  name: string;
  status: 'connected' | 'failed' | 'connecting';
  error?: string;
  tools?: string[];
}

export interface SDKSystemMessage {
  type: 'system';
  subtype: 'init' | string;
  session_id?: string;
  tools?: unknown[];
  mcp_servers?: MCPServerStatus[];
}

export interface SDKAssistantMessage {
  type: 'assistant';
  message: {
    id?: string;
    role: 'assistant';
    content: SDKContentBlock[];
    model?: string;
    stop_reason?: string;
    usage?: { input_tokens: number; output_tokens: number };
  };
}

export interface SDKUserMessage {
  type: 'user';
  message: { role: 'user'; content: SDKContentBlock[] };
  uuid?: string; // Checkpoint UUID (when replay-user-messages enabled)
}

export interface SDKResultMessage {
  type: 'result';
  subtype: string;
  session_id?: string;
  cost_usd?: number;
  is_error?: boolean;
  duration_ms?: number;
  num_turns?: number;
}

export interface SDKStreamEvent {
  type: 'stream_event';
  event: {
    type: string;
    index?: number;
    delta?: {
      type: 'text_delta' | 'thinking_delta' | 'input_json_delta';
      text?: string;
      thinking?: string;
    };
  };
}

export interface SDKContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | unknown[];
  is_error?: boolean;
}

export type SDKMessage =
  | SDKSystemMessage
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKResultMessage
  | SDKStreamEvent
  | { type: string; [key: string]: unknown };

export interface ClaudeOutput {
  type: string;
  [key: string]: unknown;
}

export interface AdaptedMessage {
  output: ClaudeOutput;
  sessionId?: string;
  checkpointUuid?: string;
  askUserQuestion?: { toolUseId: string; questions: unknown[] };
  backgroundShell?: BackgroundShellInfo;
}

// --- Type guard ---

export function isValidSDKMessage(msg: unknown): msg is SDKMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  if (!('type' in msg)) return false;
  return typeof (msg as { type: unknown }).type === 'string';
}

// --- Internal helpers ---

function detectAskUserQuestion(
  content: SDKContentBlock[]
): { toolUseId: string; questions: unknown[] } | undefined {
  for (const block of content) {
    if (block.type === 'tool_use' && block.name === 'AskUserQuestion') {
      return {
        toolUseId: block.id || '',
        questions: (block.input as { questions?: unknown[] })?.questions || [],
      };
    }
  }
  return undefined;
}

function detectBackgroundShell(content: SDKContentBlock[]): BackgroundShellInfo | undefined {
  // Method 1: Bash tool_use with run_in_background=true
  for (const block of content) {
    if (block.type === 'tool_use' && block.name === 'Bash') {
      const input = block.input as { command?: string; run_in_background?: boolean; description?: string } | undefined;
      if (input?.run_in_background === true && input?.command) {
        log.info({ commandPreview: input.command.substring(0, 50) }, 'Background shell detected via run_in_background=true');
        return { toolUseId: block.id || '', command: input.command, description: input.description };
      }
    }
  }
  // Method 2: Markdown ```background-shell``` code block
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      const match = block.text.match(/```background-shell\n([\s\S]+?)\n```/);
      if (match) {
        const command = match[1].trim();
        if (command) {
          return { toolUseId: `bg-shell-${Date.now()}`, command, description: 'Background shell from markdown block' };
        }
      }
    }
  }
  return undefined;
}

// --- Main adapter ---

export function adaptSDKMessage(message: SDKMessage): AdaptedMessage {
  const result: AdaptedMessage = { output: { type: message.type } };

  switch (message.type) {
    case 'system': {
      const sys = message as SDKSystemMessage;
      result.output = { type: 'system', subtype: sys.subtype, session_id: sys.session_id };
      if (sys.subtype === 'init' && sys.session_id) result.sessionId = sys.session_id;
      if (sys.subtype === 'init' && sys.mcp_servers) {
        for (const s of sys.mcp_servers) {
          if (s.status === 'connected') log.info({ name: s.name }, `MCP connected: ${s.name}`);
          else if (s.status === 'failed') log.error({ name: s.name, error: s.error }, `MCP failed: ${s.name}`);
        }
      }
      break;
    }
    case 'assistant': {
      const asst = message as SDKAssistantMessage;
      result.output = {
        type: 'assistant',
        message: { role: 'assistant', content: asst.message.content },
      };
      const askQ = detectAskUserQuestion(asst.message.content);
      if (askQ) result.askUserQuestion = askQ;
      const bgShell = detectBackgroundShell(asst.message.content);
      if (bgShell) result.backgroundShell = bgShell;
      break;
    }
    case 'user': {
      const user = message as SDKUserMessage;
      result.output = { type: 'user', message: { role: 'user', content: user.message.content } };
      if (user.uuid) result.checkpointUuid = user.uuid;
      break;
    }
    case 'result': {
      const res = message as SDKResultMessage;
      result.output = { type: 'result', subtype: res.subtype, session_id: res.session_id, is_error: res.is_error };
      if (res.session_id) result.sessionId = res.session_id;
      break;
    }
    case 'stream_event': {
      const stream = message as SDKStreamEvent;
      const event = stream.event;
      if (event.type === 'content_block_delta' && event.delta) {
        if (event.delta.type === 'text_delta' && event.delta.text) {
          result.output = { type: 'content_block_delta', index: event.index, delta: { type: 'text_delta', text: event.delta.text } };
        } else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
          result.output = { type: 'content_block_delta', index: event.index, delta: { type: 'thinking_delta', thinking: event.delta.thinking } };
        }
      }
      break;
    }
    default:
      result.output = { type: message.type };
  }

  return result;
}
