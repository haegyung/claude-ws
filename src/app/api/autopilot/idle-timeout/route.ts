import { NextRequest, NextResponse } from 'next/server';
import { autopilotManager } from '@/lib/autopilot';
import { db, schema } from '@/lib/db';

// PUT /api/autopilot/idle-timeout — update idle timeout setting
export async function PUT(request: NextRequest) {
  try {
    const { seconds } = await request.json();

    if (typeof seconds !== 'number' || seconds < 10 || seconds > 600) {
      return NextResponse.json(
        { error: 'seconds must be a number between 10 and 600' },
        { status: 400 },
      );
    }

    await autopilotManager.setIdleTimeout(db, schema, seconds);

    return NextResponse.json({
      ...autopilotManager.getStatus(),
      idleTimeoutSeconds: seconds,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
