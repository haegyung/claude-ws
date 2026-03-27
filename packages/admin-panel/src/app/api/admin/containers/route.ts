import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { containerPool, poolProjects } from '@/lib/db/schema';
import { verifyApiKey, unauthorizedResponse } from '@/lib/api-auth';
import { createLogger } from '@/lib/logger';

const log = createLogger('AdminAPI-Containers');

/**
 * GET /api/admin/containers - List active containers
 */
export async function GET(request: NextRequest) {
  if (!verifyApiKey(request)) {
    return unauthorizedResponse();
  }

  try {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get('status') || 'allocated';

    const containers = await db
      .select({
        id: containerPool.containerId,
        port: containerPool.containerPort,
        status: containerPool.status,
        projectId: containerPool.projectId,
        healthStatus: containerPool.healthStatus,
        createdAt: containerPool.createdAt,
        projectName: poolProjects.name,
      })
      .from(containerPool)
      .leftJoin(poolProjects, eq(containerPool.projectId, poolProjects.id))
      .where(eq(containerPool.status, status));

    return NextResponse.json({
      containers: containers.map(c => ({
        id: c.id,
        port: c.port,
        status: c.status,
        projectId: c.projectId,
        projectName: c.projectName,
        healthStatus: c.healthStatus,
        createdAt: c.createdAt,
      })),
    });
  } catch (error) {
    log.error('Failed to list containers:', String(error));
    return NextResponse.json({ error: 'Failed to list containers' }, { status: 500 });
  }
}