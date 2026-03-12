/**
 * Attachment Store Upload and Remove API Actions - File upload/delete HTTP actions for pending attachments
 *
 * Extracted from attachment-store.ts to keep the store file under 200 lines.
 * Contains: uploadFile helper, addFiles, removeFile, retryUpload logic.
 */

import { createLogger } from '@/lib/logger';
import type { PendingFile } from '@/types';

const log = createLogger('AttachmentStore');

interface AttachmentStoreSlice {
  pendingFilesByTask: Record<string, PendingFile[]>;
}

type SetFn = (
  updater:
    | ((s: AttachmentStoreSlice) => Partial<AttachmentStoreSlice>)
    | Partial<AttachmentStoreSlice>
) => void;
type GetFn = () => AttachmentStoreSlice & {
  getTotalSize: (taskId: string) => number;
};

const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB

// ── uploadFile (internal helper) ───────────────────────────────────────────

async function uploadFile(
  taskId: string,
  pendingFile: PendingFile,
  set: SetFn
): Promise<void> {
  if (!pendingFile.file) return;
  const localTempId = pendingFile.tempId;

  set((state) => ({
    pendingFilesByTask: {
      ...state.pendingFilesByTask,
      [taskId]: (state.pendingFilesByTask[taskId] || []).map((f) =>
        f.tempId === localTempId ? { ...f, status: 'uploading' as const } : f
      ),
    },
  }));

  try {
    const formData = new FormData();
    formData.append('files', pendingFile.file);
    const res = await fetch('/api/uploads', { method: 'POST', body: formData });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || `Upload failed: ${res.statusText}`);
    }

    const data = await res.json();
    const uploaded = data.files[0];

    set((state) => ({
      pendingFilesByTask: {
        ...state.pendingFilesByTask,
        [taskId]: (state.pendingFilesByTask[taskId] || []).map((f) =>
          f.tempId === localTempId
            ? { ...f, tempId: uploaded.tempId, status: 'uploaded' as const, file: undefined }
            : f
        ),
      },
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    set((state) => ({
      pendingFilesByTask: {
        ...state.pendingFilesByTask,
        [taskId]: (state.pendingFilesByTask[taskId] || []).map((f) =>
          f.tempId === localTempId
            ? { ...f, status: 'error' as const, error: message }
            : f
        ),
      },
    }));
  }
}

// ── addFiles ───────────────────────────────────────────────────────────────

export async function addFilesAction(
  taskId: string,
  files: File[],
  set: SetFn,
  get: GetFn
): Promise<void> {
  const currentTotal = get().getTotalSize(taskId);
  const newTotal = files.reduce((sum, f) => sum + f.size, 0);
  if (currentTotal + newTotal > MAX_TOTAL_SIZE) {
    throw new Error('Total file size exceeds 50MB limit');
  }

  const pending: PendingFile[] = files.map((file) => ({
    tempId: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    originalName: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    previewUrl: file.type?.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    status: 'pending' as const,
    file,
  }));

  set((state) => ({
    pendingFilesByTask: {
      ...state.pendingFilesByTask,
      [taskId]: [...(state.pendingFilesByTask[taskId] || []), ...pending],
    },
  }));

  for (const pendingFile of pending) {
    await uploadFile(taskId, pendingFile, set);
  }
}

// ── removeFile ─────────────────────────────────────────────────────────────

export async function removeFileAction(
  taskId: string,
  tempId: string,
  set: SetFn,
  get: GetFn
): Promise<void> {
  const files = get().pendingFilesByTask[taskId] || [];
  const file = files.find((f) => f.tempId === tempId);

  if (file) {
    if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
    if (file.status === 'uploaded' && !file.tempId.startsWith('local-')) {
      try {
        await fetch(`/api/uploads/${file.tempId}`, { method: 'DELETE' });
      } catch (e) {
        log.error({ error: e }, 'Failed to delete file from server');
      }
    }
  }

  set((state) => ({
    pendingFilesByTask: {
      ...state.pendingFilesByTask,
      [taskId]: (state.pendingFilesByTask[taskId] || []).filter((f) => f.tempId !== tempId),
    },
  }));
}

// ── retryUpload ────────────────────────────────────────────────────────────

export async function retryUploadAction(
  taskId: string,
  tempId: string,
  set: SetFn,
  get: GetFn
): Promise<void> {
  const files = get().pendingFilesByTask[taskId] || [];
  const file = files.find((f) => f.tempId === tempId);

  if (file?.file && file.status === 'error') {
    set((state) => ({
      pendingFilesByTask: {
        ...state.pendingFilesByTask,
        [taskId]: (state.pendingFilesByTask[taskId] || []).map((f) =>
          f.tempId === tempId ? { ...f, status: 'pending' as const, error: undefined } : f
        ),
      },
    }));
    await uploadFile(taskId, file, set);
  }
}
