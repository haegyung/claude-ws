'use client';

import { FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isImageMimeType, formatTimestamp } from './conversation-view-utils';
import type { ConversationTurn } from './conversation-view-utils';

interface ConversationHistoricalUserTurnProps {
  turn: ConversationTurn;
}

/**
 * Renders a historical user prompt bubble with optional file attachments,
 * timestamp, and cancelled label. Used inside ConversationView for past turns.
 */
export function ConversationHistoricalUserTurn({ turn }: ConversationHistoricalUserTurnProps) {
  const t = useTranslations('chat');
  const isCancelled = turn.attemptStatus === 'cancelled';

  if (isCancelled) {
    console.log('[ConversationView] Rendering cancelled user turn:', turn.attemptId, turn.attemptStatus);
  }

  return (
    <div className="flex flex-col items-end w-full max-w-full gap-1">
      <div className="bg-primary/10 rounded-lg px-4 py-3 text-[15px] leading-relaxed break-words space-y-3 max-w-[85%] overflow-hidden">
        <div className="whitespace-pre-wrap">{turn.prompt}</div>
        {turn.files && turn.files.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {turn.files.map((file) =>
              isImageMimeType(file.mimeType) ? (
                <a
                  key={file.id}
                  href={`/api/uploads/${file.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <img
                    src={`/api/uploads/${file.id}`}
                    alt={file.originalName}
                    className="h-16 w-auto rounded border border-border hover:border-primary transition-colors"
                    title={file.originalName}
                  />
                </a>
              ) : (
                <a
                  key={file.id}
                  href={`/api/uploads/${file.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2 py-1 bg-background rounded border border-border hover:border-primary transition-colors text-xs"
                  title={file.originalName}
                >
                  <FileText className="size-3" />
                  <span className="max-w-[100px] truncate">{file.originalName}</span>
                </a>
              )
            )}
          </div>
        )}
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">{formatTimestamp(turn.timestamp)}</span>
          {isCancelled && (
            <span className="text-xs text-muted-foreground italic ml-2">{t('cancelled')}</span>
          )}
        </div>
      </div>
    </div>
  );
}
