/**
 * Re-export from agentic-sdk shared module, with type bridge for claude-ws ClaudeOutput.
 * Consumers import from './sdk-event-adapter' — this shim keeps those imports working.
 */

import {
  adaptSDKMessage as _adaptSDKMessage,
  type AdaptedMessage as _AdaptedMessage,
} from '../../packages/agentic-sdk/src/agent/claude-sdk-message-to-output-adapter';
import type { ClaudeOutput } from '../types';

// Re-export SDK types directly
export type {
  MCPServerStatus,
  SDKSystemMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKStreamEvent,
  SDKContentBlock,
  SDKMessage,
  UsageEvent,
} from '../../packages/agentic-sdk/src/agent/claude-sdk-message-to-output-adapter';

export { isValidSDKMessage } from '../../packages/agentic-sdk/src/agent/claude-sdk-message-to-output-adapter';

// Re-export BackgroundShellInfo from its canonical location
export type { BackgroundShellInfo } from '../../packages/agentic-sdk/src/agent/agent-start-options-and-event-types';

// Bridge AdaptedMessage to use claude-ws's ClaudeOutput type
export interface AdaptedMessage extends Omit<_AdaptedMessage, 'output'> {
  output: ClaudeOutput;
}

/** Wraps agentic-sdk adapter, casting output to claude-ws ClaudeOutput type */
export function adaptSDKMessage(message: Parameters<typeof _adaptSDKMessage>[0]): AdaptedMessage {
  return _adaptSDKMessage(message) as unknown as AdaptedMessage;
}
