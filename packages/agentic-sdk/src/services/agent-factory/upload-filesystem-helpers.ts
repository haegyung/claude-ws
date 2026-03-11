/**
 * Agent Factory upload filesystem helpers - move/copy directories and files,
 * preview directory contents, detect plugin type, extract markdown descriptions
 */
import { readFile, readdir, copyFile, mkdir } from 'fs/promises';
import { join, basename, dirname } from 'path';
import { existsSync } from 'fs';

export interface ExtractedItem {
  type: 'skill' | 'command' | 'agent' | 'agent_set' | 'unknown';
  sourcePath: string;
  targetPath: string;
  name: string;
  componentCount?: number;
}

export function detectPluginType(content: string, fileName: string): 'skill' | 'command' | 'agent' | 'unknown' {
  const lowerContent = content.toLowerCase();
  const lowerFileName = fileName.toLowerCase();

  const yamlMatch = content.match(/^---\n([\s\S]+?)\n---/);
  if (yamlMatch) {
    const yaml = yamlMatch[1].toLowerCase();
    if (yaml.includes('type:') && yaml.includes('skill')) return 'skill';
    if (yaml.includes('type:') && yaml.includes('command')) return 'command';
    if (yaml.includes('type:') && yaml.includes('agent')) return 'agent';
  }

  if (lowerContent.includes('@skill')) return 'skill';
  if (lowerContent.includes('@command')) return 'command';
  if (lowerContent.includes('@agent')) return 'agent';

  if (lowerFileName.includes('skill')) return 'skill';
  if (lowerFileName.includes('command')) return 'command';
  if (lowerFileName.includes('agent')) return 'agent';

  if (lowerContent.includes('skill_name') || lowerContent.includes('skill name')) return 'skill';
  if (lowerContent.includes('command_name') || lowerContent.includes('command name')) return 'command';
  if (lowerContent.includes('agent_name') || lowerContent.includes('agent name')) return 'agent';

  return 'command';
}

export function extractDescriptionFromMarkdown(content: string): string | null {
  const yamlMatch = content.match(/^---\n([\s\S]+?)\n---/);
  if (yamlMatch) {
    const yaml = yamlMatch[1];
    const descMatch = yaml.match(/description:\s*(.+)/i);
    if (descMatch) {
      return descMatch[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

export async function moveDirectory(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);

    if (entry.isDirectory()) {
      await moveDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, targetPath);
    }
  }
}

export async function moveDirectoryContents(
  sourceDir: string,
  targetDir: string,
  items: ExtractedItem[],
  type: 'skill' | 'command' | 'agent'
): Promise<void> {
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await moveDirectory(sourcePath, targetPath);
      items.push({ type, sourcePath, targetPath, name: entry.name });
    } else if (entry.isFile()) {
      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
      items.push({ type, sourcePath, targetPath, name: entry.name });
    }
  }
}

export async function processFile(
  filePath: string,
  agentFactoryDir: string,
  items: ExtractedItem[],
  parentDir?: string
): Promise<void> {
  const fileName = basename(filePath);
  if (!fileName.endsWith('.md')) return;

  const content = await readFile(filePath, 'utf-8');
  const type = detectPluginType(content, fileName);

  let targetPath: string;
  let targetName: string;

  if (type === 'skill') {
    targetName = parentDir || basename(filePath, '.md');
    targetPath = join(agentFactoryDir, 'skills', targetName, 'SKILL.md');
    await mkdir(dirname(targetPath), { recursive: true });
  } else {
    targetName = basename(filePath, '.md');
    const subdir = type === 'agent' ? 'agents' : 'commands';
    targetPath = join(agentFactoryDir, subdir, `${targetName}.md`);
  }

  await copyFile(filePath, targetPath);
  items.push({ type, sourcePath: filePath, targetPath, name: targetName });
}

export async function processDirectory(
  dirPath: string,
  agentFactoryDir: string,
  dirName: string,
  items: ExtractedItem[]
): Promise<void> {
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const entryPath = join(dirPath, entry.name);
    if (entry.isFile() && entry.name.endsWith('.md')) {
      await processFile(entryPath, agentFactoryDir, items, dirName);
    }
  }
}

export async function previewDirectory(
  dirPath: string,
  agentFactoryDir: string,
  dirName: string,
  items: ExtractedItem[]
): Promise<void> {
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const entryPath = join(dirPath, entry.name);
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const content = await readFile(entryPath, 'utf-8');
      const type = detectPluginType(content, entry.name);
      const targetName = basename(entryPath, '.md');
      let targetPath: string;

      if (type === 'skill') {
        targetPath = join(agentFactoryDir, 'skills', targetName, 'SKILL.md');
      } else {
        const subdir = type === 'agent' ? 'agents' : 'commands';
        targetPath = join(agentFactoryDir, subdir, `${targetName}.md`);
      }

      items.push({ type, sourcePath: entryPath, targetPath, name: targetName });
    }
  }
}

export async function previewDirectoryContents(
  sourceDir: string,
  targetDir: string,
  items: ExtractedItem[],
  type: 'skill' | 'command' | 'agent'
): Promise<void> {
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);

    if (entry.isDirectory()) {
      items.push({ type, sourcePath, targetPath, name: entry.name });
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      items.push({ type, sourcePath, targetPath, name: entry.name });
    }
  }
}
