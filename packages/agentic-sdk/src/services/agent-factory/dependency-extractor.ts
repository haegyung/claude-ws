/**
 * Agent Factory dependency extractor service
 * Extracts library and plugin dependencies from source code using regex-based analysis
 * Delegates heavy parsing to agent-factory-dependency-extractor-parsers-service
 */
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import {
  extractLibraries,
  extractComponents,
  analyzePackageFiles,
} from './dependency-extractor-parsers.ts';

export type { LibraryDep, PluginDep } from './dependency-extractor-parsers.ts';
import type { LibraryDep, PluginDep } from './dependency-extractor-parsers.ts';

export interface ExtractedDeps {
  libraries: LibraryDep[];
  plugins: PluginDep[];
}

/**
 * Dependency Extractor Service
 * Extracts library and component dependencies from source code
 * Supports multiple languages via regex patterns
 */
export class DependencyExtractor {
  /**
   * Extract dependencies from a component source path
   */
  async extract(sourcePath: string, type: string): Promise<ExtractedDeps> {
    try {
      if (!existsSync(sourcePath)) {
        return { libraries: [], plugins: [] };
      }

      const isDirectory = type === 'skill';
      const files: string[] = [];

      if (isDirectory) {
        await this.collectSourceFiles(sourcePath, files);
      } else {
        files.push(sourcePath);
      }

      const libraries = new Map<string, LibraryDep>();
      const plugins: PluginDep[] = [];

      for (const filePath of files) {
        await this.analyzeFile(filePath, libraries, plugins);
      }

      if (isDirectory) {
        await analyzePackageFiles(sourcePath, libraries);
      }

      return { libraries: Array.from(libraries.values()), plugins };
    } catch (error) {
      console.error('Error extracting dependencies:', error);
      return { libraries: [], plugins: [] };
    }
  }

  /**
   * Collect all source files recursively from a directory
   */
  private async collectSourceFiles(dir: string, files: string[]): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name.startsWith('mod')) {
          continue;
        }
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await this.collectSourceFiles(fullPath, files);
        } else if (entry.isFile() && this.isSourceFile(entry.name)) {
          files.push(fullPath);
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  /**
   * Check if a file is a source file worth analyzing
   */
  private isSourceFile(filename: string): boolean {
    const sourceExtensions = [
      '.ts', '.tsx', '.js', '.jsx',
      '.py', '.go', '.rs',
      '.java', '.kt', '.cs',
      '.rb', '.php', '.swift',
    ];
    return sourceExtensions.some(ext => filename.endsWith(ext));
  }

  /**
   * Analyze a single file for library and plugin dependencies
   */
  private async analyzeFile(
    filePath: string,
    libraries: Map<string, LibraryDep>,
    plugins: PluginDep[]
  ): Promise<void> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const ext = filePath.split('.').pop() || '';
      const manager = this.inferManagerFromExtension(ext);
      extractLibraries(content, libraries, manager);
      extractComponents(content, plugins);
    } catch {
      // Skip files we can't read
    }
  }

  /**
   * Infer package manager from file extension
   */
  private inferManagerFromExtension(ext: string): LibraryDep['manager'] {
    const managerMap: Record<string, LibraryDep['manager']> = {
      ts: 'npm', tsx: 'npm', js: 'npm', jsx: 'npm',
      py: 'pip', go: 'go', rs: 'cargo',
      java: 'composer', kt: 'composer', cs: 'composer',
      rb: 'gem', php: 'composer', swift: 'composer',
    };
    return managerMap[ext] || 'npm';
  }
}

export const dependencyExtractor = new DependencyExtractor();
