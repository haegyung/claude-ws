/**
 * Agent Factory Claude dependency analyzer service
 * Uses Claude CLI to intelligently analyze source code for dependencies
 * Falls back to regex-based extraction if Claude CLI is unavailable or returns no results
 */
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { dependencyExtractor } from './dependency-extractor.ts';
import type { LibraryDep, PluginDep } from './dependency-extractor-parsers.ts';

export type { LibraryDep, PluginDep };

export interface AnalysisResult {
  libraries: LibraryDep[];
  plugins: PluginDep[];
  installScripts?: {
    npm?: string;
    pnpm?: string;
    yarn?: string;
    pip?: string;
    poetry?: string;
    cargo?: string;
    go?: string;
    dockerfile?: string;
  };
}

const execAsync = promisify(exec);

/**
 * Claude SDK Dependency Analyzer
 * Uses Claude CLI to intelligently analyze code for dependencies
 */
export class ClaudeDependencyAnalyzer {
  private readonly claudePath: string;

  constructor() {
    this.claudePath = process.env.CLAUDE_CLI_PATH || 'claude';
  }

  /**
   * Analyze component dependencies using Claude CLI, with regex fallback
   */
  async analyze(sourcePath: string, type: string): Promise<AnalysisResult> {
    try {
      if (!existsSync(sourcePath)) {
        return { libraries: [], plugins: [] };
      }

      const files = await this.collectSourceFiles(sourcePath, type);
      if (files.length === 0) {
        return { libraries: [], plugins: [] };
      }

      const prompt = this.buildAnalysisPrompt(files, type);
      const result = await this.callClaude(prompt);
      const parsed = this.parseAnalysisResult(result);

      // Fall back to regex extraction if Claude returned no results
      if (parsed.libraries.length === 0 && parsed.plugins.length === 0) {
        console.warn('[ClaudeDependencyAnalyzer] Claude returned no results, falling back to regex extraction');
        const fallback = await dependencyExtractor.extract(sourcePath, type);
        return { libraries: fallback.libraries, plugins: fallback.plugins };
      }

      return parsed;
    } catch (error) {
      console.error('[ClaudeDependencyAnalyzer] Claude analysis failed, falling back to regex extraction:', error);
      const fallback = await dependencyExtractor.extract(sourcePath, type);
      return { libraries: fallback.libraries, plugins: fallback.plugins };
    }
  }

  /**
   * Collect all source files for analysis
   */
  private async collectSourceFiles(
    sourcePath: string,
    type: string
  ): Promise<Array<{ path: string; content: string }>> {
    const files: Array<{ path: string; content: string }> = [];
    const isDirectory = type === 'skill';

    if (isDirectory) {
      const collect = async (dir: string, baseDir: string): Promise<void> => {
        try {
          const entries = await readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name.startsWith('mod')) {
              continue;
            }
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
              await collect(fullPath, baseDir);
            } else if (entry.isFile() && this.isSourceFile(entry.name)) {
              const content = await readFile(fullPath, 'utf-8');
              files.push({ path: fullPath.substring(baseDir.length), content });
            }
          }
        } catch { /* skip */ }
      };
      await collect(sourcePath, sourcePath);
    } else {
      const content = await readFile(sourcePath, 'utf-8');
      files.push({ path: sourcePath, content });
    }

    return files;
  }

  private isSourceFile(filename: string): boolean {
    const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.rb', '.php'];
    return sourceExtensions.some(ext => filename.endsWith(ext));
  }

  /**
   * Build analysis prompt for Claude CLI
   */
  private buildAnalysisPrompt(files: Array<{ path: string; content: string }>, type: string): string {
    const fileContents = files.map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');

    return `You are a code analysis expert. Analyze the following ${type} code and extract dependencies.

**Output Format (JSON only):**
\`\`\`json
{
  "libraries": [
    {"name": "package-name", "version": "1.0.0", "manager": "npm"}
  ],
  "components": [
    {"type": "skill", "name": "skill-name"},
    {"type": "command", "name": "command-name"},
    {"type": "agent", "name": "agent-name"}
  ]
}
\`\`\`

**Rules:**
1. Extract external package/library imports (npm, pip, cargo, go)
2. Extract component references (skill: "name", useSkill('name'), /skill:name, etc.)
3. Return ONLY valid JSON, no markdown formatting

**Code to analyze:**
${fileContents}`;
  }

  /**
   * Call Claude CLI with retry logic
   */
  private async callClaude(prompt: string): Promise<string> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const { stdout } = await execAsync(
          `"${this.claudePath}" "${prompt.replace(/"/g, '\\"')}"`,
          { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }
        );
        return stdout;
      } catch (error: any) {
        lastError = error;
        console.error(`[ClaudeDependencyAnalyzer] Claude CLI attempt ${i + 1} failed:`, error);
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }

    throw lastError || new Error('Claude CLI failed after retries');
  }

  /**
   * Parse and validate Claude CLI response
   */
  private parseAnalysisResult(result: string): AnalysisResult {
    try {
      let jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```/);
      if (!jsonMatch) jsonMatch = result.match(/```\s*([\s\S]*?)\s*```/);
      if (!jsonMatch) jsonMatch = result.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        console.warn('[ClaudeDependencyAnalyzer] No JSON found in Claude response');
        return { libraries: [], plugins: [] };
      }

      const parsed = JSON.parse(jsonMatch[1]);

      const libraries: LibraryDep[] = (parsed.libraries || []).map((lib: any) => ({
        name: lib.name || lib,
        version: lib.version,
        manager: this.normalizeManager(lib.manager),
      }));

      const components: PluginDep[] = (parsed.components || []).filter((c: any) =>
        c.type && c.name && ['skill', 'command', 'agent'].includes(c.type)
      );

      return { libraries, plugins: components };
    } catch (error) {
      console.error('[ClaudeDependencyAnalyzer] Failed to parse Claude response:', error);
      return { libraries: [], plugins: [] };
    }
  }

  private normalizeManager(manager: string): LibraryDep['manager'] {
    const validManagers = ['npm', 'pnpm', 'yarn', 'pip', 'poetry', 'cargo', 'go', 'composer', 'gem'];
    return validManagers.includes(manager) ? (manager as LibraryDep['manager']) : 'npm';
  }
}

export const claudeDependencyAnalyzer = new ClaudeDependencyAnalyzer();
