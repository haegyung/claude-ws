import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { TaskStatus } from '@/types';
import { createTaskService } from '@agentic-sdk/services/task/task-crud-and-reorder';

const taskService = createTaskService(db);

// GET /api/tasks - List tasks
// Query params:
//   ?projectId=xxx - Single project (backward compat)
//   ?projectIds=id1,id2,id3 - Multiple projects
//   ?status=in_review - Filter by status (single or comma-separated)
//   No params - All tasks
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const projectId = searchParams.get('projectId');
    const projectIds = searchParams.get('projectIds');
    const statusParam = searchParams.get('status');

    const validStatuses: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'cancelled'];
    let statuses: string[] | undefined;
    if (statusParam) {
      statuses = statusParam.split(',').filter((s): s is TaskStatus => validStatuses.includes(s as TaskStatus));
      if (statuses.length === 0) statuses = undefined;
    }

    let projectIdsList: string[] | undefined;
    if (projectIds) {
      projectIdsList = projectIds.split(',').filter(Boolean);
      if (projectIdsList.length === 0) projectIdsList = undefined;
    }

    const tasks = await taskService.list({
      projectId: projectIdsList ? undefined : (projectId || undefined),
      projectIds: projectIdsList,
      statuses,
    });

    return NextResponse.json(tasks);
  } catch (error) {
    console.error('Failed to fetch tasks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tasks' },
      { status: 500 }
    );
  }
}

// POST /api/tasks - Create a new task
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, title, description, status, pendingFileIds } = body;

    if (!projectId || !title) {
      return NextResponse.json(
        { error: 'projectId and title are required' },
        { status: 400 }
      );
    }

    // Validate status if provided
    const validStatuses: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'cancelled'];
    const taskStatus: TaskStatus = status && validStatuses.includes(status) ? status : 'todo';

    const newTask = await taskService.create({
      projectId, title, description, status: taskStatus,
      pendingFileIds: pendingFileIds?.length ? JSON.stringify(pendingFileIds) : undefined,
    });

    return NextResponse.json(newTask, { status: 201 });
  } catch (error: any) {
    console.error('Failed to create task:', error);

    // Handle foreign key constraint (invalid projectId)
    if (error?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create task' },
      { status: 500 }
    );
  }
}
