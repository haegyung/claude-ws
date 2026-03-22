import { NextRequest, NextResponse } from 'next/server';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { db } from '@/lib/db';
import { verifyApiKey, unauthorizedResponse } from '@/lib/api-auth';
import { createAgentFactoryService } from '@agentic-sdk/services/agent-factory/agent-factory-plugin-registry';
import { createProjectService } from '@agentic-sdk/services/project/project-crud';
import { createLogger } from '@/lib/logger';

const log = createLogger('AgentFactoryProjectSyncAPI');
const agentFactoryService = createAgentFactoryService(db);
const projectService = createProjectService(db);

type SyncRequestBody = {
  componentIds?: string[];
  agentSetIds?: string[];
};

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))];
}

async function upsertProjectSettings(
  projectPath: string,
  selectedComponents: string[],
  selectedAgentSets: string[]
): Promise<void> {
  const claudeDir = join(projectPath, '.claude');
  const settingsPath = join(claudeDir, 'project-settings.json');
  await mkdir(claudeDir, { recursive: true });

  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(settingsPath, 'utf-8');
    existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    existing = {};
  }

  const next = {
    ...existing,
    selectedComponents,
    selectedAgentSets,
  };

  await writeFile(settingsPath, JSON.stringify(next, null, 2), 'utf-8');
}

// POST /api/agent-factory/projects/[projectId]/sync - Install components to project
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    log.info(
      {
        method: request.method,
        path: request.nextUrl.pathname,
        query: request.nextUrl.search,
        projectId,
      },
      'Sync project request received'
    );

    if (!verifyApiKey(request)) {
      log.warn(
        {
          method: request.method,
          path: request.nextUrl.pathname,
          projectId,
        },
        'Unauthorized sync project request'
      );
      return unauthorizedResponse();
    }

    const project = await projectService.getById(projectId);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    let parsedBody: unknown = {};
    try {
      parsedBody = await request.json();
    } catch (error) {
      log.warn({ err: error, projectId }, 'Failed to parse sync request JSON body');
    }

    const body = (parsedBody ?? {}) as SyncRequestBody;
    const componentIds = normalizeIds(body.componentIds);
    const agentSetIds = normalizeIds(body.agentSetIds);
    log.info(
      {
        projectId,
        body,
        componentIds,
        agentSetIds,
      },
      'Sync project request payload'
    );

    if (componentIds.length > 0 || agentSetIds.length > 0) {
      await upsertProjectSettings(project.path, componentIds, agentSetIds);
    }

    const result = await agentFactoryService.syncProject(projectId, project.path);

    if (!result.success && result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: `Installed ${result.installed?.length ?? 0} components to project`,
      installed: result.installed ?? [],
      skipped: result.skipped ?? [],
      errors: result.errors ?? [],
    });
  } catch (error) {
    log.error({ err: error }, 'Error installing components');
    return NextResponse.json({ error: 'Failed to install components' }, { status: 500 });
  }
}
