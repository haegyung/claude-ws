'use client';

import { useState, memo } from 'react';
import { ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { RunningDots } from '@/components/ui/running-dots';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfigProviderButton } from '@/components/auth/auth-error-message';
import { isProviderAuthError } from '@/components/auth/agent-provider-dialog';
import { getToolIcon, getToolActiveVerb, getToolDisplay, getResultSummary } from './tool-use-block-icon-verb-display-utils';
import { BashBlock } from './tool-use-block-bash-command-renderer';
import { TodoListBlock, type TodoItem } from './tool-use-block-todo-list-renderer';
import { EditBlock } from './tool-use-block-edit-diff-renderer';
import { AgentSpawnedCard } from './agent-spawned-card';

interface ToolUseBlockProps {
  name: string;
  id?: string;
  input?: unknown;
  result?: string;
  isError?: boolean;
  isStreaming?: boolean;
  className?: string;
  onOpenPanel?: () => void;
}

// Memoized ToolUseBlock - prevents unnecessary re-renders for completed tool calls
export const ToolUseBlock = memo(function ToolUseBlock({ name, id, input, result, isError, isStreaming, className, onOpenPanel }: ToolUseBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const Icon = getToolIcon(name);

  // Special rendering for Task (agent spawning) tool
  if (name === 'Task' || name === 'Agent') {
    const taskInput = input as { name?: string; subagent_type?: string; description?: string; prompt?: string } | null;
    const agentName = taskInput?.name || taskInput?.subagent_type || 'agent';
    const prompt = taskInput?.prompt || taskInput?.description || '';

    return (
      <div className={cn('w-full max-w-full', className)}>
        <AgentSpawnedCard
          agentName={agentName}
          agentType={taskInput?.subagent_type}
          prompt={prompt}
          result={result}
          isStreaming={isStreaming}
          isError={isError}
          toolUseId={id}
        />
      </div>
    );
  }
  const displayText = getToolDisplay(name, input);
  const activeVerb = getToolActiveVerb(name);
  const resultSummary = getResultSummary(name, result);
  const inputObj = input as Record<string, unknown> | null | undefined;

  // Determine if we have special display modes
  const isBash = name === 'Bash';
  const isEdit = name === 'Edit';
  const isTodoWrite = name === 'TodoWrite';
  const isAskUserQuestion = name === 'AskUserQuestion';
  const hasEditDiff = isEdit && Boolean(inputObj?.old_string) && Boolean(inputObj?.new_string);
  const hasTodos = isTodoWrite && Array.isArray(inputObj?.todos) && (inputObj.todos as TodoItem[]).length > 0;

  // For bash, edit with diff, and todo list, we show expanded content differently
  const showSpecialView = isBash || hasEditDiff || hasTodos;

  // For other tools, check if we have expandable details
  const hasOtherDetails = !showSpecialView && Boolean(result || (inputObj && Object.keys(inputObj).length > 1));

  // Completed tool with result - show in green like CLI
  const isCompleted = !isStreaming && result && !isError;

  // Show open button for AskUserQuestion when no result yet (waiting for user response)
  const showOpenButton = isAskUserQuestion && !result && onOpenPanel;

  return (
    <div className={cn('group w-full max-w-full overflow-hidden my-2', className)}>
      {/* Main status line */}
      <div
        className={cn(
          'flex items-start gap-2.5 py-1.5 px-2 rounded-md transition-colors min-w-0 w-full max-w-full border border-transparent',
          isStreaming ? 'text-foreground bg-accent/30 border-accent/20' : 'text-muted-foreground hover:bg-accent/20',
          hasOtherDetails && 'cursor-pointer'
        )}
        onClick={() => hasOtherDetails && setIsExpanded(!isExpanded)}
      >
        {/* Completed indicator or expand/collapse */}
        {isCompleted && !hasOtherDetails ? (
          <span className="shrink-0 mt-[7px] size-2 rounded-full bg-emerald-500/90 shadow-[0_0_4px_rgba(16,185,129,0.4)]" />
        ) : hasOtherDetails ? (
          isExpanded ? (
            <ChevronDown className="size-3.5 shrink-0 mt-1" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 mt-1" />
          )
        ) : null}

        {/* Streaming spinner or icon */}
        {isStreaming ? (
          <RunningDots className="shrink-0" />
        ) : isCompleted ? null : (
          <Icon className={cn('size-4 shrink-0', isError && 'text-destructive')} />
        )}

        {/* Tool name and target - allow wrapping */}
        <span className={cn('font-mono text-[13.5px] leading-6 min-w-0 flex-1', isError && 'text-destructive')}>
          {isStreaming || (isAskUserQuestion && !result && onOpenPanel) ? (
            <>
              {activeVerb} <span className="text-muted-foreground break-all">{displayText}</span>...
            </>
          ) : isCompleted ? (
            <>
              <span className="font-semibold text-foreground/90">{name}</span>
              <span className="text-muted-foreground mx-1">/</span>
              <span className="text-foreground/80 break-all">{displayText}</span>
              {resultSummary && (
                <span className="text-muted-foreground/60 text-xs ml-2">({resultSummary})</span>
              )}
            </>
          ) : (
            displayText
          )}
        </span>

        {/* Result summary for non-completed (streaming shows here) */}
        {resultSummary && !isStreaming && !isCompleted && (
          <span className="text-muted-foreground text-xs shrink-0 mt-1">
            ({resultSummary})
          </span>
        )}

        {/* Open button for AskUserQuestion during streaming */}
        {showOpenButton && (
          <Button
            size="sm"
            variant="secondary"
            onClick={onOpenPanel}
            className="shrink-0 h-6 px-2 text-xs"
          >
            Open
          </Button>
        )}

        {isError && <AlertCircle className="size-3.5 text-destructive shrink-0 mt-1" />}
        {isError && result && isProviderAuthError(result) && (
          <ConfigProviderButton className="ml-2 h-7 text-xs" />
        )}
      </div>

      {/* Special view for Bash */}
      {isBash && Boolean(inputObj?.command) && (
        <div className="mt-1.5 ml-5 w-full max-w-full overflow-hidden pr-5">
          <BashBlock
            command={String(inputObj?.command)}
            output={result}
            isError={isError}
          />
        </div>
      )}

      {/* Special view for Edit with diff */}
      {hasEditDiff && (
        <div className="mt-1.5 ml-5 w-full max-w-full overflow-hidden pr-5">
          <EditBlock input={inputObj} result={result} isError={isError} />
        </div>
      )}

      {/* Special view for TodoWrite */}
      {hasTodos && (
        <div className="mt-1.5 ml-5 w-full max-w-full overflow-hidden pr-5">
          <TodoListBlock todos={inputObj?.todos as TodoItem[]} />
        </div>
      )}

      {/* Standard expandable details for other tools */}
      {isExpanded && hasOtherDetails && (
        <div className="ml-5 mt-1 pl-4 border-l border-border/50 text-[13px] text-muted-foreground space-y-2 w-full max-w-full overflow-hidden pr-5">
          {inputObj && Object.keys(inputObj).length > 1 && (
            <pre className="font-mono bg-muted/30 p-2 rounded overflow-x-auto max-h-32 whitespace-pre-wrap break-all">
              {JSON.stringify(inputObj, null, 2)}
            </pre>
          )}
          {result && (
            <pre className={cn(
              'font-mono bg-muted/30 p-2 rounded overflow-x-auto max-h-40 whitespace-pre-wrap break-all',
              isError && 'text-destructive'
            )}>
              {result.length > 2000 ? result.slice(0, 2000) + '...' : result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
});
