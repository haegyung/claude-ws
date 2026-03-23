import { NextRequest, NextResponse } from 'next/server';
import { readFile, access } from 'fs/promises';
import path from 'path';
import { db } from '@/lib/db';
import { getMimeType } from '@/lib/file-utils';
import { createUploadService } from '@agentic-sdk/services/attempt/attempt-file-upload-storage';
import { findUploadedFile } from '@agentic-sdk/services/upload/tmp-file-processor-and-cleanup';

function getUploadsDir() {
  return path.join(
    process.env.DATA_DIR || path.join(process.env.CLAUDE_WS_USER_CWD || /* turbopackIgnore: true */ process.cwd(), 'data'),
    'uploads'
  );
}

function getUploadService() {
  return createUploadService(db, getUploadsDir());
}

// GET /api/uploads/[fileId] - Serve uploaded file by record ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params;

    const uploadsDir = getUploadsDir();
    const uploadService = getUploadService();

    const record = await uploadService.getById(fileId);
    if (!record) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Resolve file path from DB filename (may include attemptId subdirectory)
    let filePath = path.join(uploadsDir, record.filename);

    // Fallback: if file not found at stored path, scan attempt directories by fileId
    try {
      await access(filePath);
    } catch {
      const found = await findUploadedFile(uploadsDir, fileId);
      if (!found) {
        return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
      }
      filePath = found.path;
    }

    const buffer = await readFile(filePath);
    const mimeType = record.mimeType || getMimeType(record.filename);

    return new Response(buffer, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `inline; filename="${record.originalName}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Failed to serve file:', error);
    return NextResponse.json({ error: 'Failed to serve file' }, { status: 500 });
  }
}

// DELETE /api/uploads/[fileId] - Delete an uploaded file record and its file
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params;
    const uploadService = getUploadService();

    const record = await uploadService.getById(fileId);
    if (!record) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    await uploadService.remove(fileId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete file:', error);
    return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 });
  }
}
