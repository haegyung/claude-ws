'use client';

import { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import type { SubagentNode, AgentMessage } from '@/lib/workflow-tracker';
import type { WorkflowEntry } from '@/stores/workflow-store';
import { formatDuration, formatTimestamp } from '@/lib/workflow-format-utils';

interface ChatEvent {
  type: 'message' | 'agent-start' | 'agent-end';
  timestamp: number;
  message?: AgentMessage;
  node?: SubagentNode;
}

function buildTimeline(entries: WorkflowEntry[]): ChatEvent[] {
  const events: ChatEvent[] = [];

  for (const entry of entries) {
    // Agent lifecycle events
    for (const node of entry.nodes) {
      if (node.startedAt) {
        events.push({ type: 'agent-start', timestamp: node.startedAt, node });
      }
      if (node.completedAt) {
        events.push({ type: 'agent-end', timestamp: node.completedAt, node });
      }
    }

    // Messages
    for (const msg of entry.messages) {
      events.push({ type: 'message', timestamp: msg.timestamp, message: msg });
    }
  }

  return events.sort((a, b) => a.timestamp - b.timestamp);
}

interface TeamChatTabProps {
  workflows: Map<string, WorkflowEntry>;
}

export function TeamChatTab({ workflows }: TeamChatTabProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const entries = Array.from(workflows.values());
  const timeline = buildTimeline(entries);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timeline.length]);

  if (timeline.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">No activity yet</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-1.5">
        {timeline.map((event, idx) => (
          <ChatEventItem key={idx} event={event} />
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}

function ChatEventItem({ event }: { event: ChatEvent }) {
  if (event.type === 'agent-start' && event.node) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70 py-0.5">
        <span className="text-[10px] shrink-0">{formatTimestamp(event.timestamp)}</span>
        <span className="text-blue-500">&#9679;</span>
        <span>
          <span className="font-medium text-foreground/70">{event.node.name || event.node.type}</span>
          {' '}started
          {event.node.type && event.node.name && (
            <span className="text-muted-foreground/50"> ({event.node.type})</span>
          )}
        </span>
      </div>
    );
  }

  if (event.type === 'agent-end' && event.node) {
    const isSuccess = event.node.status === 'completed';
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70 py-0.5">
        <span className="text-[10px] shrink-0">{formatTimestamp(event.timestamp)}</span>
        <span className={isSuccess ? 'text-green-500' : 'text-red-500'}>
          {isSuccess ? '\u2713' : '\u2717'}
        </span>
        <span>
          <span className="font-medium text-foreground/70">{event.node.name || event.node.type}</span>
          {' '}{isSuccess ? 'completed' : 'failed'}
          {event.node.durationMs && (
            <span className="text-muted-foreground/50"> ({formatDuration(event.node.durationMs)})</span>
          )}
        </span>
      </div>
    );
  }

  if (event.type === 'message' && event.message) {
    const msg = event.message;
    return (
      <div className="py-1">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 mb-0.5">
          <span className="text-[10px] shrink-0">{formatTimestamp(msg.timestamp)}</span>
          <span className="font-medium text-foreground/80">{msg.fromAgent || msg.fromType}</span>
          {msg.isBroadcast && (
            <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5">BROADCAST</Badge>
          )}
          <span>&rarr;</span>
          <span className="font-medium text-foreground/80">{msg.toType}</span>
        </div>
        <div className="ml-12 text-xs text-foreground/90 whitespace-pre-wrap break-words">
          {msg.content || msg.summary}
        </div>
      </div>
    );
  }

  return null;
}
