/**
 * Search service - grep-like content search and glob-based file search within a project path
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execAsync = promisify(exec);

function resolveSafe(projectPath: string): string {
  return path.resolve(projectPath);
}

export function createSearchService() {
  return {
    async searchContent(
      projectPath: string,
      query: string,
      options?: { glob?: string }
    ): Promise<Array<{ file: string; line: number; content: string }>> {
      const base = resolveSafe(projectPath);
      const globArg = options?.glob ? `--glob '${options.glob}'` : '';

      try {
        // Try ripgrep first
        const { stdout } = await execAsync(
          `rg -n ${globArg} -- ${JSON.stringify(query)} ${JSON.stringify(base)}`
        );
        return parseRgOutput(stdout, base);
      } catch (rgErr: any) {
        // rg not found - fall back to grep
        if (rgErr.code === 127) {
          try {
            const include = options?.glob ? `--include='${options.glob}'` : '';
            const { stdout } = await execAsync(
              `grep -rn ${include} -- ${JSON.stringify(query)} ${JSON.stringify(base)}`
            );
            return parseGrepOutput(stdout, base);
          } catch {
            return [];
          }
        }
        // No matches returns exit code 1 in rg/grep - that is fine
        return [];
      }
    },

    async searchFiles(projectPath: string, pattern: string): Promise<string[]> {
      const base = resolveSafe(projectPath);
      try {
        const { stdout } = await execAsync(
          `find ${JSON.stringify(base)} -name ${JSON.stringify(pattern)} -type f`
        );
        return stdout.trim().split('\n').filter(Boolean).map((p) => path.relative(base, p));
      } catch {
        // Fallback: recursive manual search
        return recursiveGlob(base, pattern);
      }
    },
  };
}

function parseRgOutput(stdout: string, base: string) {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.+):(\d+):(.*)$/);
      if (!match) return null;
      return {
        file: path.relative(base, match[1]),
        line: parseInt(match[2], 10),
        content: match[3],
      };
    })
    .filter(Boolean) as Array<{ file: string; line: number; content: string }>;
}

function parseGrepOutput(stdout: string, base: string) {
  return parseRgOutput(stdout, base);
}

async function recursiveGlob(dir: string, pattern: string): Promise<string[]> {
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  const results: string[] = [];

  async function walk(current: string) {
    try {
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (regex.test(entry.name)) {
          results.push(path.relative(dir, full));
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  await walk(dir);
  return results;
}
