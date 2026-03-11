/**
 * Agent Factory install script generator service
 * Orchestrates generation of installation scripts for all supported package managers and Docker
 * Delegates per-manager script generation to agent-factory-install-script-templates-service
 */
import type { LibraryDep } from './dependency-extractor-parsers.ts';
import {
  generateNpm,
  generatePnpm,
  generateYarn,
  generatePip,
  generatePoetry,
  generateCargo,
  generateGo,
} from './install-script-templates.ts';

export type { LibraryDep };

export interface GeneratedScripts {
  npm?: string;
  pnpm?: string;
  yarn?: string;
  pip?: string;
  poetry?: string;
  cargo?: string;
  go?: string;
  dockerfile?: string;
}

/**
 * Install Script Generator Service
 * Generates installation scripts for multiple package managers and Docker
 */
export class InstallScriptGenerator {
  /**
   * Generate all scripts for the given libraries
   */
  generateAll(libraries: LibraryDep[]): GeneratedScripts {
    return {
      npm: generateNpm(libraries),
      pnpm: generatePnpm(libraries),
      yarn: generateYarn(libraries),
      pip: generatePip(libraries),
      poetry: generatePoetry(libraries),
      cargo: generateCargo(libraries),
      go: generateGo(libraries),
    };
  }

  /**
   * Generate Dockerfile for a component based on its library dependencies
   */
  generateDockerfile(libraries: LibraryDep[], componentName: string): string {
    const hasNpm = libraries.some(l => l.manager === 'npm' || l.manager === 'pnpm' || l.manager === 'yarn');
    const hasPip = libraries.some(l => l.manager === 'pip' || l.manager === 'poetry');
    const hasCargo = libraries.some(l => l.manager === 'cargo');
    const hasGo = libraries.some(l => l.manager === 'go');

    let baseImage = 'alpine:latest';
    let installCmd = '';
    let runCmd = '';

    if (hasNpm) {
      baseImage = 'node:20-alpine';
      installCmd = 'npm ci';
      runCmd = 'node index.js';
    } else if (hasPip) {
      baseImage = 'python:3.12-alpine';
      installCmd = 'pip install -r requirements.txt';
      runCmd = 'python main.py';
    } else if (hasGo) {
      baseImage = 'golang:1.21-alpine';
      installCmd = 'go mod download';
      runCmd = 'go run .';
    } else if (hasCargo) {
      baseImage = 'rust:1.75-alpine';
      installCmd = 'cargo build --release';
      runCmd = './target/release/app';
    }

    let dockerfile = `FROM ${baseImage}\n\nWORKDIR /app\n\n`;

    if (hasNpm) {
      dockerfile += `# Copy package files\nCOPY package*.json ./\n\n# Install dependencies\nRUN ${installCmd}\n\n`;
    }
    if (hasPip) {
      dockerfile += `# Copy Python requirements\nCOPY requirements.txt ./\n\n# Install Python dependencies\nRUN ${installCmd}\n\n`;
    }
    if (hasGo) {
      dockerfile += `# Copy go.mod\nCOPY go.mod go.sum* ./\n\n# Download Go dependencies\nRUN ${installCmd}\n\n`;
    }
    if (hasCargo) {
      dockerfile += `# Copy Cargo.toml\nCOPY Cargo.toml Cargo.lock* ./\n\n# Build Rust project\nRUN ${installCmd}\n\n`;
    }

    dockerfile += `# Copy source code\nCOPY . .\n\n`;

    if (runCmd) {
      const parts = runCmd.split(' ');
      dockerfile += `CMD ["${parts[0]}", "${parts.slice(1).join(' ')}"]\n`;
    }

    return dockerfile;
  }

  /**
   * Generate composite install script for multi-language projects
   */
  generateComposite(libraries: LibraryDep[]): string {
    const scripts: string[] = [];

    const npmScript = generateNpm(libraries);
    if (npmScript) scripts.push(`  ${npmScript}`);

    const pipScript = generatePip(libraries);
    if (pipScript) scripts.push(`  ${pipScript}`);

    const goScript = generateGo(libraries);
    if (goScript) scripts.push(`  ${goScript}`);

    if (scripts.length === 0) return '';
    return `#!/bin/bash\nset -e\n\n# Install dependencies\n${scripts.join('\n')}`;
  }
}

export const installScriptGenerator = new InstallScriptGenerator();
