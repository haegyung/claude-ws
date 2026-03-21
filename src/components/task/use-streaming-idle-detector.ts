import { useEffect, useRef, useState } from 'react';
import type { ClaudeOutput } from '@/types';

/**
 * Detects when streaming is "idle" — isRunning but no new content
 * has arrived for a threshold period. Useful for showing a
 * "still working" indicator that only appears during pauses
 * (tool calls, compaction, waiting), not during active text flow.
 *
 * Returns true when:
 *  - isRunning && no messages yet (immediate idle)
 *  - isRunning && messages stopped changing for >= idleThresholdMs
 */
export function useStreamingIdleDetector(
  isRunning: boolean,
  currentMessages: ClaudeOutput[],
  idleThresholdMs: number = 2000
): boolean {
  const [isIdle, setIsIdle] = useState(false);
  const prevFingerprintRef = useRef('');

  // Build a lightweight fingerprint from message count + last message shape
  const fingerprint = buildFingerprint(currentMessages);

  useEffect(() => {
    if (!isRunning) {
      setIsIdle(false);
      prevFingerprintRef.current = '';
      return;
    }

    // No messages yet → idle immediately (waiting for first response)
    if (currentMessages.length === 0) {
      setIsIdle(true);
      return;
    }

    // Fingerprint changed → new content arrived
    if (fingerprint !== prevFingerprintRef.current) {
      prevFingerprintRef.current = fingerprint;
      setIsIdle(false);

      // Start idle timer
      const timer = setTimeout(() => setIsIdle(true), idleThresholdMs);
      return () => clearTimeout(timer);
    }

    // Fingerprint unchanged → already waiting, keep current state
    // (timer from previous render is still ticking)
  }, [isRunning, fingerprint, currentMessages.length, idleThresholdMs]);

  return isIdle;
}

/**
 * Cheap fingerprint: message count + last message type + approx content length.
 * Changes whenever a new block arrives or existing text grows.
 */
function buildFingerprint(messages: ClaudeOutput[]): string {
  if (messages.length === 0) return '0';
  const last = messages[messages.length - 1];
  const content = last.message?.content;
  const contentLen = Array.isArray(content)
    ? content.reduce((acc, b) => acc + ('text' in b ? (b.text?.length ?? 0) : 0), 0)
    : typeof content === 'string' ? content.length : 0;
  return `${messages.length}:${last.type}:${contentLen}`;
}
