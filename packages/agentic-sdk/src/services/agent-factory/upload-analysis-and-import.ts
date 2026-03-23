/**
 * Agent Factory upload analysis and import service - analyzes extracted archives,
 * organizes components into skills/commands/agents, and imports sessions into the filesystem
 */
import { readFile, readdir, copyFile, mkdir, unlink } from 'fs/promises';
import { join, basename, dirname } from 'path';
import { existsSync } from 'fs';
import {
  type ExtractedItem,
  detectPluginType,
  extractDescriptionFromMarkdown,
  moveDirectory,
  moveDirectoryContents,
  processFile,
  processDirectory,
  previewDirectory,
  previewDirectoryContents,
} from './upload-filesystem-helpers';

export type { ExtractedItem };

export interface UploadSession {
  extractDir: string;
  items: ExtractedItem[];
  createdAt: number;
}

/** Analyze extracted archive for preview without moving files */
export async function analyzeForPreview(extractDir: string, agentFactoryDir: string): Promise<ExtractedItem[]> {
  const items: ExtractedItem[] = [];
  const entries = await readdir(extractDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const entryPath = join(extractDir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'skills' || entry.name === 'commands' || entry.name === 'agents') {
        const componentType = entry.name === 'skills'
          ? 'skill'
          : entry.name === 'commands'
            ? 'command'
            : 'agent';
        await previewDirectoryContents(entryPath, agentFactoryDir, items, componentType);
      } else {
        const subEntries = await readdir(entryPath, { withFileTypes: true });
        const hasSubdirs = subEntries.some(e =>
          e.isDirectory() && (e.name === 'skills' || e.name === 'commands' || e.name === 'agents')
        );

        if (hasSubdirs) {
          const agentSetName = entry.name;
          let componentCount = 0;

          for (const subEntry of subEntries) {
            if (subEntry.name.startsWith('.')) continue;
            if (subEntry.isDirectory() && (subEntry.name === 'skills' || subEntry.name === 'commands' || subEntry.name === 'agents')) {
              const subEntryPath = join(entryPath, subEntry.name);
              const subDirEntries = await readdir(subEntryPath, { withFileTypes: true });
              componentCount += subDirEntries.filter(e => !e.name.startsWith('.')).length;
            }
          }

          items.push({
            type: 'agent_set',
            sourcePath: entryPath,
            targetPath: join(agentFactoryDir, 'agent-sets', agentSetName),
            name: agentSetName,
            componentCount
          });
        } else {
          const skillMdPath = join(entryPath, 'SKILL.md');
          if (existsSync(skillMdPath)) {
            items.push({
              type: 'skill',
              sourcePath: entryPath,
              targetPath: join(agentFactoryDir, 'skills', entry.name, 'SKILL.md'),
              name: entry.name
            });
          } else {
            await previewDirectory(entryPath, agentFactoryDir, entry.name, items);
          }
        }
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
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

  return items;
}

/** Analyze extracted archive and move files into agentFactoryDir immediately */
export async function analyzeAndOrganize(extractDir: string, agentFactoryDir: string): Promise<ExtractedItem[]> {
  const items: ExtractedItem[] = [];
  const entries = await readdir(extractDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const entryPath = join(extractDir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'skills' || entry.name === 'commands' || entry.name === 'agents') {
        const componentType = entry.name === 'skills'
          ? 'skill'
          : entry.name === 'commands'
            ? 'command'
            : 'agent';
        await moveDirectoryContents(entryPath, agentFactoryDir, items, componentType);
      } else {
        const subEntries = await readdir(entryPath, { withFileTypes: true });
        const hasSubdirs = subEntries.some(e =>
          e.isDirectory() && (e.name === 'skills' || e.name === 'commands' || e.name === 'agents')
        );

        if (hasSubdirs) {
          const agentSetName = entry.name;
          const targetPath = join(agentFactoryDir, 'agent-sets', agentSetName);
          await mkdir(dirname(targetPath), { recursive: true });
          await moveDirectory(entryPath, targetPath);
          items.push({ type: 'agent_set', sourcePath: entryPath, targetPath, name: agentSetName });
        } else {
          const skillMdPath = join(entryPath, 'SKILL.md');
          if (existsSync(skillMdPath)) {
            const targetPath = join(agentFactoryDir, 'skills', entry.name);
            await moveDirectory(entryPath, targetPath);
            items.push({
              type: 'skill',
              sourcePath: entryPath,
              targetPath: join(targetPath, 'SKILL.md'),
              name: entry.name
            });
          } else {
            await processDirectory(entryPath, agentFactoryDir, entry.name, items);
          }
        }
      }
    } else if (entry.isFile()) {
      await processFile(entryPath, agentFactoryDir, items);
    }
  }

  return items;
}

/** Import a confirmed upload session into the target directory and register in the database */
export async function importFromSession(
  session: UploadSession,
  targetBaseDir: string,
  globalImport: boolean,
  registryService: {
    upsertPlugin: (name: string, type: string, data: Record<string, unknown>) => Promise<unknown>;
  },
  cleanupDirectory: (dirPath: string) => Promise<void>
): Promise<ExtractedItem[]> {
  const importedItems: ExtractedItem[] = [];

  for (const item of session.items) {
    let targetPath: string;
    if (item.type === 'agent_set') {
      targetPath = join(targetBaseDir, 'agent-sets', item.name);
    } else if (item.type === 'skill') {
      targetPath = join(targetBaseDir, 'skills', item.relativePath || item.name, 'SKILL.md');
    } else if (item.type === 'agent') {
      targetPath = join(targetBaseDir, 'agents', item.relativePath || `${item.name}.md`);
    } else {
      targetPath = join(targetBaseDir, 'commands', item.relativePath || `${item.name}.md`);
    }

    if (item.type === 'agent_set') {
      await cleanupDirectory(targetPath).catch(() => {});
      await mkdir(dirname(targetPath), { recursive: true });
      await moveDirectory(item.sourcePath, targetPath);

      if (!globalImport) {
        const description = `Agent set containing ${item.componentCount || 0} component(s)`;
        await registryService.upsertPlugin(item.name, 'agent_set', {
          description,
          agentSetPath: targetPath,
          storageType: 'imported',
        });
      }
    } else {
      let mdPath: string;
      if (item.type === 'skill') {
        const skillDir = dirname(targetPath);
        await cleanupDirectory(skillDir).catch(() => {});
        await mkdir(skillDir, { recursive: true });
        await moveDirectory(item.sourcePath, skillDir);
        mdPath = targetPath;
      } else {
        await mkdir(dirname(targetPath), { recursive: true });
        await unlink(targetPath).catch(() => {});
        await copyFile(item.sourcePath, targetPath);
        mdPath = targetPath;
      }

      if (!globalImport) {
        let description: string | null = null;
        try {
          const content = await readFile(mdPath, 'utf-8');
          description = extractDescriptionFromMarkdown(content);
        } catch { /* ignore */ }

        const componentType = item.type === 'skill'
          ? 'skill'
          : item.type === 'agent'
            ? 'agent'
            : 'command';
        await registryService.upsertPlugin(item.name, componentType, {
          description,
          sourcePath: targetPath,
          storageType: 'imported',
        });
      }
    }

    importedItems.push({ ...item, targetPath });
  }

  return importedItems;
}
