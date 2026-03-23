// Helper functions for ToolUseBlock: icons, verbs, display text, and result summaries

import {
  FileText,
  FilePlus,
  FileEdit,
  Terminal,
  Search,
  FolderSearch,
  CheckSquare,
  Globe,
  Zap,
} from 'lucide-react';

/** Get icon component for a given tool name */
export function getToolIcon(name: string) {
  const icons: Record<string, typeof FileText> = {
    Read: FileText,
    Write: FilePlus,
    Edit: FileEdit,
    Bash: Terminal,
    Grep: Search,
    Glob: FolderSearch,
    TodoWrite: CheckSquare,
    WebFetch: Globe,
    WebSearch: Globe,
    Skill: Zap,
    Task: Zap,
    Agent: Zap,
    TaskCreate: CheckSquare,
    TaskUpdate: CheckSquare,
  };
  return icons[name] || FileText;
}

/** Get active verb for a tool (used in streaming status display) */
export function getToolActiveVerb(name: string): string {
  const verbs: Record<string, string> = {
    Read: 'Reading',
    Write: 'Writing',
    Edit: 'Editing',
    Bash: 'Running',
    Grep: 'Searching',
    Glob: 'Finding',
    TodoWrite: 'Updating todos',
    WebFetch: 'Fetching',
    WebSearch: 'Searching web',
    Skill: 'Executing',
    Task: 'Delegating',
    Agent: 'Delegating',
    AskUserQuestion: 'Waiting for',
    TaskCreate: 'Creating task',
    TaskUpdate: 'Updating task',
  };
  return verbs[name] || 'Processing';
}

/** Get compact display text for a tool invocation */
export function getToolDisplay(name: string, input: any): string {
  if (!input) return name;

  switch (name) {
    case 'Read':
      return input.file_path || 'file...';
    case 'Write':
      return input.file_path || 'file...';
    case 'Edit':
      return input.file_path || 'file...';
    case 'Bash':
      return input.description || input.command?.slice(0, 80) || 'command...';
    case 'Grep':
      return `"${input.pattern || ''}"`;
    case 'Glob':
      return `${input.pattern || ''}`;
    case 'TodoWrite':
      if (input.todos && Array.isArray(input.todos)) {
        const inProgress = input.todos.filter((t: any) => t.status === 'in_progress');
        const pending = input.todos.filter((t: any) => t.status === 'pending');
        const completed = input.todos.filter((t: any) => t.status === 'completed');
        return `${completed.length}✓ ${inProgress.length}⟳ ${pending.length}○`;
      }
      return 'list';
    case 'Skill':
      return input.skill || 'unknown';
    case 'WebFetch':
      try {
        const url = new URL(input.url);
        return url.hostname + url.pathname.slice(0, 30);
      } catch {
        return input.url?.slice(0, 50) || 'url...';
      }
    case 'WebSearch':
      return `"${input.query || ''}"`;
    case 'Task':
    case 'Agent':
      return input.description || 'task...';
    case 'TaskCreate':
      return input.subject || 'new task';
    case 'TaskUpdate':
      return input.subject || (input.status ? `→ ${input.status}` : 'task');
    default:
      return name;
  }
}

/** Get a short result summary for completed tool calls (e.g. "Read 81 lines") */
export function getResultSummary(name: string, result?: string): string | null {
  if (!result) return null;

  switch (name) {
    case 'Read': {
      const lines = result.split('\n').length;
      return `${lines} lines`;
    }
    case 'Grep': {
      const matchCount = result.split('\n').filter(l => l.trim()).length;
      if (matchCount === 0) return 'no matches';
      return `${matchCount} match${matchCount !== 1 ? 'es' : ''}`;
    }
    case 'Glob': {
      const files = result.split('\n').filter(l => l.trim()).length;
      if (files === 0) return 'no files';
      return `${files} file${files !== 1 ? 's' : ''}`;
    }
    case 'Task':
    case 'Agent': {
      if (result.includes('completed')) return 'completed';
      return null;
    }
    case 'Write':
      return 'written';
    case 'Edit':
      return 'edited';
    case 'TaskCreate':
      return 'created';
    case 'TaskUpdate': {
      try {
        const parsed = JSON.parse(result);
        return parsed.status || 'updated';
      } catch {
        return 'updated';
      }
    }
    default:
      return null;
  }
}
