/**
 * Agent Factory dependency extractor parsers service
 * Standalone parsing functions for extracting libraries and plugin deps from source content
 */
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export interface LibraryDep {
  name: string;
  version?: string;
  manager: 'npm' | 'pnpm' | 'yarn' | 'pip' | 'poetry' | 'cargo' | 'go' | 'composer' | 'gem';
}

export interface PluginDep {
  type: 'skill' | 'command' | 'agent';
  name: string;
}

/**
 * Extract library dependencies from source content using regex patterns
 */
export function extractLibraries(
  content: string,
  libraries: Map<string, LibraryDep>,
  defaultManager: LibraryDep['manager']
): void {
  const patterns = [
    // ES6 imports
    /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g,
    // CommonJS require
    /require\(['"]([^'"]+)['"]\)/g,
    // Python imports
    /^from\s+(\S+)\s+import/gm,
    /^import\s+(\S+)/gm,
    // Go imports
    /import\s+(?:(?:"([^"]+)"|'([^']+)')|(\w+\s+"([^"]+)"))/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      let dep = match[1] || match[2] || match[3] || match[4] || '';
      if (!dep) continue;

      // Skip relative imports
      if (dep.startsWith('.') || dep.startsWith('/')) continue;

      // Clean up the dependency name
      dep = dep.split('/')[0].replace('@', '');

      let manager = defaultManager;
      if (dep.startsWith('@')) {
        manager = 'npm';
      }

      const key = `${manager}:${dep}`;
      if (!libraries.has(key)) {
        libraries.set(key, { name: dep, manager });
      }
    }
  }
}

/**
 * Extract plugin component dependencies (skills, commands, agents) from content
 */
export function extractComponents(content: string, plugins: PluginDep[]): void {
  const patterns = [
    /skill:\s*['"]([^'"]+)['"]/gi,
    /command:\s*['"]([^'"]+)['"]/gi,
    /agent:\s*['"]([^'"]+)['"]/gi,
    /use(Skill|Command|Agent)\(['"]([^'"]+)['"]\)/g,
    /\/(skill|command|agent):([a-zA-Z0-9_-]+)/g,
  ];

  const seen = new Set<string>();

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      let type: 'skill' | 'command' | 'agent' | undefined;
      let name = '';

      if (match[1] && ['skill', 'command', 'agent'].includes(match[1].toLowerCase())) {
        type = match[1].toLowerCase() as 'skill' | 'command' | 'agent';
        name = match[2];
      } else if (match[3] && ['skill', 'command', 'agent'].includes(match[3].toLowerCase())) {
        type = match[3].toLowerCase() as 'skill' | 'command' | 'agent';
        name = match[4];
      } else if (match[5] && ['skill', 'command', 'agent'].includes(match[5].toLowerCase())) {
        type = match[5].toLowerCase() as 'skill' | 'command' | 'agent';
        name = match[6];
      }

      if (!type || !name) continue;

      const key = `${type}:${name}`;
      if (!seen.has(key)) {
        seen.add(key);
        plugins.push({ type, name });
      }
    }
  }
}

/**
 * Analyze package manager files (package.json, requirements.txt, go.mod, Cargo.toml)
 * and merge found dependencies into the libraries map
 */
export async function analyzePackageFiles(
  sourcePath: string,
  libraries: Map<string, LibraryDep>
): Promise<void> {
  // package.json
  const packageJsonPath = join(sourcePath, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const content = await readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);

      if (pkg.dependencies) {
        for (const [name, version] of Object.entries(pkg.dependencies)) {
          libraries.set(`npm:${name}`, { name, version: version as string, manager: 'npm' });
        }
      }
      if (pkg.devDependencies) {
        for (const [name, version] of Object.entries(pkg.devDependencies)) {
          const key = `npm:${name}`;
          if (!libraries.has(key)) {
            libraries.set(key, { name, version: version as string, manager: 'npm' });
          }
        }
      }
    } catch { /* skip */ }
  }

  // requirements.txt
  const requirementsPath = join(sourcePath, 'requirements.txt');
  if (existsSync(requirementsPath)) {
    try {
      const content = await readFile(requirementsPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([a-zA-Z0-9_-]+)([~>=<!]+)?(.+)?/);
        if (match) {
          libraries.set(`pip:${match[1]}`, {
            name: match[1],
            version: match[2] && match[3] ? `${match[2]}${match[3]}` : undefined,
            manager: 'pip',
          });
        }
      }
    } catch { /* skip */ }
  }

  // go.mod
  const goModPath = join(sourcePath, 'go.mod');
  if (existsSync(goModPath)) {
    try {
      const content = await readFile(goModPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('require ')) {
          const match = trimmed.match(/require\s+(\S+)\s+(.+)?/);
          if (match) {
            libraries.set(`go:${match[1]}`, { name: match[1], version: match[2], manager: 'go' });
          }
        }
      }
    } catch { /* skip */ }
  }

  // Cargo.toml
  const cargoPath = join(sourcePath, 'Cargo.toml');
  if (existsSync(cargoPath)) {
    try {
      const content = await readFile(cargoPath, 'utf-8');
      const depsMatch = content.match(/\[dependencies\]([\s\S]*?)(?=\[|$)/);
      if (depsMatch) {
        for (const line of depsMatch[1].split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const match = trimmed.match(/^(\w+)(\s*=\s*)?(.+)?/);
          if (match) {
            libraries.set(`cargo:${match[1]}`, { name: match[1], version: match[3], manager: 'cargo' });
          }
        }
      }
    } catch { /* skip */ }
  }
}
