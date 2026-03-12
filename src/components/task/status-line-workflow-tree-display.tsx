'use client';

import { useState } from 'react';
import { Workflow } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDuration } from './status-line-format-utils';

interface SubagentNodeClient {
  id: string;
  type: string;
  name?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'orphaned';
  parentId: string | null;
  depth: number;
  teamName?: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  error?: string;
}

export interface WorkflowData {
  nodes: SubagentNodeClient[];
  messages: { fromType: string; toType: string; content: string; summary: string; timestamp: number }[];
  summary: {
    chain: string[];
    completedCount: number;
    activeCount: number;
    totalCount: number;
  };
}

interface StatusLineWorkflowTreeDisplayProps {
  workflow: WorkflowData;
}

/**
 * Collapsible subagent workflow tree showing agent count, status and durations.
 * Used inside StatusLine to display the orchestration chain.
 */
export function StatusLineWorkflowTreeDisplay({ workflow }: StatusLineWorkflowTreeDisplayProps) {
  const [expanded, setExpanded] = useState(false);

  if (workflow.summary.totalCount === 0) return null;

  return (
    <div className="flex flex-col">
      <div
        className="flex items-center gap-1.5 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <Workflow className="size-3.5" />
        <span className="font-medium">
          {expanded
            ? `▼ Workflow (${workflow.summary.totalCount} agents)`
            : `▶ Workflow: ${workflow.summary.totalCount} agents (${workflow.summary.completedCount} done${workflow.summary.activeCount > 0 ? `, ${workflow.summary.activeCount} running` : ''})`}
        </span>
      </div>
      {expanded && (
        <div className="mt-1 ml-5 font-mono">
          {workflow.nodes.map((node) => (
            <div
              key={node.id}
              className="flex items-center gap-2"
              style={{ paddingLeft: `${node.depth * 16}px` }}
            >
              <span className={cn(
                node.status === 'completed' && 'text-green-500',
                node.status === 'in_progress' && 'text-blue-500 animate-pulse',
                node.status === 'failed' && 'text-red-500',
                node.status === 'orphaned' && 'text-yellow-500'
              )}>
                {node.status === 'completed' && '✓'}
                {node.status === 'in_progress' && '●'}
                {node.status === 'failed' && '✗'}
                {node.status === 'orphaned' && '⊘'}
                {node.status === 'pending' && '○'}
              </span>
              <span className="font-medium">{node.name || node.type}</span>
              <span className="text-muted-foreground/70">
                {node.status === 'in_progress' && 'running...'}
                {node.status === 'completed' && node.durationMs != null && formatDuration(node.durationMs)}
                {node.status === 'failed' && 'failed'}
                {node.status === 'orphaned' && 'orphaned'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
