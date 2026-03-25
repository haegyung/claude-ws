/**
 * Slash command listing service - returns hardcoded built-in Claude commands plus scans
 * ~/.claude/commands/ and project .claude/commands/ directories for user-defined commands.
 * Also provides getContent() and processPrompt() for reading and processing command files.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, basename, resolve } from 'path';
import { homedir } from 'os';

export interface CommandInfo {
  name: string;
  description: string;
  argumentHint?: string;
  isBuiltIn?: boolean;
  isInteractive?: boolean;
}

export interface CommandContent {
  name: string;
  body: string;
  description?: string;
  argumentHint?: string;
}

export interface CommandPromptResult {
  name: string;
  prompt: string;
}

export type CommandFileError = { code: 'NOT_FOUND' } | { code: 'FORBIDDEN' };

const BUILTIN_COMMANDS: CommandInfo[] = [
  { name: 'batch', description: 'Run batch operations', isBuiltIn: true },
  { name: 'bug', description: 'Report bugs (sends conversation to Anthropic)', isBuiltIn: true },
  { name: 'claude-api', description: 'Build apps with the Claude API', isBuiltIn: true },
  { name: 'clear', description: 'Clear conversation history', isBuiltIn: true, isInteractive: true },
  { name: 'compact', description: 'Compact conversation to save context', isBuiltIn: true, isInteractive: true },
  { name: 'config', description: 'View/modify configuration', isBuiltIn: true, isInteractive: true },
  { name: 'context', description: 'View conversation context usage', isBuiltIn: true },
  { name: 'cost', description: 'Show token usage and cost', isBuiltIn: true },
  { name: 'debug', description: 'Debug issues with Claude Code', isBuiltIn: true },
  { name: 'doctor', description: 'Check Claude Code installation health', isBuiltIn: true },
  { name: 'heapdump', description: 'Dump heap snapshot for debugging', isBuiltIn: true },
  { name: 'help', description: 'Show help and available commands', isBuiltIn: true },
  { name: 'init', description: 'Initialize project with CLAUDE.md', isBuiltIn: true },
  { name: 'insights', description: 'Show session insights and analytics', isBuiltIn: true },
  { name: 'login', description: 'Switch Anthropic accounts', isBuiltIn: true },
  { name: 'logout', description: 'Sign out from Anthropic account', isBuiltIn: true },
  { name: 'loop', description: 'Run a prompt on a recurring interval', isBuiltIn: true },
  { name: 'mcp', description: 'View MCP server status', isBuiltIn: true },
  { name: 'memory', description: 'Edit CLAUDE.md memory files', isBuiltIn: true },
  { name: 'model', description: 'Switch AI model', isBuiltIn: true, isInteractive: true },
  { name: 'permissions', description: 'View/update permissions', isBuiltIn: true },
  { name: 'pr-comments', description: 'View PR comments for current branch', isBuiltIn: true },
  { name: 'release-notes', description: 'Generate release notes from changes', isBuiltIn: true },
  { name: 'review', description: 'Request code review', isBuiltIn: true },
  { name: 'rewind', description: 'Rewind conversation to previous state', isBuiltIn: true, isInteractive: true },
  { name: 'security-review', description: 'Run security review on code', isBuiltIn: true },
  { name: 'simplify', description: 'Simplify and refine code', isBuiltIn: true },
  { name: 'status', description: 'View account and system status', isBuiltIn: true },
  { name: 'terminal-setup', description: 'Install shell integration (Shift+Enter)', isBuiltIn: true },
  { name: 'update-config', description: 'Configure Claude Code settings', isBuiltIn: true },
  { name: 'vim', description: 'Enter vim mode for multi-line input', isBuiltIn: true },
];

function parseFrontmatter(content: string): { name?: string; description?: string; argumentHint?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = match[1];
  const nameMatch = fm.match(/name:\s*(.+)/);
  const desc = fm.match(/description:\s*(.+)/);
  const arg = fm.match(/argument-hint:\s*(.+)/);
  return {
    name: nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, '') : undefined,
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

function scanSkillsDir(dir: string): CommandInfo[] {
  const skills: CommandInfo[] = [];
  try {
    if (!existsSync(dir)) return skills;
    for (const item of readdirSync(dir)) {
      const itemPath = join(dir, item);
      const stat = statSync(itemPath);
      if (stat.isDirectory()) {
        const skillFile = join(itemPath, 'SKILL.md');
        if (existsSync(skillFile)) {
          const content = readFileSync(skillFile, 'utf-8');
          const fm = parseFrontmatter(content);
          const name = fm.name || item;
          skills.push({ name, description: fm.description || `Run /${item} skill`, argumentHint: fm.argumentHint });
        } else {
          skills.push(...scanSkillsDir(itemPath));
        }
      }
    }
  } catch { /* directory unreadable */ }
  return skills;
}

/** Parse frontmatter + body from a command file (supports description/argument-hint fields) */
function parseCommandFile(content: string): { body: string; description?: string; argumentHint?: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)/);
  if (!frontmatterMatch) return { body: content };
  const fm = frontmatterMatch[1];
  const body = frontmatterMatch[2].trim();
  const descMatch = fm.match(/description:\s*(.+)/);
  const argMatch = fm.match(/argument-hint:\s*(.+)/);
  return {
    body,
    description: descMatch ? descMatch[1].trim() : undefined,
    argumentHint: argMatch ? argMatch[1].trim() : undefined,
  };
}

/** Resolve and validate a command file path (returns null if forbidden or not found) */
function resolveCommandFile(
  name: string,
  subcommand?: string,
): { filePath: string; fullName: string } | { error: CommandFileError } {
  const safeName = basename(name);
  const commandsDir = join(homedir(), '.claude', 'commands');
  const filePath = subcommand
    ? join(commandsDir, safeName, `${basename(subcommand)}.md`)
    : join(commandsDir, `${safeName}.md`);
  const resolvedPath = resolve(filePath);
  if (!resolvedPath.startsWith(resolve(commandsDir))) return { error: { code: 'FORBIDDEN' } };
  if (!existsSync(filePath)) return { error: { code: 'NOT_FOUND' } };
  const fullName = subcommand ? `${name}:${subcommand}` : name;
  return { filePath, fullName };
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

      // Scan skills directories
      const skillsDirs = [
        join(homedir(), '.claude', 'skills'),
        join(homedir(), '.claude', 'agent-factory', 'skills'),
      ];
      if (projectPath) skillsDirs.push(join(projectPath, '.claude', 'skills'));

      const skills: CommandInfo[] = [];
      for (const skillsDir of skillsDirs) {
        for (const skill of scanSkillsDir(skillsDir)) {
          const idx = skills.findIndex((s) => s.name === skill.name);
          if (idx >= 0) skills[idx] = skill;
          else skills.push(skill);
        }
      }

      const all = [...BUILTIN_COMMANDS, ...userCommands, ...skills];
      all.sort((a, b) => a.name.localeCompare(b.name));
      return all;
    },

    getById(name: string, projectPath?: string): CommandInfo | undefined {
      return this.list(projectPath).find((c) => c.name === name);
    },

    /** Read and parse a command file — returns content or a typed error */
    getContent(name: string, subcommand?: string): CommandContent | CommandFileError {
      const resolved = resolveCommandFile(name, subcommand);
      if ('error' in resolved) return resolved.error;
      const raw = readFileSync(resolved.filePath, 'utf-8');
      const parsed = parseCommandFile(raw);
      return { name: resolved.fullName, ...parsed };
    },

    /** Read a command file, substitute $ARGUMENTS, and return the processed prompt */
    processPrompt(name: string, args?: string, subcommand?: string): CommandPromptResult | CommandFileError {
      const resolved = resolveCommandFile(name, subcommand);
      if ('error' in resolved) return resolved.error;
      const raw = readFileSync(resolved.filePath, 'utf-8');
      const { body } = parseCommandFile(raw);
      const prompt = args
        ? body.replace(/\$ARGUMENTS/g, args)
        : body.replace(/\$ARGUMENTS/g, '');
      return { name: resolved.fullName, prompt: prompt.trim() };
    },
  };
}
