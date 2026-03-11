/**
 * Slash command listing service - returns hardcoded built-in Claude commands plus scans
 * ~/.claude/commands/ and project .claude/commands/ directories for user-defined commands
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface CommandInfo {
  name: string;
  description: string;
  argumentHint?: string;
  isBuiltIn?: boolean;
  isInteractive?: boolean;
}

const BUILTIN_COMMANDS: CommandInfo[] = [
  { name: 'bug', description: 'Report bugs (sends conversation to Anthropic)', isBuiltIn: true },
  { name: 'clear', description: 'Clear conversation history', isBuiltIn: true, isInteractive: true },
  { name: 'compact', description: 'Compact conversation to save context', isBuiltIn: true, isInteractive: true },
  { name: 'config', description: 'View/modify configuration', isBuiltIn: true, isInteractive: true },
  { name: 'cost', description: 'Show token usage and cost', isBuiltIn: true },
  { name: 'doctor', description: 'Check Claude Code installation health', isBuiltIn: true },
  { name: 'help', description: 'Show help and available commands', isBuiltIn: true },
  { name: 'init', description: 'Initialize project with CLAUDE.md', isBuiltIn: true },
  { name: 'login', description: 'Switch Anthropic accounts', isBuiltIn: true },
  { name: 'logout', description: 'Sign out from Anthropic account', isBuiltIn: true },
  { name: 'mcp', description: 'View MCP server status', isBuiltIn: true },
  { name: 'memory', description: 'Edit CLAUDE.md memory files', isBuiltIn: true },
  { name: 'model', description: 'Switch AI model', isBuiltIn: true, isInteractive: true },
  { name: 'permissions', description: 'View/update permissions', isBuiltIn: true },
  { name: 'pr-comments', description: 'View PR comments for current branch', isBuiltIn: true },
  { name: 'review', description: 'Request code review', isBuiltIn: true },
  { name: 'rewind', description: 'Rewind conversation to previous state', isBuiltIn: true, isInteractive: true },
  { name: 'status', description: 'View account and system status', isBuiltIn: true },
  { name: 'terminal-setup', description: 'Install shell integration (Shift+Enter)', isBuiltIn: true },
  { name: 'vim', description: 'Enter vim mode for multi-line input', isBuiltIn: true },
];

function parseFrontmatter(content: string): { description?: string; argumentHint?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = match[1];
  const desc = fm.match(/description:\s*(.+)/);
  const arg = fm.match(/argument-hint:\s*(.+)/);
  return {
    description: desc ? desc[1].trim().replace(/^["']|["']$/g, '') : undefined,
    argumentHint: arg ? arg[1].trim().replace(/^["']|["']$/g, '') : undefined,
  };
}

function scanCommandsDir(dir: string, prefix = ''): CommandInfo[] {
  const commands: CommandInfo[] = [];
  try {
    for (const item of readdirSync(dir)) {
      const itemPath = join(dir, item);
      const stat = statSync(itemPath);
      if (stat.isFile() && item.endsWith('.md')) {
        const name = item.replace('.md', '');
        const fullName = prefix ? `${prefix}:${name}` : name;
        const { description, argumentHint } = parseFrontmatter(readFileSync(itemPath, 'utf-8'));
        commands.push({ name: fullName, description: description || `Run /${fullName} command`, argumentHint });
      } else if (stat.isDirectory()) {
        commands.push(...scanCommandsDir(itemPath, prefix ? `${prefix}:${item}` : item));
      }
    }
  } catch { /* directory unreadable */ }
  return commands;
}

export function createCommandService() {
  return {
    list(projectPath?: string): CommandInfo[] {
      const dirs = [join(homedir(), '.claude', 'commands')];
      if (projectPath) dirs.push(join(projectPath, '.claude', 'commands'));

      const userCommands: CommandInfo[] = [];
      for (const dir of dirs) {
        for (const cmd of scanCommandsDir(dir)) {
          const idx = userCommands.findIndex((c) => c.name === cmd.name);
          if (idx >= 0) userCommands[idx] = cmd;
          else userCommands.push(cmd);
        }
      }

      const all = [...BUILTIN_COMMANDS, ...userCommands];
      all.sort((a, b) => a.name.localeCompare(b.name));
      return all;
    },

    getById(name: string, projectPath?: string): CommandInfo | undefined {
      return this.list(projectPath).find((c) => c.name === name);
    },
  };
}
