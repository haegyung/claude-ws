'use client';

import { useState } from 'react';
import { Users, ChevronDown, ChevronRight, ExternalLink, AlertCircle } from 'lucide-react';
import { RunningDots } from '@/components/ui/running-dots';
import { Badge } from '@/components/ui/badge';
import { useWorkflowStore } from '@/stores/workflow-store';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/workflow-format-utils';

interface AgentSpawnedCardProps {
  agentName: string;
  agentType?: string;
  prompt: string;
  result?: string;
  resultPreview?: string;
  isStreaming?: boolean;
  isError?: boolean;
  toolUseId?: string;
}

export function AgentSpawnedCard({
  agentName,
  agentType,
  prompt,
  result,
  resultPreview,
  isStreaming,
  isError,
  toolUseId,
}: AgentSpawnedCardProps) {
  const [showFullResult, setShowFullResult] = useState(false);
  const { selectAgent, openPanel } = useWorkflowStore();

  const displayName = agentName || agentType || 'agent';
  const typeLabel = agentType && agentName && agentType !== agentName ? ` (${agentType})` : '';

  // Find matching node for duration info
  const node = useWorkflowStore((s) => {
    if (!toolUseId) return null;
    for (const entry of s.workflows.values()) {
      const found = entry.nodes.find((n) => n.id === toolUseId);
      if (found) return found;
    }
    return null;
  });

  const durationStr = node?.durationMs ? formatDuration(node.durationMs) : null;

  // Prefer the clean result from workflow tracker (boilerplate stripped)
  // Fall back to raw result, cleaning up SDK preamble client-side
  const cleanResult = node?.resultFull || node?.resultPreview || result || '';
  const isBackgroundOnly = cleanResult.startsWith('Spawned successfully') && !cleanResult.includes('|');
  const preview = isBackgroundOnly
    ? '' // Don't show "Spawned successfully" boilerplate as preview
    : (node?.resultPreview || resultPreview || (result ? result.slice(0, 200) : ''));

  const handleShowInPanel = () => {
    if (toolUseId) {
      selectAgent(toolUseId);
      openPanel();
    }
  };

  // Streaming state
  if (isStreaming) {
    return (
      <div className="my-2 rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <RunningDots className="shrink-0" />
          <Users className="size-3.5 text-blue-500 shrink-0" />
          <span className="text-sm font-mono">
            <span className="text-muted-foreground">&rarr; spawned</span>{' '}
            <span className="font-medium text-foreground">{displayName}</span>
            <span className="text-muted-foreground">{typeLabel}</span>
          </span>
        </div>
        {prompt && (
          <p className="mt-1.5 ml-9 text-xs text-muted-foreground/80 italic line-clamp-2">
            &quot;{prompt.slice(0, 150)}&quot;
          </p>
        )}
      </div>
    );
  }

  // Failed state
  if (isError) {
    return (
      <div className="my-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <AlertCircle className="size-3.5 text-red-500 shrink-0" />
          <span className="text-sm font-mono">
            <span className="font-semibold text-foreground/90">Task</span>
            <span className="text-muted-foreground mx-1">/</span>
            <span className="text-foreground/80">{displayName}</span>
            <span className="text-red-500 ml-1">failed</span>
            {durationStr && <span className="text-muted-foreground/60 text-xs ml-2">({durationStr})</span>}
          </span>
        </div>
        {preview && (
          <p className="mt-1.5 ml-6 text-xs text-red-400/80 font-mono line-clamp-3">
            {preview}
          </p>
        )}
      </div>
    );
  }

  // Completed state
  return (
    <div className="my-2 rounded-md border border-border px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="shrink-0 size-2 rounded-full bg-emerald-500/90 shadow-[0_0_4px_rgba(16,185,129,0.4)]" />
        <span className="text-sm font-mono">
          <span className="font-semibold text-foreground/90">Task</span>
          <span className="text-muted-foreground mx-1">/</span>
          <span className="text-foreground/80">{displayName}</span>
          <span className="text-muted-foreground/60 ml-1">completed</span>
          {durationStr && <span className="text-muted-foreground/60 text-xs ml-2">({durationStr})</span>}
        </span>
      </div>

      {isBackgroundOnly && (
        <p className="mt-1.5 ml-4 text-[10px] text-muted-foreground/50 italic">
          background agent — internal activity not visible
        </p>
      )}

      {preview && !isBackgroundOnly && (
        <p className="mt-1.5 ml-4 text-xs text-muted-foreground/80 font-mono line-clamp-2">
          &quot;{preview}{preview.length >= 200 ? '...' : ''}&quot;
        </p>
      )}

      <div className="mt-2 ml-4 flex items-center gap-3">
        {result && !isBackgroundOnly && (
          <button
            onClick={() => setShowFullResult(!showFullResult)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            {showFullResult ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            {showFullResult ? 'Hide result' : 'Show full result'}
          </button>
        )}
        {toolUseId && (
          <button
            onClick={handleShowInPanel}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <ExternalLink className="size-3" />
            View in team panel
          </button>
        )}
      </div>

      {showFullResult && result && (
        <div className="mt-2 ml-4 rounded border border-border/50 bg-muted/30 p-3 max-h-96 overflow-auto">
          <pre className="text-xs font-mono whitespace-pre-wrap break-words text-muted-foreground">
            {result}
          </pre>
        </div>
      )}
    </div>
  );
}
