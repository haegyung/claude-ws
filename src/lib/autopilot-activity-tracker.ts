/**
 * Autopilot activity tracker - tracks last activity timestamp per attempt for idle timeout detection
 *
 * Updated on every agentManager event, queried by autopilot worker sweep.
 * Simple in-memory Map — no persistence needed, resets on restart.
 */

export class AutopilotActivityTracker {
  private lastActivity = new Map<string, number>();

  recordActivity(attemptId: string): void {
    this.lastActivity.set(attemptId, Date.now());
  }

  getLastActivity(attemptId: string): number | null {
    return this.lastActivity.get(attemptId) ?? null;
  }

  isIdle(attemptId: string, timeoutMs: number): boolean {
    const last = this.lastActivity.get(attemptId);
    if (!last) return false; // no record = not tracked yet
    return (Date.now() - last) > timeoutMs;
  }

  remove(attemptId: string): void {
    this.lastActivity.delete(attemptId);
  }
}

export const activityTracker = new AutopilotActivityTracker();
