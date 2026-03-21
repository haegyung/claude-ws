/**
 * Workflow Tracker - Track subagent execution workflow with full tree support
 *
 * Monitors Task tool usage to build real-time workflow visualization:
 * Full agent tree with unlimited depth, team tracking, and inter-agent messages.
 */

import { EventEmitter } from 'events';
import { createLogger } from './logger';
import {
  buildWorkflowSummary,
  buildWorkflowTree,
  buildExpandedWorkflow,
} from './workflow-state-query-helpers';
import type {
  SubagentStatus,
  SubagentNode,
  AgentMessage,
  TrackedTask,
  WorkflowState,
  WorkflowSummary,
} from './workflow-tracker-types';

// Re-export types for consumers that import from workflow-tracker
export type { SubagentStatus, SubagentNode, AgentMessage, TrackedTask, WorkflowState, WorkflowSummary };

const log = createLogger('WorkflowTracker');

interface WorkflowTrackerEvents {
  'workflow-update': (data: { attemptId: string; workflow: WorkflowState }) => void;
  'workflow-cleared': (data: { attemptId: string }) => void;
  'subagent-start': (data: { attemptId: string; node: SubagentNode }) => void;
  'subagent-end': (data: { attemptId: string; node: SubagentNode }) => void;
}

/**
 * WorkflowTracker - Singleton to track subagent workflows
 */
class WorkflowTracker extends EventEmitter {
  private workflows = new Map<string, WorkflowState>();

  constructor() {
    super();
  }

  /** Initialize workflow for an attempt */
  initWorkflow(attemptId: string): WorkflowState {
    if (!this.workflows.has(attemptId)) {
      const workflow: WorkflowState = {
        attemptId,
        nodes: new Map(),
        rootNodes: [],
        activeNodes: [],
        completedNodes: [],
        failedNodes: [],
        messages: [],
        teams: [],
        tasks: [],
        taskIdMap: new Map(),
        mode: 'subagent',
      };
      this.workflows.set(attemptId, workflow);
    }
    return this.workflows.get(attemptId)!;
  }

  /** Track a subagent start (from Task tool use) */
  trackSubagentStart(
    attemptId: string,
    toolUseId: string,
    subagentType: string,
    parentToolUseId: string | null,
    options?: { teamName?: string; name?: string; prompt?: string }
  ): void {
    const workflow = this.initWorkflow(attemptId);

    let depth = 0;
    if (parentToolUseId && workflow.nodes.has(parentToolUseId)) {
      depth = workflow.nodes.get(parentToolUseId)!.depth + 1;
    }

    const node: SubagentNode = {
      id: toolUseId,
      type: subagentType,
      name: options?.name,
      status: 'in_progress',
      parentId: parentToolUseId,
      depth,
      teamName: options?.teamName,
      prompt: options?.prompt,
      startedAt: Date.now(),
    };

    workflow.nodes.set(toolUseId, node);
    if (depth === 0) workflow.rootNodes.push(toolUseId);
    workflow.activeNodes.push(toolUseId);

    this.emit('subagent-start', { attemptId, node });
    this.emit('workflow-update', { attemptId, workflow });
  }

  /** Track a subagent completion (from tool_result) */
  trackSubagentEnd(
    attemptId: string,
    toolUseId: string,
    success: boolean,
    error?: string,
    resultContent?: string
  ): void {
    const workflow = this.workflows.get(attemptId);
    if (!workflow) return;

    const node = workflow.nodes.get(toolUseId);
    if (!node) return;

    node.status = success ? 'completed' : 'failed';
    node.completedAt = Date.now();
    node.durationMs = node.startedAt ? Date.now() - node.startedAt : undefined;
    if (error) node.error = error;
    if (resultContent) {
      node.resultPreview = resultContent.slice(0, 200);
      node.resultFull = resultContent;
    }

    workflow.activeNodes = workflow.activeNodes.filter((id) => id !== toolUseId);
    if (success) {
      workflow.completedNodes.push(toolUseId);
    } else {
      workflow.failedNodes.push(toolUseId);
    }

    this.emit('subagent-end', { attemptId, node });
    this.emit('workflow-update', { attemptId, workflow });
  }

  /** Track a TeamCreate tool use */
  trackTeamCreate(attemptId: string, teamName: string): void {
    const workflow = this.initWorkflow(attemptId);
    if (!workflow.teams.includes(teamName)) {
      workflow.teams.push(teamName);
    }
    workflow.mode = 'agent-team';
    this.emit('workflow-update', { attemptId, workflow });
  }

  /** Track a SendMessage tool use */
  trackMessage(
    attemptId: string,
    input: { type?: string; recipient?: string; content?: string; summary?: string; to?: string; fromAgent?: string; isBroadcast?: boolean }
  ): void {
    const workflow = this.initWorkflow(attemptId);

    const message: AgentMessage = {
      fromType: input.fromAgent || 'agent',
      toType: input.to || input.recipient || input.type || 'unknown',
      content: typeof input.content === 'string' ? input.content : '',
      summary: input.summary || '',
      timestamp: Date.now(),
      fromAgent: input.fromAgent,
      isBroadcast: input.isBroadcast || input.to === '*',
    };

    workflow.messages.push(message);
    this.emit('workflow-update', { attemptId, workflow });
  }

  /**
   * Track a TaskCreate tool use
   */
  trackTaskCreate(
    attemptId: string,
    toolUseId: string,
    input: { subject?: string; description?: string; activeForm?: string }
  ): void {
    const workflow = this.initWorkflow(attemptId);

    const task: TrackedTask = {
      id: toolUseId,
      subject: input.subject || 'Untitled task',
      description: input.description,
      status: 'pending',
      activeForm: input.activeForm,
      updatedAt: Date.now(),
    };

    workflow.tasks.push(task);
    this.emit('workflow-update', { attemptId, workflow });
  }

  /**
   * Register mapping from TaskCreate result: actual taskId → toolUseId
   * Called when we see the tool_result for a TaskCreate call.
   */
  registerTaskId(attemptId: string, toolUseId: string, actualTaskId: string): void {
    const workflow = this.workflows.get(attemptId);
    if (!workflow) return;

    workflow.taskIdMap.set(actualTaskId, toolUseId);

    // Set the taskId field on the tracked task (keep id as toolUseId for DB consistency)
    const task = workflow.tasks.find((t) => t.id === toolUseId);
    if (task) {
      task.taskId = actualTaskId;
    }

    this.emit('workflow-update', { attemptId, workflow });
  }

  /**
   * Track a TaskUpdate tool use
   */
  trackTaskUpdate(
    attemptId: string,
    input: { taskId?: string; status?: string; owner?: string; subject?: string; activeForm?: string }
  ): void {
    const workflow = this.workflows.get(attemptId);
    if (!workflow || !input.taskId) return;

    // Look up by actual taskId (registered via registerTaskId), then fall back to id (toolUseId)
    const task = workflow.tasks.find((t) => t.taskId === input.taskId || t.id === input.taskId);
    if (task) {
      if (input.status) task.status = input.status as TrackedTask['status'];
      if (input.owner) task.owner = input.owner;
      if (input.subject) task.subject = input.subject;
      if (input.activeForm) task.activeForm = input.activeForm;
      task.updatedAt = Date.now();
    }

    this.emit('workflow-update', { attemptId, workflow });
  }

  /** Mark all in-progress subagents as orphaned (for disconnect cleanup) */
  markOrphaned(attemptId: string): SubagentNode[] {
    const workflow = this.workflows.get(attemptId);
    if (!workflow) return [];

    const orphaned: SubagentNode[] = [];
    for (const nodeId of workflow.activeNodes) {
      const node = workflow.nodes.get(nodeId);
      if (node) {
        node.status = 'orphaned';
        node.completedAt = Date.now();
        node.durationMs = node.startedAt ? Date.now() - node.startedAt : undefined;
        orphaned.push(node);
      }
    }
    workflow.activeNodes = [];
    return orphaned;
  }

  /** Get workflow state for an attempt */
  getWorkflow(attemptId: string): WorkflowState | undefined {
    return this.workflows.get(attemptId);
  }

  /** Get workflow summary (chain of root agent names + counts) */
  getWorkflowSummary(attemptId: string): WorkflowSummary | null {
    const workflow = this.workflows.get(attemptId);
    if (!workflow) return null;
    return buildWorkflowSummary(workflow);
  }

  /** Get full expanded workflow data for socket emission */
  getExpandedWorkflow(attemptId: string): {
    nodes: SubagentNode[];
    messages: AgentMessage[];
    tasks: TrackedTask[];
    mode: 'subagent' | 'agent-team';
    summary: WorkflowSummary;
  } | null {
    const workflow = this.workflows.get(attemptId);
    if (!workflow) return null;
    return buildExpandedWorkflow(workflow);
  }

  /** Get workflow tree sorted by depth then startedAt (for debugging/advanced UI) */
  getWorkflowTree(attemptId: string): SubagentNode[] {
    const workflow = this.workflows.get(attemptId);
    if (!workflow) return [];
    return buildWorkflowTree(workflow);
  }

  /** Clear workflow for an attempt */
  clearWorkflow(attemptId: string): void {
    this.workflows.delete(attemptId);
    this.emit('workflow-cleared', { attemptId });
  }

  override on<K extends keyof WorkflowTrackerEvents>(
    event: K,
    listener: WorkflowTrackerEvents[K]
  ): this {
    return super.on(event, listener);
  }

  override emit<K extends keyof WorkflowTrackerEvents>(
    event: K,
    ...args: Parameters<WorkflowTrackerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// Export singleton instance
export const workflowTracker = new WorkflowTracker();
