import { NextResponse } from 'next/server';
import { autopilotManager } from '@/lib/autopilot';

// GET /api/autopilot/status
export async function GET() {
  try {
    return NextResponse.json(autopilotManager.getStatus());
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
