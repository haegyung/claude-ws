/**
 * Agent Factory plugin registry service - CRUD for plugins, project associations,
 * dependencies, and filesystem discovery of .claude/agentfactory/ plugins
 */
import { eq, and, inArray, desc } from 'drizzle-orm';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import * as schema from '../db/database-schema.ts';
import { generateId } from '../lib/nanoid-id-generator.ts';

export function createAgentFactoryService(db: any) {
  return {
    async listPlugins(filters?: { type?: string; orderByDesc?: boolean }) {
      let query = db.select().from(schema.agentFactoryPlugins);
      if (filters?.type) {
        query = query.where(eq(schema.agentFactoryPlugins.type, filters.type as any));
      }
      if (filters?.orderByDesc) {
        query = query.orderBy(desc(schema.agentFactoryPlugins.createdAt));
      }
      return query.all();
    },

    async getPlugin(id: string) {
      return db.select().from(schema.agentFactoryPlugins)
        .where(eq(schema.agentFactoryPlugins.id, id)).get();
    },

    async findPlugin(name: string, type: string) {
      return db.select().from(schema.agentFactoryPlugins)
        .where(and(eq(schema.agentFactoryPlugins.name, name), eq(schema.agentFactoryPlugins.type, type as any)))
        .get();
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

    async upsertPlugin(name: string, type: string, updateData: {
      description?: string | null;
      sourcePath?: string | null;
      agentSetPath?: string | null;
      storageType?: 'local' | 'imported' | 'external';
    }) {
      const now = Date.now();
      const existing = await this.findPlugin(name, type);
      if (existing) {
        await db.update(schema.agentFactoryPlugins)
          .set({ ...updateData, updatedAt: now })
          .where(eq(schema.agentFactoryPlugins.id, existing.id));
        return this.getPlugin(existing.id);
      }
      const id = generateId('plg');
      const record = {
        id, type: type as any, name,
        description: updateData.description || null,
        sourcePath: updateData.sourcePath || null,
        storageType: updateData.storageType || 'imported' as const,
        agentSetPath: updateData.agentSetPath || null,
        metadata: null, createdAt: now, updatedAt: now,
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

    async deletePlugins(ids: string[]) {
      if (ids.length === 0) return;
      await db.delete(schema.agentFactoryPlugins)
        .where(inArray(schema.agentFactoryPlugins.id, ids));
    },

    async listProjectPlugins(projectId: string) {
      return db.select({
        id: schema.agentFactoryPlugins.id,
        type: schema.agentFactoryPlugins.type,
        name: schema.agentFactoryPlugins.name,
        description: schema.agentFactoryPlugins.description,
        sourcePath: schema.agentFactoryPlugins.sourcePath,
        agentSetPath: schema.agentFactoryPlugins.agentSetPath,
        storageType: schema.agentFactoryPlugins.storageType,
        metadata: schema.agentFactoryPlugins.metadata,
        createdAt: schema.agentFactoryPlugins.createdAt,
        updatedAt: schema.agentFactoryPlugins.updatedAt,
        assignmentId: schema.projectPlugins.id,
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

    async findProjectPlugin(projectId: string, pluginId: string) {
      return db.select().from(schema.projectPlugins)
        .where(and(eq(schema.projectPlugins.projectId, projectId), eq(schema.projectPlugins.pluginId, pluginId)))
        .get();
    },

    async associatePlugin(projectId: string, pluginId: string, enabled = true) {
      const id = generateId('pp');
      const record = { id, projectId, pluginId, enabled, createdAt: Date.now() };
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

    async getDependency(id: string) {
      return db.select().from(schema.pluginDependencies)
        .where(eq(schema.pluginDependencies.id, id))
        .get();
    },

    async addDependency(pluginId: string, dep: { type: string; spec: string }) {
      const id = generateId('dep');
      const record = {
        id, pluginId, dependencyType: dep.type as any,
        spec: dep.spec, createdAt: Date.now(),
      };
      await db.insert(schema.pluginDependencies).values(record);
      return record;
    },

    async markDependencyInstalled(id: string) {
      await db.update(schema.pluginDependencies)
        .set({ installed: true })
        .where(eq(schema.pluginDependencies.id, id));
    },

    async removeDependency(depId: string) {
      await db.delete(schema.pluginDependencies)
        .where(eq(schema.pluginDependencies.id, depId));
    },

    async getPluginFile(id: string) {
      const plugin = await this.getPlugin(id);
      if (!plugin?.sourcePath) return null;
      try { return await fs.readFile(plugin.sourcePath, 'utf-8'); }
      catch { return null; }
    },

    async updatePluginFile(id: string, content: string) {
      const plugin = await this.getPlugin(id);
      if (!plugin?.sourcePath) return null;
      await fs.writeFile(plugin.sourcePath, content, 'utf-8');
      return { success: true };
    },

    async listImportedPlugins() {
      return db.select().from(schema.agentFactoryPlugins)
        .where(eq(schema.agentFactoryPlugins.storageType, 'imported'))
        .all();
    },

    async discoverPlugins(basePath: string) {
      const agentFactoryDir = path.join(basePath, '.claude', 'agentfactory');
      const discovered: Array<{ name: string; type: string; sourcePath: string }> = [];
      async function scanDir(dir: string, type: string) {
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              discovered.push({ name: entry.name, type, sourcePath: path.join(dir, entry.name) });
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

    /** Check if a plugin's source file/dir exists on disk */
    pluginSourceExists(plugin: { type: string; sourcePath: string | null; agentSetPath?: string | null }): boolean {
      if (plugin.type === 'agent_set') {
        return !!(plugin.agentSetPath && existsSync(plugin.agentSetPath));
      }
      return !!(plugin.sourcePath && existsSync(plugin.sourcePath));
    },
  };
}
