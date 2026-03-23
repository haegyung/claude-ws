import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { db } from '@/lib/db';
import { createUploadService } from '@agentic-sdk/services/attempt/attempt-file-upload-storage';
import { saveTmpFiles } from '@agentic-sdk/services/upload/tmp-file-processor-and-cleanup';

function getUploadsDir() {
  return path.join(
    process.env.DATA_DIR || path.join(process.env.CLAUDE_WS_USER_CWD || /* turbopackIgnore: true */ process.cwd(), 'data'),
    'uploads'
  );
}

function getUploadService() {
  return createUploadService(db, getUploadsDir());
}

// GET /api/uploads?attemptId=xxx - List uploaded files for an attempt
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const attemptId = searchParams.get('attemptId');

    if (!attemptId) {
      return NextResponse.json({ error: 'attemptId required' }, { status: 400 });
    }

    const files = await getUploadService().list(attemptId);
    return NextResponse.json({ files });
  } catch (error) {
    console.error('Failed to list uploads:', error);
    return NextResponse.json({ error: 'Failed to list uploads' }, { status: 500 });
  }
}

// POST /api/uploads - Upload file(s), with or without attemptId
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const attemptId = formData.get('attemptId') as string | null;

    // Collect files from both 'file' and 'files' field names
    const files: File[] = [];
    const fileEntry = formData.get('file') as File | null;
    if (fileEntry) files.push(fileEntry);
    const filesEntries = formData.getAll('files') as File[];
    for (const f of filesEntries) {
      if (f && typeof f === 'object' && 'arrayBuffer' in f) files.push(f);
    }

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    // If attemptId is provided, use DB-backed upload service
    if (attemptId) {
      const file = files[0];
      const buffer = Buffer.from(await file.arrayBuffer());
      const record = await getUploadService().save(attemptId, {
        filename: file.name,
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
        buffer,
      });
      return NextResponse.json(record, { status: 201 });
    }

    // Otherwise: tmp upload mode
    const tmpFiles = await Promise.all(
      files.map(async (file) => ({
        buffer: Buffer.from(await file.arrayBuffer()),
        filename: file.name,
        mimetype: file.type || 'application/octet-stream',
      }))
    );
    const results = await saveTmpFiles(getUploadsDir(), tmpFiles);
    return NextResponse.json({ files: results }, { status: 201 });
  } catch (error: any) {
    if (error.message?.includes('size exceeds') || error.message?.includes('File too large')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Upload failed:', error);
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
  }
}
