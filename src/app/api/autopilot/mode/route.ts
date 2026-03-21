import { NextRequest, NextResponse } from 'next/server';
import { autopilotManager } from '@/lib/autopilot';
import { db, schema } from '@/lib/db';

const VALID_MODES = ['off', 'fully-autonomous', 'auto-resume'] as const;

// POST /api/autopilot/mode — set autopilot mode
export async function POST(request: NextRequest) {
  try {
    const { mode } = await request.json();

    if (!VALID_MODES.includes(mode)) {
      return NextResponse.json(
        { error: `Invalid mode. Must be one of: ${VALID_MODES.join(', ')}` },
        { status: 400 },
      );
    }

    const wasOff = !autopilotManager.isEnabled();
    await autopilotManager.setMode(db, schema, mode);

    // If switching from off to enabled, trigger planning for projects with todo tasks
    if (wasOff && mode !== 'off') {
      const deps = autopilotManager.getDeps();
      if (deps) {
        const projects = await db.select().from(schema.projects);
        for (const project of projects) {
          const { eq, and } = await import('drizzle-orm');
          const todoTasks = await db
            .select()
            .from(schema.tasks)
            .where(and(eq(schema.tasks.projectId, project.id), eq(schema.tasks.status, 'todo')))
            .limit(1);

          if (todoTasks.length > 0) {
            autopilotManager.planAndReorder(project.id, {
              db, schema, ...deps,
            });
          }
        }
      }
    }

    return NextResponse.json(autopilotManager.getStatus());
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
