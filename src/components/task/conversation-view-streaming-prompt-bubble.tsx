'use client';

import { FileText } from 'lucide-react';
import { isImageMimeType, formatTimestamp } from './conversation-view-utils';
import type { PendingFile } from '@/types';

interface ConversationViewStreamingPromptBubbleProps {
  prompt: string;
  files?: PendingFile[];
}

/**
 * User prompt bubble shown during active streaming before the turn is persisted to history.
 * Renders the prompt text, optional file attachments (image preview or file icon), and timestamp.
 */
export function ConversationViewStreamingPromptBubble({
  prompt,
  files,
}: ConversationViewStreamingPromptBubbleProps) {
  return (
    <div className="flex justify-end w-full max-w-full">
      <div className="bg-primary/10 rounded-lg px-4 py-3 text-[15px] leading-relaxed break-words space-y-3 max-w-[85%] overflow-hidden">
        <div className="whitespace-pre-wrap">{prompt}</div>
        {files && files.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {files.map((file) =>
              isImageMimeType(file.mimeType) ? (
                <img
                  key={file.tempId}
                  src={file.previewUrl}
                  alt={file.originalName}
                  className="h-16 w-auto rounded border border-border"
                  title={file.originalName}
                />
              ) : (
                <div
                  key={file.tempId}
                  className="flex items-center gap-1 px-2 py-1 bg-background rounded border border-border text-xs"
                  title={file.originalName}
                >
                  <FileText className="size-3" />
                  <span className="max-w-[100px] truncate">{file.originalName}</span>
                </div>
              )
            )}
          </div>
        )}
        <div className="flex justify-end">
          <span className="text-xs text-muted-foreground">{formatTimestamp(Date.now())}</span>
        </div>
      </div>
    </div>
  );
}
