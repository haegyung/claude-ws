import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { agentManager } from '@/lib/agent-manager';
import { sessionManager } from '@/lib/session-manager';
import { createAttemptService } from '@agentic-sdk/services/attempt/attempt-crud-and-logs';
import { createForceCreateService } from '@agentic-sdk/services/force-create-project-and-task';
import { createProjectService } from '@agentic-sdk/services/project/project-crud';
import { createTaskService } from '@agentic-sdk/services/task/task-crud-and-reorder';
import { createAttemptOrchestrator, AttemptValidationError } from '@agentic-sdk/services/attempt/attempt-creation-orchestrator';
import { setupProjectDefaults } from '@/lib/project-utils';

function getOrchestrator() {
  return createAttemptOrchestrator({
    taskService: createTaskService(db),
    projectService: createProjectService(db),
    attemptService: createAttemptService(db),
    forceCreateService: createForceCreateService(db),
    sessionManager,
    startAgent: (params) => agentManager.start(params),
    defaultBasePath: process.env.CLAUDE_WS_USER_CWD || /* turbopackIgnore: true */ process.cwd(),
    onProjectForceCreated: async (project, input) => {
      const shouldUseHookTemplate = typeof input?.use_hook_template === 'boolean' ? input.use_hook_template : true;
      await setupProjectDefaults(project.path, project.id, process.cwd(), { useHookTemplate: shouldUseHookTemplate });
    },
  });
}

// POST /api/attempts - Create a new attempt and start agent execution
export async function POST(request: NextRequest) {
  try {
    const result = await getOrchestrator().createAndRun(await request.json());

    if (result.type === 'file') {
      return new NextResponse(result.content, { headers: { 'Content-Type': result.contentType } });
    }
    return NextResponse.json(result.data, { status: result.statusCode });
  } catch (error: any) {
    if (error instanceof AttemptValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Failed to create attempt:', error);
    return NextResponse.json({ error: 'Failed to create attempt' }, { status: 500 });
  }
}
