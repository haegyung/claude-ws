/**
 * Agent Workflow Message Tracker - Parse raw SDK/CLI messages to track subagent workflow events
 *
 * Extracted from agent-event-wiring.ts. Processes assistant/user message blocks to track
 * Task/Agent tool subagent starts/ends, TeamCreate events, SendMessage events,
 * TaskCreate/TaskUpdate events, and Bash BGPID patterns.
 */

import { workflowTracker } from './workflow-tracker';
import { isServerCommand } from './agent-output-handler';
import type { EventWiringContext } from './agent-event-wiring';

/**
 * Track workflow from raw SDK/CLI messages (subagent starts/ends, team creation, Bash commands).
 */
export function trackWorkflowFromMessage(
  ctx: EventWiringContext,
  attemptId: string,
  message: unknown
): void {
  const msg = message as {
    type: string;
    message?: { content: Array<{ type: string; id?: string; name?: string; input?: unknown }> };
    parent_tool_use_id?: string | null;
  };

  if (msg.type === 'assistant' && msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === 'tool_use' && (block.name === 'Task' || block.name === 'Agent') && block.id) {
        const taskInput = (block as { input?: { subagent_type?: string; model?: string; team_name?: string; name?: string; prompt?: string; description?: string } }).input;
        workflowTracker.trackSubagentStart(
          attemptId, block.id, taskInput?.subagent_type || taskInput?.model || 'agent',
          msg.parent_tool_use_id || null,
          { teamName: taskInput?.team_name, name: taskInput?.name, prompt: taskInput?.prompt || taskInput?.description },
        );
      }
      if (block.type === 'tool_use' && block.name === 'TeamCreate' && block.id) {
        const teamInput = (block as { input?: { team_name?: string } }).input;
        if (teamInput?.team_name) workflowTracker.trackTeamCreate(attemptId, teamInput.team_name);
      }
      if (block.type === 'tool_use' && block.name === 'SendMessage' && block.id) {
        const msgInput = (block as { input?: { type?: string; to?: string; recipient?: string; content?: string; message?: string | object; summary?: string } }).input;
        if (msgInput) {
          // Best-effort sender inference: find most recent active agent
          const workflow = workflowTracker.getWorkflow(attemptId);
          let inferredSender: string | undefined;
          if (workflow) {
            const activeNodes = workflow.activeNodes
              .map(id => workflow.nodes.get(id))
              .filter(Boolean)
              .sort((a, b) => (b!.startedAt || 0) - (a!.startedAt || 0));
            inferredSender = activeNodes[0]?.name || activeNodes[0]?.type;
          }
          const messageContent = typeof msgInput.message === 'string' ? msgInput.message : (msgInput.content || '');
          workflowTracker.trackMessage(attemptId, {
            ...msgInput,
            content: messageContent,
            fromAgent: inferredSender,
            isBroadcast: msgInput.to === '*',
          });
        }
      }
      if (block.type === 'tool_use' && block.name === 'TaskCreate' && block.id) {
        const tcInput = (block as { input?: { subject?: string; description?: string; activeForm?: string } }).input;
        if (tcInput) workflowTracker.trackTaskCreate(attemptId, block.id, tcInput);
      }
      if (block.type === 'tool_use' && block.name === 'TaskUpdate' && block.id) {
        const tuInput = (block as { input?: { taskId?: string; status?: string; owner?: string; subject?: string; activeForm?: string } }).input;
        if (tuInput) workflowTracker.trackTaskUpdate(attemptId, tuInput);
      }
      // Track Bash tool_uses for BGPID correlation
      if (block.type === 'tool_use' && block.name === 'Bash' && block.id) {
        const bashInput = block.input as { command?: string } | undefined;
        const toolId = block.id;
        if (bashInput?.command) {
          ctx.pendingBashCommands.set(toolId, { command: bashInput.command, attemptId });
          setTimeout(() => ctx.pendingBashCommands.delete(toolId), 5 * 60 * 1000);
        }
      }
    }
  }

  if (msg.type === 'user' && msg.message?.content) {
    const userContent = msg.message.content as Array<{
      type: string;
      tool_use_id?: string;
      is_error?: boolean;
      content?: string | unknown[];
    }>;

    for (const block of userContent) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        // Extract result content for Task tool results
        let resultContent = '';
        if (typeof block.content === 'string') {
          resultContent = block.content;
        } else if (Array.isArray(block.content)) {
          resultContent = (block.content as Array<{ text?: string }>)
            .filter(c => c && typeof c === 'object' && 'text' in c)
            .map(c => c.text || '').join('');
        }

        // Register actual taskId from TaskCreate results (toolUseId → numeric taskId mapping)
        {
          const workflow = workflowTracker.getWorkflow(attemptId);
          if (workflow) {
            const isTaskCreate = workflow.tasks.some((t) => t.id === block.tool_use_id);
            if (isTaskCreate && resultContent) {
              try {
                const parsed = JSON.parse(resultContent);
                if (parsed.taskId) {
                  workflowTracker.registerTaskId(attemptId, block.tool_use_id!, String(parsed.taskId));
                }
              } catch {
                // Text format: "Task #5 created successfully: ..."
                const match = resultContent.match(/Task\s*#(\d+)/i) ||
                              resultContent.match(/taskId["\s:]+(\d+)/);
                if (match) {
                  workflowTracker.registerTaskId(attemptId, block.tool_use_id!, match[1]);
                }
              }
            }
          }
        }

        // Extract the meaningful agent output from result, stripping SDK boilerplate
        let cleanResult = resultContent;
        const agentIdIdx = resultContent.indexOf('agentId:');
        const usageIdx = resultContent.indexOf('<usage>');
        if (agentIdIdx > 0 || usageIdx > 0) {
          const cutoff = Math.min(
            agentIdIdx > 0 ? agentIdIdx : Infinity,
            usageIdx > 0 ? usageIdx : Infinity,
          );
          cleanResult = resultContent.slice(0, cutoff).trim();
        }
        // Strip "Spawned successfully..." preamble for foreground agents that returned real content
        const pipeIdx = cleanResult.indexOf('|');
        if (pipeIdx > 0 && cleanResult.includes('Spawned successfully')) {
          cleanResult = cleanResult.slice(pipeIdx + 1).trim();
        } else if (cleanResult.startsWith('Spawned successfully')) {
          // Background agent - no real content yet
          cleanResult = '';
        }

        workflowTracker.trackSubagentEnd(
          attemptId, block.tool_use_id, !block.is_error,
          block.is_error ? resultContent : undefined,
          cleanResult || resultContent,
        );

        // Detect BGPID pattern
        let content = '';
        if (typeof block.content === 'string') {
          content = block.content;
        } else if (Array.isArray(block.content)) {
          content = (block.content as Array<{ text?: string }>)
            .filter(c => c && typeof c === 'object' && 'text' in c)
            .map(c => c.text || '').join('');
        }

        const bgpidMatch = content.match(/BGPID:(\d+)/);
        const emptyBgpidMatch = content.match(/BGPID:\s*$/m) || content.trim() === 'BGPID:';

        if (bgpidMatch && block.tool_use_id) {
          const pid = parseInt(bgpidMatch[1], 10);
          const bashInfo = ctx.pendingBashCommands.get(block.tool_use_id);
          const command = bashInfo?.command || `Background process (PID: ${pid})`;
          const logMatch = command.match(/>\s*([^\s]+\.log)/);
          ctx.emit('trackedProcess', { attemptId, pid, command, logFile: logMatch?.[1] });
          ctx.pendingBashCommands.delete(block.tool_use_id);
        } else if (emptyBgpidMatch && block.tool_use_id) {
          const bashInfo = ctx.pendingBashCommands.get(block.tool_use_id);
          if (bashInfo?.command && isServerCommand(bashInfo.command)) {
            const nohupMatch = bashInfo.command.match(/nohup\s+(.+?)\s*>\s*\/tmp\//);
            if (nohupMatch) {
              ctx.emit('backgroundShell', {
                attemptId,
                shell: {
                  toolUseId: block.tool_use_id,
                  command: nohupMatch[1].trim(),
                  description: 'Auto-spawned from empty BGPID',
                  originalCommand: bashInfo.command,
                },
              });
            }
          }
          ctx.pendingBashCommands.delete(block.tool_use_id);
        }
      }
    }
  }
}
