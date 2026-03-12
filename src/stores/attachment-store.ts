import { create } from 'zustand';
import type { PendingFile } from '@/types';
import {
  addFilesAction,
  removeFileAction,
  retryUploadAction,
} from './attachment-store-upload-and-remove-api-actions';

interface AttachmentState {
  pendingFilesByTask: Record<string, PendingFile[]>;

  getPendingFiles: (taskId: string) => PendingFile[];
  addFiles: (taskId: string, files: File[]) => Promise<void>;
  removeFile: (taskId: string, tempId: string) => Promise<void>;
  clearFiles: (taskId: string) => void;
  retryUpload: (taskId: string, tempId: string) => Promise<void>;
  getTotalSize: (taskId: string) => number;
  getUploadedFileIds: (taskId: string) => string[];
  hasUploadingFiles: (taskId: string) => boolean;
  moveFiles: (fromTaskId: string, toTaskId: string) => void;
}

export const useAttachmentStore = create<AttachmentState>((set, get) => ({
  pendingFilesByTask: {},

  getPendingFiles: (taskId) => get().pendingFilesByTask[taskId] || [],

  getTotalSize: (taskId) => {
    const files = get().pendingFilesByTask[taskId] || [];
    return files.reduce((sum, f) => sum + f.size, 0);
  },

  getUploadedFileIds: (taskId) => {
    const files = get().pendingFilesByTask[taskId] || [];
    return files
      .filter((f) => f.status === 'uploaded' && !f.tempId.startsWith('local-'))
      .map((f) => f.tempId);
  },

  hasUploadingFiles: (taskId) => {
    const files = get().pendingFilesByTask[taskId] || [];
    return files.some((f) => f.status === 'uploading' || f.status === 'pending');
  },

  clearFiles: (taskId) =>
    set((state) => {
      // Note: intentionally skip revoking previewUrls — may still be in use during streaming
      const updated = { ...state.pendingFilesByTask };
      delete updated[taskId];
      return { pendingFilesByTask: updated };
    }),

  moveFiles: (fromTaskId, toTaskId) => {
    const files = get().pendingFilesByTask[fromTaskId] || [];
    if (files.length === 0) return;
    set((state) => {
      const updated = { ...state.pendingFilesByTask };
      updated[toTaskId] = [...(updated[toTaskId] || []), ...files];
      delete updated[fromTaskId];
      return { pendingFilesByTask: updated };
    });
  },

  // API actions — delegated to attachment-store-upload-and-remove-api-actions
  addFiles: (taskId, files) => addFilesAction(taskId, files, set, get),
  removeFile: (taskId, tempId) => removeFileAction(taskId, tempId, set, get),
  retryUpload: (taskId, tempId) => retryUploadAction(taskId, tempId, set, get),
}));
