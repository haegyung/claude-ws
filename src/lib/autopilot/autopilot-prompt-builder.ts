// Build mode-specific prompts for autopilot tasks
// Handles autonomous (initial + resume) and ask (initial + resume) modes

export type AutopilotMode = 'off' | 'autonomous' | 'ask';

interface TaskContext {
  completedTitles: string[];
  allTodoTitles: string[];
}

/** Build prompt for autonomous mode — initial task start (gather requirements first) */
export function buildAutonomousInitialPrompt(
  basePrompt: string,
  contextFilePath: string,
  taskContext: TaskContext
): string {
  const progress = formatProgress(taskContext);
  return `${basePrompt}

[AUTOPILOT MODE - REQUIREMENTS GATHERING]
First, use AskUserQuestion to gather all requirements from the user.
Ask about: expected behavior, edge cases, constraints, preferences.
After gathering requirements, write all context to ${contextFilePath}
Then proceed to implement. Do NOT ask more questions after writing context.
- For any permission or confirmation, proceed with YES/allow.
- Complete the task fully without asking for further clarification.${progress}`;
}

/** Build prompt for autonomous mode — resume after stall/retry */
export function buildAutonomousResumePrompt(
  basePrompt: string,
  contextFileContent: string | null,
  taskContext: TaskContext
): string {
  const progress = formatProgress(taskContext);
  const contextSection = contextFileContent
    ? `\n\nContext from previous attempts:\n${contextFileContent}`
    : '';
  return `Check if there is remaining work and finish it. If no remaining work, let's finish.

Original task: ${basePrompt}

[AUTOPILOT MODE] You are running in fully autonomous mode. Important rules:
- Do NOT use AskUserQuestion tool. There is no human available to answer.
- Make all decisions yourself based on the task description.
- If something is ambiguous, choose the most reasonable approach and proceed.
- For any permission or confirmation, proceed with YES/allow.
- Complete the task fully without asking for clarification.${contextSection}${progress}`;
}

/** Build prompt for ask mode — initial task start */
export function buildAskInitialPrompt(
  basePrompt: string,
  contextFilePath: string,
  taskContext: TaskContext
): string {
  const progress = formatProgress(taskContext);
  return `${basePrompt}

[AUTOPILOT MODE - ASK]
You may use AskUserQuestion when you need clarification.
Update context file at ${contextFilePath} with progress as you work.
- Complete the task as described.
- Ask questions only when genuinely needed.${progress}`;
}

/** Build prompt for ask mode — resume after stall */
export function buildAskResumePrompt(
  basePrompt: string,
  contextFileContent: string | null,
  taskContext: TaskContext
): string {
  const progress = formatProgress(taskContext);
  const contextSection = contextFileContent
    ? `\n\nContext from previous attempts:\n${contextFileContent}`
    : '';
  return `Check if there is remaining work and finish it. If no remaining work, let's finish.

Original task: ${basePrompt}

[AUTOPILOT MODE - ASK]
You may use AskUserQuestion when you need clarification.
Continue from where the previous attempt left off.${contextSection}${progress}`;
}

/** Format progress info from task context */
function formatProgress(ctx: TaskContext): string {
  let info = '';
  if (ctx.completedTitles.length > 0) {
    info += `\n\nTasks already completed: ${ctx.completedTitles.join(', ')}`;
  }
  if (ctx.allTodoTitles.length > 0) {
    info += `\nRemaining tasks after this: ${ctx.allTodoTitles.join(', ')}`;
  }
  return info;
}
