import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { poolProjects } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { verifyApiKey, unauthorizedResponse } from '@/lib/api-auth';
import { createLogger } from '@/lib/logger';

const log = createLogger('AdminAPI-Dashboard');

/**
 * GET /api/admin/dashboard - Get dashboard summary
 */
export async function GET(request: NextRequest) {
  // Check authentication
  if (!verifyApiKey(request)) {
    return unauthorizedResponse();
  }

  try {
    // Get recent projects (active ones)
    const recentProjects = await db.query.poolProjects.findMany({
      where: eq(poolProjects.status, 'allocated'),
      orderBy: [desc(poolProjects.createdAt)],
      limit: 10,
    });

    // Get pool status
    const containers = await db.query.containerPool.findMany();
    const idle = containers.filter(c => c.status === 'idle').length;
    const allocated = containers.filter(c => c.status === 'allocated').length;
    const stopping = containers.filter(c => c.status === 'stopping').length;
    const stopped = containers.filter(c => c.status === 'stopped').length;

    const poolStatus = {
      total: idle + allocated + stopping + stopped,
      idle,
      allocated,
      stopping,
      stopped,
    };

    return NextResponse.json({
      projects: recentProjects,
      pool_status: poolStatus,
    });
  } catch (error) {
    log.error('Failed to get dashboard data:', String(error));
    return NextResponse.json({ error: 'Failed to get dashboard data' }, { status: 500 });
  }
}
