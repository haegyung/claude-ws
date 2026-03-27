import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { mkdir } from 'fs/promises';
import { createLogger } from '@/lib/logger';
import { createProjectService } from '@agentic-sdk/services/project/project-crud';
import { setupProjectDefaults } from '@/lib/project-utils';

const log = createLogger('Projects');
const projectService = createProjectService(db);

// GET /api/projects - List all projects
export async function GET() {
  try {
    const projects = await projectService.list();

    return NextResponse.json(projects);
  } catch (error) {
    log.error({ error }, 'Failed to fetch projects');
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

// POST /api/projects - Create a new project
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, path } = body;

    if (!name || !path) {
      return NextResponse.json(
        { error: 'Name and path are required' },
        { status: 400 }
      );
    }

    // Create the project folder
    try {
      await mkdir(path, { recursive: true });
    } catch (mkdirError: any) {
      // If folder already exists, that's okay (might be opening existing project)
      if (mkdirError?.code !== 'EEXIST') {
        log.error({ error: mkdirError }, 'Failed to create project folder');
        return NextResponse.json(
          { error: 'Failed to create project folder: ' + mkdirError.message },
          { status: 500 }
        );
      }
    }

    const newProject = await projectService.create({ name, path });
    try {
      await setupProjectDefaults(path, newProject.id);
    } catch (setupError) {
      log.warn({ error: setupError, projectId: newProject.id }, 'Project created but template setup failed');
    }

    return NextResponse.json(newProject, { status: 201 });
  } catch (error: any) {
    log.error({ error }, 'Failed to create project');

    // Handle unique constraint violation (duplicate path)
    if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return NextResponse.json(
        { error: 'A project with this path already exists' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create project' },
      { status: 500 }
    );
  }
}
