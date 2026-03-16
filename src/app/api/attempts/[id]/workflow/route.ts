import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { workflowTracker } from '@/lib/workflow-tracker';
import { verifyApiKey, unauthorizedResponse } from '@/lib/api-auth';
import { createAttemptWorkflowService } from '@agentic-sdk/services/attempts/workflow-tree';

const workflowService = createAttemptWorkflowService(db);

/**
 * GET /api/attempts/[id]/workflow
 *
 * Returns the workflow tree for an attempt.
 * - Running attempt: returns from workflowTracker in-memory state
 * - Completed attempt: returns from DB via SDK service
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: attemptId } = await params;

  // Try in-memory state first (for running attempts)
  const expanded = workflowTracker.getExpandedWorkflow(attemptId);
  if (expanded) {
    return NextResponse.json({
      source: 'live',
      nodes: expanded.nodes,
      messages: expanded.messages,
      tasks: expanded.tasks,
      mode: expanded.mode,
      summary: expanded.summary,
    });
  }

  // Fall back to DB (for completed attempts)
  const result = await workflowService.getWorkflowFromDb(attemptId);
  return NextResponse.json(result);
}

/**
 * DELETE /api/attempts/[id]/workflow
 *
 * Clears all agent session data (subagents, tasks, messages) for an attempt.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyApiKey(request)) return unauthorizedResponse();
  const { id: attemptId } = await params;

  // Clear in-memory state
  workflowTracker.clearWorkflow(attemptId);

  // Clear DB state
  await workflowService.deleteWorkflowData(attemptId);

  return NextResponse.json({ deleted: true, attemptId });
}
