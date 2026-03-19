import { NextResponse } from 'next/server';
import { autopilotManager } from '@/lib/autopilot';
import { db, schema } from '@/lib/db';
import { createAutopilotService } from '@agentic-sdk/services/autopilot/autopilot-toggle-and-status';

// POST /api/autopilot/toggle
export async function POST() {
  try {
    const deps = autopilotManager.getDeps();
    if (!deps) {
      return NextResponse.json(
        { error: 'Autopilot not initialized yet' },
        { status: 503 },
      );
    }

    const service = createAutopilotService(autopilotManager, {
      db, schema, ...deps,
    });

    const status = await service.toggle();
    return NextResponse.json(status);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
