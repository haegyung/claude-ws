'use client';

import { useTranslations } from 'next-intl';
import { buildToolResultsMap, findLastToolUseId } from './conversation-view-utils';
import { renderMessage } from './conversation-view-content-block-renderer';
import type { ConversationTurn } from './conversation-view-utils';

interface ConversationHistoricalAssistantTurnProps {
  turn: ConversationTurn;
  onOpenQuestion?: () => void;
}

/**
 * Renders a historical assistant turn — all message blocks in order plus
 * an optional "cancelled" label. Used inside ConversationView for past turns.
 */
export function ConversationHistoricalAssistantTurn({
  turn,
  onOpenQuestion,
}: ConversationHistoricalAssistantTurnProps) {
  const t = useTranslations('chat');
  const isCancelled = turn.attemptStatus === 'cancelled';
  const toolResultsMap = buildToolResultsMap(turn.messages);
  const lastToolUseId = findLastToolUseId(turn.messages);

  if (isCancelled) {
    console.log('[ConversationView] Rendering cancelled assistant turn:', turn.attemptId, turn.attemptStatus, 'messages:', turn.messages.length);
  }

  return (
    <div className="space-y-4 w-full max-w-full overflow-hidden">
      {turn.messages.map((msg, idx) =>
        renderMessage({ output: msg, index: idx, isStreaming: false, toolResultsMap, lastToolUseId, onOpenQuestion })
      )}
      <div className="flex justify-end">
        {isCancelled && (
          <span className="text-xs text-muted-foreground italic">{t('cancelled')}</span>
        )}
      </div>
    </div>
  );
}
