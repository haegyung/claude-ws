/**
 * Shared formatting utilities for workflow/team-view components.
 * Extracted to avoid duplication across agent-spawned-card, agent-detail-tab,
 * team-chat-tab, and team-tree-sidebar.
 */

/** Format millisecond duration to human-readable string (e.g. "2m 30s") */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/** Format unix timestamp to locale time string (HH:MM:SS) */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
