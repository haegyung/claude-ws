import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { setupProjectDefaults } from '@/lib/project-utils';
import { enqueueProjectPushSync } from '@/lib/minio-push-queue';
import { unauthorizedResponse, verifyApiKey } from '@/lib/api-auth';
import { createLogger } from '@/lib/logger';
import { resolveApiHookUrl } from '@/lib/api-hook-url';
import { createProjectService, ProjectValidationError } from '@agentic-sdk/services/project/project-crud';

const log = createLogger('MinioPushSyncAPI');
const projectService = createProjectService(db);
export const runtime = 'nodejs';

function quoteEnvValue(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

async function syncProjectHookEnv(projectPath: string, apiHookUrl: string, apiHookApiKey?: string): Promise<void> {
  const hooksDir = join(projectPath, '.claude', 'hooks');
  const envPath = join(hooksDir, '.env');
  await mkdir(hooksDir, { recursive: true });

  let content = '';
  try {
    content = await readFile(envPath, 'utf-8');
  } catch {
    content = '';
  }

  const lines = content.length > 0 ? content.split(/\r?\n/) : [];
  const nextLineByKey: Record<string, string> = {
    API_HOOK_URL: `API_HOOK_URL=${quoteEnvValue(apiHookUrl)}`,
  };
  if (apiHookApiKey && apiHookApiKey.trim()) {
    nextLineByKey.API_HOOK_API_KEY = `API_HOOK_API_KEY=${quoteEnvValue(apiHookApiKey)}`;
  }
  const replaced = new Set<string>();

  const nextLines = lines.map((line) => {
    for (const [key, nextLine] of Object.entries(nextLineByKey)) {
      if (new RegExp(`^\\s*${key}\\s*=`).test(line)) {
        replaced.add(key);
        return nextLine;
      }
    }
    return line;
  });

  for (const [key, nextLine] of Object.entries(nextLineByKey)) {
    if (!replaced.has(key)) {
      if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== '') {
        nextLines.push(nextLine);
      } else if (nextLines.length === 0) {
        nextLines.push(nextLine);
      } else {
        nextLines[nextLines.length - 1] = nextLine;
      }
    }
  }

  await writeFile(envPath, `${nextLines.join('\n').replace(/\n*$/, '\n')}`, 'utf-8');
}

async function ensureProject(projectId: string): Promise<{ id: string; path: string; created: boolean }> {
  const existing = await projectService.getById(projectId);
  if (existing) {
    return { id: existing.id, path: existing.path, created: false };
  }

  const defaultBasePath = process.env.CLAUDE_WS_USER_CWD || process.cwd();
  const projectPath = join(defaultBasePath, 'data', 'projects', projectId);
  const project = await projectService.create({
    id: projectId,
    name: projectId,
    path: projectPath,
  });
  await setupProjectDefaults(project.path, project.id);
  return { id: project.id, path: project.path, created: true };
}

// POST /api/sync/minio/push - Enqueue MinIO push sync job by projectId
export async function POST(request: NextRequest) {
  try {
    if (!verifyApiKey(request)) return unauthorizedResponse();

    let body: { projectId?: string };
    try {
      body = (await request.json()) as { projectId?: string };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const projectId = body?.projectId?.trim();
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    const apiHookUrl = resolveApiHookUrl(undefined, request.nextUrl.hostname);
    if (!apiHookUrl) {
      return NextResponse.json({ error: 'API_HOOK_URL is not configured on server' }, { status: 500 });
    }

    const project = await ensureProject(projectId);
    await syncProjectHookEnv(project.path, apiHookUrl, process.env.API_HOOK_API_KEY?.trim());

    const enqueueResult = await enqueueProjectPushSync(project.path, project.id);

    return NextResponse.json(
      {
        success: true,
        accepted: true,
        message: 'MinIO push sync queued',
        projectId: enqueueResult.projectId,
        jobId: enqueueResult.jobId,
        projectPath: project.path,
        projectCreated: project.created,
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof ProjectValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    log.error({ err: error }, 'Failed to trigger MinIO push sync');
    return NextResponse.json({ error: 'Failed to trigger MinIO push sync' }, { status: 500 });
  }
}
