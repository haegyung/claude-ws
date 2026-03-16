'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { SubagentNode } from '@/lib/workflow-tracker';
import type { WorkflowEntry } from '@/stores/workflow-store';
import { formatDuration } from '@/lib/workflow-format-utils';
import { AgentStatusIcon } from './workflow-status-indicators';

interface TeamTreeSidebarProps {
  workflows: Map<string, WorkflowEntry>;
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
}

export function TeamTreeSidebar({ workflows, selectedAgentId, onSelectAgent }: TeamTreeSidebarProps) {
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set());

  const toggleTeam = (teamName: string) => {
    setCollapsedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamName)) {
        next.delete(teamName);
      } else {
        next.add(teamName);
      }
      return next;
    });
  };

  const entries = Array.from(workflows.values());

  return (
    <div className="w-52 border-r border-border flex-shrink-0 overflow-y-auto">
      <div className="px-3 py-2 border-b border-border/50">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agents</h3>
      </div>
      <div className="py-1">
        {entries.map((entry) => {
          // Group nodes by team
          const teamGroups = new Map<string, SubagentNode[]>();
          const ungrouped: SubagentNode[] = [];

          for (const node of entry.nodes) {
            if (node.teamName) {
              const group = teamGroups.get(node.teamName) || [];
              group.push(node);
              teamGroups.set(node.teamName, group);
            } else {
              ungrouped.push(node);
            }
          }

          return (
            <div key={entry.attemptId} className={entries.length > 1 ? 'border-b border-border/50 pb-1 mb-1' : ''}>
              {/* Task title for concurrent teams */}
              {entries.length > 1 && entry.taskTitle && (
                <div className="px-3 py-1 text-[10px] text-muted-foreground/60 truncate">
                  {entry.taskTitle}
                </div>
              )}
              {/* Team groups */}
              {Array.from(teamGroups.entries()).map(([teamName, nodes]) => {
                const isCollapsed = collapsedTeams.has(teamName);
                const activeCount = nodes.filter((n) => n.status === 'in_progress').length;

                return (
                  <div key={teamName}>
                    <button
                      onClick={() => toggleTeam(teamName)}
                      className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs hover:bg-accent/50 transition-colors"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="size-3 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="size-3 text-muted-foreground" />
                      )}
                      <Users className="size-3 text-muted-foreground" />
                      <span className="font-medium text-foreground truncate">{teamName}</span>
                      {activeCount > 0 && (
                        <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-auto">
                          {activeCount}
                        </Badge>
                      )}
                    </button>
                    {!isCollapsed &&
                      nodes.map((node) => (
                        <AgentTreeNode
                          key={node.id}
                          node={node}
                          isSelected={selectedAgentId === node.id}
                          onSelect={() => onSelectAgent(node.id)}
                          indent={1}
                        />
                      ))}
                  </div>
                );
              })}

              {/* Ungrouped agents */}
              {ungrouped.map((node) => (
                <AgentTreeNode
                  key={node.id}
                  node={node}
                  isSelected={selectedAgentId === node.id}
                  onSelect={() => onSelectAgent(node.id)}
                  indent={0}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgentTreeNode({
  node,
  isSelected,
  onSelect,
  indent,
}: {
  node: SubagentNode;
  isSelected: boolean;
  onSelect: () => void;
  indent: number;
}) {
  const displayName = node.name || node.type;
  const typeLabel = node.name && node.type !== node.name ? node.type : null;

  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-1.5 px-3 py-1 text-xs transition-colors',
        isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/30',
      )}
      style={{ paddingLeft: `${12 + indent * 16}px` }}
    >
      <AgentStatusIcon status={node.status} />
      <span className="truncate">{displayName}</span>
      {typeLabel && (
        <span className="text-muted-foreground/60 text-[10px] truncate">({typeLabel})</span>
      )}
      {/* Error badge */}
      {node.status === 'failed' && (
        <span className="size-2 rounded-full bg-red-500 shrink-0" title="Failed" />
      )}
      <span className="text-muted-foreground/50 text-[10px] ml-auto shrink-0">
        {node.status === 'in_progress'
          ? 'running'
          : node.durationMs
            ? formatDuration(node.durationMs)
            : ''}
      </span>
    </button>
  );
}
