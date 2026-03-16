'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import type { SubagentNode } from '@/lib/workflow-tracker';
import { formatDuration } from '@/lib/workflow-format-utils';
import { AgentStatusBadge } from './workflow-status-indicators';

interface AgentDetailTabProps {
  agent: SubagentNode;
}

export function AgentDetailTab({ agent }: AgentDetailTabProps) {
  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Metadata header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{agent.name || agent.type}</h3>
            <AgentStatusBadge status={agent.status} />
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Type</span>
            <span className="text-foreground">{agent.type}</span>

            {agent.name && (
              <>
                <span>Name</span>
                <span className="text-foreground">{agent.name}</span>
              </>
            )}

            {agent.teamName && (
              <>
                <span>Team</span>
                <span className="text-foreground">{agent.teamName}</span>
              </>
            )}

            {agent.durationMs !== undefined && (
              <>
                <span>Duration</span>
                <span className="text-foreground">{formatDuration(agent.durationMs)}</span>
              </>
            )}
          </div>
        </div>

        {/* Prompt */}
        {agent.prompt && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-1.5">Prompt</h4>
            <div className="rounded border border-border bg-muted/30 p-3">
              <p className="text-xs whitespace-pre-wrap break-words">{agent.prompt}</p>
            </div>
          </div>
        )}

        {/* Error */}
        {agent.error && (
          <div>
            <h4 className="text-xs font-semibold text-red-500 mb-1.5">Error</h4>
            <div className="rounded border border-red-500/20 bg-red-500/5 p-3">
              <pre className="text-xs text-red-400 whitespace-pre-wrap break-words font-mono">
                {agent.error}
              </pre>
            </div>
          </div>
        )}

        {/* Full result */}
        {agent.resultFull && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-1.5">Result</h4>
            <div className="rounded border border-border bg-muted/20 p-3 max-h-[60vh] overflow-auto">
              <pre className="text-xs whitespace-pre-wrap break-words font-mono">
                {agent.resultFull}
              </pre>
            </div>
          </div>
        )}

        {/* Opaque background agent indicator */}
        {!agent.resultFull && !agent.error && agent.status === 'completed' && (
          <div className="rounded border border-border/50 bg-muted/10 p-3 text-center">
            <p className="text-xs text-muted-foreground/60 italic">
              This agent ran in the background. Internal activity (tool calls, messages) is not visible from the parent stream.
            </p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
