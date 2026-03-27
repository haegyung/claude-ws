import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { containerPool } from '@/lib/db/schema';
import { containerPoolManager } from '@/lib/container-pool-manager';
import { verifyApiKey, unauthorizedResponse } from '@/lib/api-auth';
import { createLogger } from '@/lib/logger';

const log = createLogger('AdminAPI-ContainerLogs');

type Context = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/admin/containers/:id/logs - Get container logs
 */
export async function GET(request: NextRequest, context: Context) {
  if (!verifyApiKey(request)) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await context.params;
    const { searchParams } = request.nextUrl;

    const tail = parseInt(searchParams.get('tail') || '100');
    const timestamps = searchParams.get('timestamps') !== 'false';

    // Verify container exists
    const container = await db
      .select()
      .from(containerPool)
      .where(eq(containerPool.containerId, id))
      .limit(1)
      .then(rows => rows[0]);

    if (!container) {
      return NextResponse.json({ error: 'Container not found' }, { status: 404 });
    }

    // Only allow logs from allocated or idle containers
    if (container.status !== 'allocated' && container.status !== 'idle') {
      return NextResponse.json(
        { error: 'Container is not active' },
        { status: 400 }
      );
    }

    const logs = await containerPoolManager.getContainerLogs(id, {
      tail,
      timestamps,
    });

    return NextResponse.json({
      container_id: id,
      logs,
      fetched_at: new Date().toISOString(),
    });
  } catch (error) {
    const params = await context.params;
    log.error(`Failed to get logs for container ${(await params).id}:`, String(error));
    return NextResponse.json(
      { error: 'Failed to fetch logs' },
      { status: 500 }
    );
  }
}