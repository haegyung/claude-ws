// Context file I/O for autopilot task resume
// Files stored at {projectPath}/autopilot/{taskId}.md
// Records the full journey: start, Q&A, validation, retry, completion, skip
import fs from 'fs';
import path from 'path';
import { createLogger } from '../logger';

const log = createLogger('AutopilotContextFile');

/** Ensure the autopilot directory exists under project path */
function ensureAutopilotDir(projectPath: string): string {
  const dir = path.join(projectPath, 'autopilot');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function contextFilePath(projectPath: string, taskId: string): string {
  return path.join(projectPath, 'autopilot', `${taskId}.md`);
}

/** Append a raw entry to the context file, creating it if needed */
function appendEntry(projectPath: string, taskId: string, entry: string): void {
  try {
    ensureAutopilotDir(projectPath);
    const filePath = contextFilePath(projectPath, taskId);
    if (fs.existsSync(filePath)) {
      fs.appendFileSync(filePath, entry, 'utf-8');
    } else {
      fs.writeFileSync(filePath, `# Task Context\n\n## Journey\n${entry}`, 'utf-8');
    }
  } catch (err) {
    log.error({ err, taskId }, 'Failed to append to context file');
  }
}

function ts(): string {
  return new Date().toISOString();
}

/** Write initial context file when task first starts */
export function writeContextFile(
  projectPath: string,
  taskId: string,
  title: string,
  requirements: string
): void {
  try {
    ensureAutopilotDir(projectPath);
    const content = `# Task: ${title}\n\n## Requirements\n${requirements}\n\n## Journey\n\n### [${ts()}] Task Started\n- Status: in_progress\n`;
    fs.writeFileSync(contextFilePath(projectPath, taskId), content, 'utf-8');
  } catch (err) {
    log.error({ err, taskId }, 'Failed to write context file');
  }
}

/** Read context file content, returns null if not found */
export function readContextFile(projectPath: string, taskId: string): string | null {
  try {
    const filePath = contextFilePath(projectPath, taskId);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    log.error({ err, taskId }, 'Failed to read context file');
    return null;
  }
}

/** Record Q&A exchange from AskUserQuestion */
export function appendQuestionAnswer(
  projectPath: string,
  taskId: string,
  questions: { question: string; header?: string }[],
  answers: Record<string, string>
): void {
  const qaLines = questions.map((q) => {
    const answer = answers[q.question] ?? 'No answer provided';
    return `- **Q:** ${q.header ? `[${q.header}] ` : ''}${q.question}\n  **A:** ${answer}`;
  }).join('\n');

  appendEntry(projectPath, taskId, `\n### [${ts()}] User Q&A\n${qaLines}\n`);
}

/** Record validation result (completed or not) */
export function appendValidationResult(
  projectPath: string,
  taskId: string,
  completed: boolean,
  reason: string
): void {
  const status = completed ? 'PASSED' : 'FAILED';
  appendEntry(projectPath, taskId, `\n### [${ts()}] Validation ${status}\n- ${reason}\n`);
}

/** Record retry decision with attempt number and strategy */
export function appendRetryEntry(
  projectPath: string,
  taskId: string,
  attemptNum: number,
  maxRetries: number,
  useSessionResume: boolean
): void {
  const strategy = useSessionResume ? 'session resume' : 'fresh session';
  appendEntry(projectPath, taskId, `\n### [${ts()}] Retry ${attemptNum}/${maxRetries}\n- Strategy: ${strategy}\n`);
}

/** Record task skipped after max retries */
export function appendSkippedEntry(
  projectPath: string,
  taskId: string,
  maxRetries: number
): void {
  appendEntry(projectPath, taskId, `\n### [${ts()}] Task Skipped\n- Reason: Max retries (${maxRetries}) exhausted, moved back to todo\n`);
}

/** Record task moved to in_review */
export function appendCompletedEntry(
  projectPath: string,
  taskId: string
): void {
  appendEntry(projectPath, taskId, `\n### [${ts()}] Task Completed\n- Status: moved to in_review\n`);
}

/** Record sub-agent finished (completed/failed) */
export function appendSubagentEnded(
  projectPath: string,
  taskId: string,
  agentName: string | null,
  status: string,
): void {
  appendEntry(projectPath, taskId, `- [${ts()}] Sub-agent ${status}: ${agentName || 'sub-agent'}\n`);
}

/** Record tracked sub-task status snapshot (only completed states) */
export function appendTrackedTaskUpdate(
  projectPath: string,
  taskId: string,
  tasks: { subject: string; status: string }[]
): void {
  const lines = tasks.map(t => `[${t.status}] ${t.subject}`).join(' | ');
  appendEntry(projectPath, taskId, `- [${ts()}] Sub-tasks: ${lines}\n`);
}
