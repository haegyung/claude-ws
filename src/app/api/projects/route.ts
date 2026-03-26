import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createProjectService, ProjectValidationError } from '@agentic-sdk/services/project/project-crud';
import { setupProjectDefaults } from '@/lib/project-utils';

const projectService = createProjectService(db);

// GET /api/projects - List all projects
export async function GET() {
  try {
    return NextResponse.json(await projectService.list());
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }
}

// POST /api/projects - Create a new project
export async function POST(request: NextRequest) {
  try {
    const { id, name, path, projectId, useHookTemplate, use_hook_template } = await request.json();
    const project = await projectService.createProject({ id: projectId || id, name, path });
    const shouldUseHookTemplate = typeof useHookTemplate === 'boolean'
      ? useHookTemplate
      : typeof use_hook_template === 'boolean'
        ? use_hook_template
        : true;
    await setupProjectDefaults(project.path, project.id, process.cwd(), { useHookTemplate: shouldUseHookTemplate });
    return NextResponse.json(project, { status: 201 });
  } catch (error: any) {
    if (error instanceof ProjectValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
  }
}
