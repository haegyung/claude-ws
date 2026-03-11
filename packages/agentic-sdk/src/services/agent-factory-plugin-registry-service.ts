/**
 * Agent Factory plugin registry service - CRUD for plugins, project associations,
 * dependencies, and filesystem discovery of .claude/agentfactory/ plugins
 */
import { eq, and } from 'drizzle-orm';
import fs from 'fs/promises';
import path from 'path';
import * as schema from '../db/database-schema.ts';
import { generateId } from '../lib/nanoid-id-generator.ts';

export function createAgentFactoryService(db: any) {
  return {
    async listPlugins(filters?: { type?: string; projectId?: string }) {
      if (filters?.projectId) {
        return this.listProjectPlugins(filters.projectId);
      }
      const query = db.select().from(schema.agentFactoryPlugins);
      if (filters?.type) {
        return query.where(eq(schema.agentFactoryPlugins.type, filters.type as any)).all();
      }
      return query.all();
    },

    async getPlugin(id: string) {
      return db.select().from(schema.agentFactoryPlugins)
        .where(eq(schema.agentFactoryPlugins.id, id)).get();
    },

    async createPlugin(data: {
      type: 'skill' | 'command' | 'agent' | 'agent_set';
      name: string;
      description?: string;
      sourcePath?: string;
      storageType?: 'local' | 'imported' | 'external';
      agentSetPath?: string;
      metadata?: string;
    }) {
      const id = generateId('plg');
      const now = Date.now();
      const record = {
        id,
        type: data.type,
        name: data.name,
        description: data.description || null,
        sourcePath: data.sourcePath || null,
        storageType: data.storageType || 'local' as const,
        agentSetPath: data.agentSetPath || null,
        metadata: data.metadata || null,
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(schema.agentFactoryPlugins).values(record);
      return record;
    },

    async updatePlugin(id: string, data: Partial<schema.AgentFactoryPlugin>) {
      await db.update(schema.agentFactoryPlugins)
        .set({ ...data, updatedAt: Date.now() })
        .where(eq(schema.agentFactoryPlugins.id, id));
      return this.getPlugin(id);
    },

    async deletePlugin(id: string) {
      await db.delete(schema.agentFactoryPlugins)
        .where(eq(schema.agentFactoryPlugins.id, id));
    },

    async listProjectPlugins(projectId: string) {
      return db.select({
        id: schema.agentFactoryPlugins.id,
        type: schema.agentFactoryPlugins.type,
        name: schema.agentFactoryPlugins.name,
        description: schema.agentFactoryPlugins.description,
        sourcePath: schema.agentFactoryPlugins.sourcePath,
        storageType: schema.agentFactoryPlugins.storageType,
        metadata: schema.agentFactoryPlugins.metadata,
        enabled: schema.projectPlugins.enabled,
      })
        .from(schema.projectPlugins)
        .innerJoin(
          schema.agentFactoryPlugins,
          eq(schema.projectPlugins.pluginId, schema.agentFactoryPlugins.id)
        )
        .where(eq(schema.projectPlugins.projectId, projectId))
        .all();
    },

    async associatePlugin(projectId: string, pluginId: string) {
      const id = generateId('pp');
      const record = { id, projectId, pluginId, enabled: true, createdAt: Date.now() };
      await db.insert(schema.projectPlugins).values(record);
      return record;
    },

    async disassociatePlugin(projectId: string, pluginId: string) {
      await db.delete(schema.projectPlugins).where(
        and(
          eq(schema.projectPlugins.projectId, projectId),
          eq(schema.projectPlugins.pluginId, pluginId)
        )
      );
    },

    async listDependencies(pluginId: string) {
      return db.select().from(schema.pluginDependencies)
        .where(eq(schema.pluginDependencies.pluginId, pluginId))
        .all();
    },

    async addDependency(pluginId: string, dep: { type: string; spec: string }) {
      const id = generateId('dep');
      const record = {
        id,
        pluginId,
        dependencyType: dep.type as any,
        spec: dep.spec,
        createdAt: Date.now(),
      };
      await db.insert(schema.pluginDependencies).values(record);
      return record;
    },

    async removeDependency(depId: string) {
      await db.delete(schema.pluginDependencies)
        .where(eq(schema.pluginDependencies.id, depId));
    },

    async getPluginFile(id: string) {
      const plugin = await this.getPlugin(id);
      if (!plugin?.sourcePath) return null;
      try {
        return await fs.readFile(plugin.sourcePath, 'utf-8');
      } catch {
        return null;
      }
    },

    async updatePluginFile(id: string, content: string) {
      const plugin = await this.getPlugin(id);
      if (!plugin?.sourcePath) return null;
      await fs.writeFile(plugin.sourcePath, content, 'utf-8');
      return { success: true };
    },

    async discoverPlugins(basePath: string) {
      const agentFactoryDir = path.join(basePath, '.claude', 'agentfactory');
      const discovered: Array<{ name: string; type: string; sourcePath: string }> = [];

      async function scanDir(dir: string, type: string) {
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              discovered.push({
                name: entry.name,
                type,
                sourcePath: path.join(dir, entry.name),
              });
            }
          }
        } catch { /* directory may not exist */ }
      }

      await Promise.all([
        scanDir(path.join(agentFactoryDir, 'skills'), 'skill'),
        scanDir(path.join(agentFactoryDir, 'commands'), 'command'),
        scanDir(path.join(agentFactoryDir, 'agents'), 'agent'),
      ]);

      return discovered;
    },
  };
}
