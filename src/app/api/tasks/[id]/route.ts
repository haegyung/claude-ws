import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { rm } from 'fs/promises';
import { join } from 'path';
import { UPLOADS_DIR } from '@/lib/file-utils';
import type { TaskStatus } from '@/types';
import { createLogger } from '@/lib/logger';
import { createTaskService } from '@agentic-sdk/services/task/task-crud-and-reorder';

const log = createLogger('TaskById');
const taskService = createTaskService(db);

// GET /api/tasks/[id] - Get a single task
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const task = await taskService.getById(id);

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(task);
  } catch (error) {
    log.error({ error }, 'Failed to fetch task');
    return NextResponse.json(
      { error: 'Failed to fetch task' },
      { status: 500 }
    );
  }
}

// PUT /api/tasks/[id] - Update a task
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, description, status, position, chatInit, lastModel, lastProvider } = body;

    if (!title && !description && !status && position === undefined && chatInit === undefined && lastModel === undefined && lastProvider === undefined) {
      return NextResponse.json(
        { error: 'At least one field is required' },
        { status: 400 }
      );
    }

    // Validate status if provided
    const validStatuses: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'cancelled'];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status value' },
        { status: 400 }
      );
    }

    // Check existence first
    const existing = await taskService.getById(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    const updateData: any = {};

    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (status !== undefined) updateData.status = status;
    if (position !== undefined) updateData.position = position;
    if (chatInit !== undefined) updateData.chatInit = chatInit ? 1 : 0;
    if (lastModel !== undefined) updateData.lastModel = lastModel;
    if (lastProvider !== undefined) {
      if (!['claude-cli', 'claude-sdk'].includes(lastProvider)) {
        return NextResponse.json({ error: 'Invalid lastProvider value' }, { status: 400 });
      }
      updateData.lastProvider = lastProvider;
    }

    const updatedTask = await taskService.update(id, updateData);

    return NextResponse.json(updatedTask);
  } catch (error) {
    log.error({ error }, 'Failed to update task');
    return NextResponse.json(
      { error: 'Failed to update task' },
      { status: 500 }
    );
  }
}

// PATCH /api/tasks/[id] - Partial update a task (alias for PUT)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return PUT(request, { params });
}

// DELETE /api/tasks/[id] - Delete a task and its uploaded files
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check existence first
    const existing = await taskService.getById(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    // Fetch attempts to clean up upload directories before DB cascade
    const attempts = await taskService.getAttempts(id);

    // Delete physical upload files for each attempt
    for (const attempt of attempts) {
      const attemptDir = join(UPLOADS_DIR, attempt.id);
      try {
        await rm(attemptDir, { recursive: true, force: true });
      } catch {
        // Directory may not exist if no files were uploaded
      }
    }

    await taskService.remove(id);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    log.error({ error }, 'Failed to delete task');
    return NextResponse.json(
      { error: 'Failed to delete task' },
      { status: 500 }
    );
  }
}
