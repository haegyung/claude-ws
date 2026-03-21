/**
 * Autopilot question answer poller - polls PersistentQuestionStore for an answer
 *
 * Used by autopilot when it needs to wait for user answer before proceeding
 * (e.g., during the gathering-questions phase). Returns when answer arrives or timeout.
 */

export async function waitForQuestionAnswer(
  agentManager: any,
  taskId: string,
  timeoutMs: number = 300_000,
  intervalMs: number = 500,
): Promise<Record<string, string> | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const data = agentManager.getPersistentQuestion(taskId);
    if (data?.answer) return data.answer;
    if (!data) return null; // question was cleared (cancelled)
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return null; // timeout
}
