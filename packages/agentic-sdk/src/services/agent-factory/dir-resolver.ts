/**
 * Agent Factory directory resolver - provides paths for data, agent-factory, and global Claude directories
 */
import { join } from 'path';
import { homedir } from 'os';

/** Get the data directory path. Uses DATA_DIR env or {CWD}/data */
export function getDataDir(): string {
  const userCwd = process.env.CLAUDE_WS_USER_CWD || /* turbopackIgnore: true */ process.cwd();
  return process.env.DATA_DIR || join(/* turbopackIgnore: true */ userCwd, 'data');
}

/** Get the Agent Factory directory path (DATA_DIR/agent-factory) */
export function getAgentFactoryDir(): string {
  return join(getDataDir(), 'agent-factory');
}

/** Get the global Claude directory path (~/.claude) */
export function getGlobalClaudeDir(): string {
  return join(/* turbopackIgnore: true */ homedir(), '.claude');
}
