/**
 * Agent Factory install script templates service
 * Standalone generator functions for each package manager (npm, pnpm, yarn, pip, poetry, cargo, go)
 * Used by agent-factory-install-script-generator-service to delegate per-manager script generation
 */
import type { LibraryDep } from './dependency-extractor-parsers.ts';

/**
 * Validate and sanitize package name to prevent shell injection
 * Returns empty string if invalid
 */
function validatePackageName(name: string, manager: LibraryDep['manager']): string {
  if (!name || typeof name !== 'string') return '';
  const sanitized = name.trim().replace(/[;&|`$()<>]/g, '');

  const patterns: Record<LibraryDep['manager'], RegExp> = {
    npm: /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i,
    pnpm: /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i,
    yarn: /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i,
    pip: /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i,
    poetry: /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i,
    cargo: /^[a-z0-9_]+$/i,
    go: /^[a-z0-9._/-]+$/i,
    composer: /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?(\/[a-z0-9]([a-z0-9._-]*[a-z0-9])?)*$/i,
    gem: /^[a-z0-9]([a-z0-9_]*[a-z0-9])?$/i,
  };

  const pattern = patterns[manager];
  if (pattern && pattern.test(sanitized)) return sanitized;

  console.warn(`[InstallScriptTemplates] Invalid package name for ${manager}: ${name}`);
  return '';
}

/**
 * Validate and sanitize version string
 * Returns empty string if invalid
 */
function validateVersion(version: string | undefined, manager: LibraryDep['manager']): string {
  if (!version || typeof version !== 'string') return '';
  const sanitized = version.trim().replace(/[;&|`$()<>]/g, '');
  const allowedPattern = /^[\d.^~>=<!,:@\s"'\-]+$/;
  if (allowedPattern.test(sanitized)) return sanitized;
  console.warn(`[InstallScriptTemplates] Invalid version for ${manager}: ${version}`);
  return '';
}

/** Generate npm install script */
export function generateNpm(libraries: LibraryDep[]): string {
  const pkgs = libraries
    .filter(l => l.manager === 'npm')
    .map(l => {
      const name = validatePackageName(l.name, 'npm');
      if (!name) return '';
      const version = validateVersion(l.version, 'npm');
      return version ? `${name}@${version}` : name;
    })
    .filter(Boolean);

  if (pkgs.length === 0) return '';
  return `npm install --silent ${pkgs.join(' ')}`;
}

/** Generate pnpm add script */
export function generatePnpm(libraries: LibraryDep[]): string {
  const pkgs = libraries
    .filter(l => l.manager === 'npm' || l.manager === 'pnpm')
    .map(l => {
      const name = validatePackageName(l.name, 'npm');
      if (!name) return '';
      const version = validateVersion(l.version, 'npm');
      return version ? `${name}@${version}` : name;
    })
    .filter(Boolean);

  if (pkgs.length === 0) return '';
  return `pnpm add --silent ${pkgs.join(' ')}`;
}

/** Generate yarn add script */
export function generateYarn(libraries: LibraryDep[]): string {
  const pkgs = libraries
    .filter(l => l.manager === 'npm' || l.manager === 'yarn')
    .map(l => {
      const name = validatePackageName(l.name, 'npm');
      if (!name) return '';
      const version = validateVersion(l.version, 'npm');
      return version ? `${name}@${version}` : name;
    })
    .filter(Boolean);

  if (pkgs.length === 0) return '';
  return `yarn add --silent ${pkgs.join(' ')}`;
}

/** Generate pip install script */
export function generatePip(libraries: LibraryDep[]): string {
  const pkgs = libraries
    .filter(l => l.manager === 'pip')
    .map(l => {
      const name = validatePackageName(l.name, 'pip');
      if (!name) return '';
      const version = validateVersion(l.version, 'pip');
      return version ? `${name}${version}` : name;
    })
    .filter(Boolean);

  if (pkgs.length === 0) return '';
  return `pip install --quiet --disable-pip-version-check --no-warn-script-location ${pkgs.join(' ')}`;
}

/** Generate poetry add script */
export function generatePoetry(libraries: LibraryDep[]): string {
  const pkgs = libraries
    .filter(l => l.manager === 'pip' || l.manager === 'poetry')
    .map(l => {
      const name = validatePackageName(l.name, 'poetry');
      if (!name) return '';
      const version = validateVersion(l.version, 'poetry');
      return version ? `${name}="${version}"` : name;
    })
    .filter(Boolean);

  if (pkgs.length === 0) return '';
  return `poetry add --quiet ${pkgs.join(' ')}`;
}

/** Generate cargo Cargo.toml snippet + build command */
export function generateCargo(libraries: LibraryDep[]): string {
  const pkgs = libraries
    .filter(l => l.manager === 'cargo')
    .map(l => {
      const name = validatePackageName(l.name, 'cargo');
      if (!name) return '';
      const version = validateVersion(l.version, 'cargo');
      return version ? `${name} = "${version}"` : name;
    })
    .filter(Boolean);

  if (pkgs.length === 0) return '';
  return `# Add to Cargo.toml:\n[dependencies]\n${pkgs.join('\n')}\n\n# Then run:\ncargo build --quiet`;
}

/** Generate go get script */
export function generateGo(libraries: LibraryDep[]): string {
  const pkgs = libraries
    .filter(l => l.manager === 'go')
    .map(l => {
      const name = validatePackageName(l.name, 'go');
      if (!name) return '';
      const version = validateVersion(l.version, 'go');
      return version ? `${name}@${version}` : name;
    })
    .filter(Boolean);

  if (pkgs.length === 0) return '';
  return `go get ${pkgs.join(' ')} && go mod tidy`;
}
