import { useEffect, useRef } from 'react';
import type { ClaudeOutput } from '@/types';

/**
 * Hook that manages auto-scroll behaviour for ConversationView.
 *
 * - Scrolls to bottom when new messages arrive (if already near bottom).
 * - Always scrolls to bottom when a new attempt starts.
 * - Implements sticky-to-bottom during streaming: stops following when user
 *   scrolls up, resumes when they scroll back to the bottom.
 * - Scrolls to bottom after history finishes loading.
 */
export function useConversationAutoScroll(
  scrollAreaRef: React.RefObject<HTMLDivElement | null>,
  currentMessages: ClaudeOutput[],
  historicalTurns: unknown[],
  isRunning: boolean,
  isLoading: boolean
) {
  const isNearBottom = () => {
    const detachedContainer = scrollAreaRef.current?.closest('[data-detached-scroll-container]');
    if (detachedContainer) {
      return detachedContainer.scrollHeight - detachedContainer.scrollTop - detachedContainer.clientHeight < 5;
    }
    const viewport = scrollAreaRef.current?.querySelector('[data-slot="scroll-area-viewport"]');
    if (!viewport) return true;
    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 5;
  };

  const scrollToBottom = () => {
    const detachedContainer = scrollAreaRef.current?.closest('[data-detached-scroll-container]');
    if (detachedContainer) {
      detachedContainer.scrollTop = detachedContainer.scrollHeight;
    } else {
      const viewport = scrollAreaRef.current?.querySelector('[data-slot="scroll-area-viewport"]');
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  };

  // Scroll when new content arrives if near bottom
  useEffect(() => {
    if (isNearBottom()) {
      scrollToBottom();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMessages, historicalTurns]);

  // Always scroll to bottom when a new attempt starts
  useEffect(() => {
    if (isRunning) {
      scrollToBottom();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  // Sticky-to-bottom pattern during streaming
  useEffect(() => {
    if (!isRunning) return;

    const contentContainer = scrollAreaRef.current;
    if (!contentContainer) return;

    let isStuckToBottom = true;

    const observer = new MutationObserver(() => {
      if (isStuckToBottom) {
        scrollToBottom();
      }
    });

    observer.observe(contentContainer, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    let lastScrollTop = 0;
    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      const currentScrollTop = target.scrollTop;
      const atBottom = target.scrollHeight - currentScrollTop - target.clientHeight < 50;

      if (atBottom) {
        isStuckToBottom = true;
      } else if (currentScrollTop < lastScrollTop) {
        isStuckToBottom = false;
      }
      lastScrollTop = currentScrollTop;
    };

    const detachedContainer = contentContainer.closest('[data-detached-scroll-container]');
    const viewport = detachedContainer || contentContainer.querySelector('[data-slot="scroll-area-viewport"]');
    viewport?.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      viewport?.removeEventListener('scroll', handleScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  // Scroll to bottom after history finishes loading
  useEffect(() => {
    if (!isLoading) {
      scrollToBottom();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);
}
