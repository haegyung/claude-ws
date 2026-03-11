/**
 * Agent start options and event type definitions for the agentic-sdk agent layer.
 * Used by AgentManager and AgentProvider to type agent lifecycle events.
 */

export interface AgentStartOptions {
  attemptId: string;
  projectPath: string;
  prompt: string;
  model?: string;
  sessionOptions?: {
    resume?: string;
    resumeSessionAt?: string;
  };
  maxTurns?: number;
  outputFormat?: string;
  outputSchema?: string;
}

export interface BackgroundShellInfo {
  toolUseId: string;
  command: string;
  description?: string;
  originalCommand?: string;
}

export interface AgentEvents {
  started: { attemptId: string };
  json: { attemptId: string; data: unknown };
  stderr: { attemptId: string; content: string };
  exit: { attemptId: string; code: number | null };
  question: { attemptId: string; toolUseId: string; questions: unknown[] };
  questionResolved: { attemptId: string };
  backgroundShell: { attemptId: string; shell: BackgroundShellInfo };
  promptTooLong: { attemptId: string };
}
