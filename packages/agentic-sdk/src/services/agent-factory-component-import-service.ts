/**
 * Agent Factory component import service - copies component files to agent-factory directory
 * and registers them in the database
 */
import { readFile, writeFile, mkdir, cp } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { getAgentFactoryDir } from './agent-factory-dir-resolver-service';

export function createAgentFactoryImportService(db: any, registryService: any) {
  return {
    /** Import a component: copy files to agent-factory dir and register in DB */
    async importComponent(params: {
      type: string;
      name: string;
      description?: string;
      sourcePath: string;
      metadata?: Record<string, unknown>;
    }) {
      const { type, name, sourcePath, description, metadata } = params;

      if (!existsSync(sourcePath)) {
        throw new ImportError('Source path does not exist', 404);
      }

      const agentFactoryDir = getAgentFactoryDir();
      const typeDir = join(agentFactoryDir, `${type}s`);
      if (!existsSync(typeDir)) await mkdir(typeDir, { recursive: true });

      let targetPath: string;
      if (type === 'skill') {
        targetPath = join(typeDir, name);
        await cp(sourcePath, targetPath, { recursive: true });
      } else {
        const fileName = sourcePath.split('/').pop()!;
        targetPath = join(typeDir, fileName);
        await writeFile(targetPath, await readFile(sourcePath, 'utf-8'), 'utf-8');
      }

      const component = await registryService.createPlugin({
        type,
        name,
        description: description || undefined,
        sourcePath: targetPath,
        storageType: 'imported',
        metadata: metadata ? JSON.stringify(metadata) : undefined,
      });

      return component;
    },
  };
}

export class ImportError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'ImportError';
  }
}
