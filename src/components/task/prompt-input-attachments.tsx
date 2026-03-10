'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { AttachmentBar } from './attachment-bar';
import { useAttachmentStore } from '@/stores/attachment-store';

// ─── Hook: attachment state & handlers ───

interface UsePromptAttachmentsOptions {
  taskId?: string;
}

export function usePromptAttachments({ taskId }: UsePromptAttachmentsOptions) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    getPendingFiles,
    addFiles,
    removeFile,
    clearFiles,
    retryUpload,
    getUploadedFileIds,
    hasUploadingFiles,
  } = useAttachmentStore();

  const pendingFiles = taskId ? getPendingFiles(taskId) : [];

  const handleFilesSelected = async (files: File[]) => {
    if (!taskId) return;
    try {
      await addFiles(taskId, files);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to upload files';
      toast.error(message);
    }
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  return {
    fileInputRef,
    pendingFiles,
    handleFilesSelected,
    openFilePicker,
    removeFile,
    retryUpload,
    clearFiles,
    getUploadedFileIds,
    hasUploadingFiles,
  };
}

// ─── Component: attachment bar + hidden file input + paperclip button ───

interface AttachmentBarSectionProps {
  taskId?: string;
  pendingFiles: ReturnType<ReturnType<typeof useAttachmentStore.getState>['getPendingFiles']>;
  onRemove: (tempId: string) => void;
  onRetry: (tempId: string) => void;
  onAddFiles: () => void;
}

export function AttachmentBarSection({ taskId, pendingFiles, onRemove, onRetry, onAddFiles }: AttachmentBarSectionProps) {
  if (!taskId || pendingFiles.length === 0) return null;

  return (
    <AttachmentBar
      files={pendingFiles}
      onRemove={onRemove}
      onRetry={onRetry}
      onAddFiles={onAddFiles}
    />
  );
}

interface PaperclipButtonProps {
  disabled: boolean;
  isStreaming: boolean;
  onClick: () => void;
}

export function PaperclipButton({ disabled, isStreaming, onClick }: PaperclipButtonProps) {
  const t = useTranslations('chat');

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled || isStreaming}
      title={t('attachFilesTitle')}
      className="size-8"
    >
      <Paperclip className="size-4" />
    </Button>
  );
}

interface HiddenFileInputProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  disabled: boolean;
  onFilesSelected: (files: File[]) => void;
}

export function HiddenFileInput({ fileInputRef, disabled, onFilesSelected }: HiddenFileInputProps) {
  return (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*,.pdf,.txt,.md,.ts,.tsx,.js,.jsx,.json,.css,.html"
      multiple
      className="hidden"
      onChange={(e) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
          onFilesSelected(files);
        }
        e.target.value = '';
      }}
      disabled={disabled}
    />
  );
}
