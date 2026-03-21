/**
 * Workflow Tracker Types - Type definitions for subagent workflow tracking
 *
 * Extracted from workflow-tracker.ts. Shared by workflow-tracker.ts,
 * workflow-state-query-helpers.ts, and any consumers of workflow data.
 */

/** Subagent status */
export type SubagentStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'orphaned';

/** Subagent node in workflow tree */
export interface SubagentNode {
  id: string;           // tool_use_id from Task tool
  type: string;         // subagent_type
  name?: string;        // agent name (from Task tool input)
  status: SubagentStatus;
  parentId: string | null; // null for top-level
  depth: number;        // 0 for top-level, increments with nesting
  teamName?: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  error?: string;
  prompt?: string;      // description/prompt from Task tool input
  resultPreview?: string; // first ~200 chars of tool_result
  resultFull?: string;  // full tool_result content
}

/** Inter-agent message */
export interface AgentMessage {
  fromType: string;
  toType: string;
  content: string;
  summary: string;
  timestamp: number;
  fromAgent?: string;   // best-effort inferred agent name
  isBroadcast?: boolean; // true for broadcast messages
}

/** Tracked task from TaskCreate/TaskUpdate tool calls */
export interface TrackedTask {
  id: string;
  /** Actual numeric taskId from TaskCreate result (used by TaskUpdate for lookups) */
  taskId?: string;
  subject: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'deleted';
  owner?: string;
  activeForm?: string;
  updatedAt: number;
}

/** Workflow state for an attempt */
export interface WorkflowState {
  attemptId: string;
  nodes: Map<string, SubagentNode>;
  rootNodes: string[];
  activeNodes: string[];
  completedNodes: string[];
  failedNodes: string[];
  messages: AgentMessage[];
  teams: string[];
  tasks: TrackedTask[];
  /** Maps toolUseId → actual taskId (from TaskCreate result) for TaskUpdate lookups */
  taskIdMap: Map<string, string>;
  mode: 'subagent' | 'agent-team';
}

/** Workflow summary for status line and global events */
export interface WorkflowSummary {
  chain: string[];
  completedCount: number;
  activeCount: number;
  totalCount: number;
}
