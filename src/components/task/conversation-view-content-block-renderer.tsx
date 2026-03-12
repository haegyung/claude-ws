'use client';

import { MessageBlock } from '@/components/claude/message-block';
import { ToolUseBlock } from '@/components/claude/tool-use-block';
import { isToolExecuting } from './conversation-view-utils';
import type { ClaudeOutput, ClaudeContentBlock } from '@/types';
import type { ToolResult } from './conversation-view-utils';

interface RenderContentBlockOptions {
  block: ClaudeContentBlock;
  index: number;
  lastToolUseId: string | null;
  toolResultsMap: Map<string, ToolResult>;
  isStreaming: boolean;
  allBlocks?: ClaudeContentBlock[];
  onOpenQuestion?: () => void;
}

/**
 * Renders a single content block (text, thinking, or tool_use) from an assistant message.
 */
export function renderContentBlock({
  block,
  index,
  lastToolUseId,
  toolResultsMap,
  isStreaming,
  allBlocks,
  onOpenQuestion,
}: RenderContentBlockOptions): React.ReactNode {
  if (block.type === 'text' && block.text) {
    return <MessageBlock key={index} content={block.text} isStreaming={isStreaming} />;
  }

  if (block.type === 'thinking' && block.thinking) {
    const hasLaterBlocks = allBlocks
      ? allBlocks.slice(index + 1).some(b => b.type === 'tool_use' || (b.type === 'text' && b.text))
      : false;
    const isThinkingActive = isStreaming && !hasLaterBlocks;
    return <MessageBlock key={index} content={block.thinking} isThinking isStreaming={isThinkingActive} />;
  }

  if (block.type === 'tool_use') {
    const toolId = block.id || '';
    const toolResult = toolResultsMap.get(toolId);
    const executing = isToolExecuting(toolId, lastToolUseId, toolResultsMap, isStreaming);
    return (
      <ToolUseBlock
        key={toolId || index}
        name={block.name || 'Unknown'}
        input={block.input}
        result={toolResult?.result}
        isError={toolResult?.isError}
        isStreaming={executing}
        onOpenPanel={block.name === 'AskUserQuestion' ? onOpenQuestion : undefined}
      />
    );
  }

  return null;
}

interface RenderMessageOptions {
  output: ClaudeOutput;
  index: number;
  isStreaming: boolean;
  toolResultsMap: Map<string, ToolResult>;
  lastToolUseId: string | null;
  onOpenQuestion?: () => void;
}

/**
 * Renders a single ClaudeOutput (assistant blocks, top-level tool_use).
 * Skips tool_result / stream_event / user types (matched via toolResultsMap).
 */
export function renderMessage({
  output,
  index,
  isStreaming,
  toolResultsMap,
  lastToolUseId,
  onOpenQuestion,
}: RenderMessageOptions): React.ReactNode {
  if (output.type === 'assistant' && output.message?.content) {
    const blocks = output.message.content;
    return (
      <div key={(output as any)._msgId || index} className="space-y-1 w-full max-w-full overflow-hidden">
        {blocks.map((block, blockIndex) =>
          renderContentBlock({ block, index: blockIndex, lastToolUseId, toolResultsMap, isStreaming, allBlocks: blocks, onOpenQuestion })
        )}
      </div>
    );
  }

  if (output.type === 'tool_use') {
    const toolId = output.id || '';
    const toolResult = toolResultsMap.get(toolId);
    const isExecuting = isToolExecuting(toolId, lastToolUseId, toolResultsMap, isStreaming);
    return (
      <ToolUseBlock
        key={(output as any)._msgId || toolId || index}
        name={output.tool_name || 'Unknown'}
        input={output.tool_data}
        result={toolResult?.result}
        isError={toolResult?.isError}
        isStreaming={isExecuting}
        onOpenPanel={output.tool_name === 'AskUserQuestion' ? onOpenQuestion : undefined}
      />
    );
  }

  return null;
}
