import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';

import { db } from '@/lib/db';
import { poolProjects, poolProjectActivityLog } from '@/lib/db/schema';
import { containerPoolManager } from '@/lib/container-pool-manager';
import { verifyApiKey, unauthorizedResponse } from '@/lib/api-auth';
import { createLogger } from '@/lib/logger';

const log = createLogger('AdminAPI');

/**
 * GET /api/admin/projects - List all projects with pool status
 */
export async function GET(request: NextRequest) {
  // Check authentication
  if (!verifyApiKey(request)) {
    return unauthorizedResponse();
  }

  try {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search');

    const offset = (page - 1) * limit;

    // Build conditions
    const conditions: SQL[] = [];
    if (status) {
      conditions.push(eq(poolProjects.status, status));
    }
    if (search) {
      conditions.push(sql`${poolProjects.name} LIKE ${`%${search}%`} OR ${poolProjects.description} LIKE ${`%${search}%`}`);
    }

    // Get projects
    const allProjects = await db.query.poolProjects.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [desc(poolProjects.createdAt)],
    });

    // Apply pagination
    const projectList = allProjects.slice(offset, offset + limit);
    const totalCount = allProjects.length;

    const totalPages = Math.ceil(totalCount / limit);
    const poolStatus = await getPoolStatus();

    return NextResponse.json({
      projects: projectList,
      pagination: {
        page,
        limit,
        total: totalCount,
        total_pages: totalPages,
      },
      pool_status: poolStatus,
    });
  } catch (error) {
    log.error('Failed to list projects:', String(error));
    return NextResponse.json({ error: 'Failed to list projects' }, { status: 500 });
  }
}

/**
 * POST /api/admin/projects - Create new project and allocate container
 */
export async function POST(request: NextRequest) {
  // Check authentication
  if (!verifyApiKey(request)) {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const { name, description, config } = body;

    // Validate
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
    }

    // Check pool availability
    const poolStatus = await getPoolStatus();
    if (poolStatus.idle === 0) {
      return NextResponse.json({ error: 'No containers available in pool', pool_status: poolStatus }, { status: 409 });
    }

    // Create project record
    const projectId = nanoid();
    const now = new Date();
    const projectData = {
      id: projectId,
      name,
      description: description || null,
      idleTimeoutSeconds: config?.idle_timeout_seconds || 86400,
      memoryLimit: config?.memory_limit || null,
      cpuLimit: config?.cpu_limit || null,
      dataPath: '/app/data/pending',
      status: 'starting',
      createdAt: now,
      lastActivityAt: now,
    };

    await db.insert(poolProjects).values(projectData);

    let allocation: Awaited<ReturnType<typeof containerPoolManager.allocateContainer>>;
    try {
      // Allocate container + initialize project in container
      allocation = await containerPoolManager.allocateContainer(projectId, name);
    } catch (allocationError) {
      await db.delete(poolProjects).where(eq(poolProjects.id, projectId));
      throw allocationError;
    }

    // Log activity
    await db.insert(poolProjectActivityLog).values({
      id: nanoid(),
      projectId,
      containerId: allocation.container_id,
      action: 'created',
      details: JSON.stringify({ ...projectData, ...allocation }),
      timestamp: now,
      performedBy: 'admin',
      performedAt: now,
    });

    return NextResponse.json({
      id: projectId,
      name,
      description,
      container_id: allocation.container_id,
      container_port: allocation.port,
      status: 'allocated',
      access_url: allocation.access_url,
      created_at: now.toISOString(),
    });
  } catch (error) {
    log.error('Failed to create project:', String(error));
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create project' }, { status: 500 });
  }
}

async function getPoolStatus() {
  const containers = await db.query.containerPool.findMany();

  const idle = containers.filter(c => c.status === 'idle').length;
  const allocated = containers.filter(c => c.status === 'allocated').length;
  const stopping = containers.filter(c => c.status === 'stopping').length;
  const stopped = containers.filter(c => c.status === 'stopped').length;

  return {
    total: idle + allocated + stopping + stopped,
    idle,
    allocated,
    stopping,
    stopped,
  };
}
