import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { poolProjects, poolProjectActivityLog, containerPool } from '@/lib/db/schema';
import { containerPoolManager } from '@/lib/container-pool-manager';
import { verifyApiKey, unauthorizedResponse } from '@/lib/api-auth';
import { createLogger } from '@/lib/logger';

const log = createLogger('AdminAPI-ProjectStart');

type Context = {
  params: Promise<{ id: string }>;
};

/**
 * POST /api/admin/projects/:id/start - Start or restart project container
 */
export async function POST(request: NextRequest, context: Context) {
  if (!verifyApiKey(request)) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await context.params;

    const project = await db
      .select()
      .from(poolProjects)
      .where(eq(poolProjects.id, id))
      .limit(1)
      .then(rows => rows[0]);

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    let resultContainerId: string;
    let resultPort: number;

    // Case 1: Project has container but is stopped - restart it
    if (project.containerId && project.status !== 'allocated') {
      await containerPoolManager.ensureProjectContainerReady(id);
      resultContainerId = project.containerId;

      const container = await db
        .select()
        .from(containerPool)
        .where(eq(containerPool.containerId, project.containerId))
        .limit(1)
        .then(rows => rows[0]);
      resultPort = container?.containerPort || 0;
    }
    // Case 2: Project has no container - allocate new one
    else if (!project.containerId) {
      const allocation = await containerPoolManager.allocateContainer(id, project.name);
      resultContainerId = allocation.container_id;
      resultPort = allocation.port;
    }
    // Case 3: Already allocated - just return current state
    else {
      resultContainerId = project.containerId;
      resultPort = project.containerPort || 0;
    }

    // Get updated project state
    const updatedProject = await db
      .select()
      .from(poolProjects)
      .where(eq(poolProjects.id, id))
      .limit(1)
      .then(rows => rows[0]);

    // Log activity
    await db.insert(poolProjectActivityLog).values({
      id: nanoid(),
      projectId: id,
      containerId: resultContainerId,
      action: 'started',
      details: JSON.stringify({
        container_port: resultPort,
        previous_status: project.status
      }),
      timestamp: new Date(),
      performedBy: 'admin',
      performedAt: new Date(),
    });

    return NextResponse.json({
      project_id: id,
      status: 'allocated',
      container_id: resultContainerId,
      container_port: resultPort,
      access_url: `/api/gateway/${id}`,
      started_at: new Date().toISOString(),
    });
  } catch (error) {
    const params = await context.params;
    log.error(`Failed to start project ${(await params).id}:`, String(error));
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start project' },
      { status: 500 }
    );
  }
}