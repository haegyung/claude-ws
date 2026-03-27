import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { eq, desc } from 'drizzle-orm';

import { db } from '@/lib/db';
import { poolProjects, poolProjectActivityLog, containerPool } from '@/lib/db/schema';
import { containerPoolManager } from '@/lib/container-pool-manager';
import { verifyApiKey, unauthorizedResponse } from '@/lib/api-auth';
import { createLogger } from '@/lib/logger';

const log = createLogger('AdminAPI-ProjectDetail');

type Context = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/admin/projects/:id - Get project details
 */
export async function GET(request: NextRequest, context: Context) {
  // Check authentication
  if (!verifyApiKey(request)) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await context.params;

    const project = await db.query.poolProjects.findFirst({
      where: eq(poolProjects.id, id),
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get container info
    const container = project.containerId
      ? await db.query.containerPool.findFirst({
          where: eq(containerPool.containerId, project.containerId),
        })
      : null;

    // Get recent activity
    const activity = await db.query.poolProjectActivityLog.findMany({
      where: eq(poolProjectActivityLog.projectId, id),
      orderBy: [desc(poolProjectActivityLog.performedAt)],
      limit: 10,
    });

    return NextResponse.json({
      project: {
        ...project,
        access_url: container ? `/api/gateway/${id}` : null,
      },
      container,
      activity_log: activity,
    });
  } catch (error) {
    const params = await context.params;
    log.error(`Failed to get project ${(await params).id}:`, String(error));
    return NextResponse.json({ error: 'Failed to get project' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/projects/:id - Stop and delete project
 */
export async function DELETE(request: NextRequest, context: Context) {
  // Check authentication
  if (!verifyApiKey(request)) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await context.params;
    const body = await request.json();
    const { delete_data = false } = body;

    const project = await db.query.poolProjects.findFirst({
      where: eq(poolProjects.id, id),
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Release container back to pool
    if (project.containerId) {
      await containerPoolManager.releaseContainer(project.containerId, id, {
        returnToPool: true,
        clearData: false,
      });
    }

    // Delete project record
    await db.delete(poolProjects).where(eq(poolProjects.id, id));

    // Optionally delete data
    if (delete_data && project.dataPath) {
      const fs = await import('fs/promises');
      await fs.rm(project.dataPath, { recursive: true, force: true });
    }

    // Log activity (before deletion so we still have the project info)
    await db.insert(poolProjectActivityLog).values({
      id: nanoid(),
      projectId: id,
      action: 'deleted',
      details: JSON.stringify({ data_deleted: delete_data, data_path: project.dataPath }),
      timestamp: new Date(),
      performedBy: 'admin',
      performedAt: new Date(),
    });

    return NextResponse.json({
      project_id: id,
      deleted: true,
      data_deleted: delete_data,
      data_path: project.dataPath,
    });
  } catch (error) {
    const params = await context.params;
    log.error(`Failed to delete project ${(await params).id}:`, String(error));
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
  }
}

/**
 * POST /api/admin/projects/:id/stop - Stop project container
 */
export async function POST(request: NextRequest, context: Context) {
  // Check authentication
  if (!verifyApiKey(request)) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await context.params;
    const body = await request.json();
    const { reason = 'Manual stop by admin', return_to_pool = false } = body;

    const project = await db.query.poolProjects.findFirst({
      where: eq(poolProjects.id, id),
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (!project.containerId) {
      return NextResponse.json({ error: 'No container allocated to this project' }, { status: 400 });
    }

    // Stop container, and optionally return to pool
    await containerPoolManager.releaseContainer(project.containerId, id, {
      returnToPool: return_to_pool,
      clearData: false,
    });

    // Log activity
    await db.insert(poolProjectActivityLog).values({
      id: nanoid(),
      projectId: id,
      containerId: project.containerId,
      action: 'stopped',
      details: JSON.stringify({ reason, return_to_pool }),
      timestamp: new Date(),
      performedBy: 'admin',
      performedAt: new Date(),
    });

    return NextResponse.json({
      project_id: id,
      status: 'stopped',
      container_returned_to_pool: return_to_pool,
      data_preserved: true,
      stopped_at: new Date().toISOString(),
    });
  } catch (error) {
    const params = await context.params;
    log.error(`Failed to stop project ${(await params).id}:`, String(error));
    return NextResponse.json({ error: 'Failed to stop project' }, { status: 500 });
  }
}
