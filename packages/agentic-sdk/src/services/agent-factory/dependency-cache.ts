/**
 * Agent Factory dependency cache service
 * Caches resolved plugin dependency data in the database to avoid re-analysis on every request
 * Uses factory pattern for db injection — call createDependencyCacheService(db, schema)
 */
import { createHash } from 'crypto';
import { readFile, stat } from 'fs/promises';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

export interface LibraryDep {
  name: string;
  version?: string;
  manager: 'npm' | 'pnpm' | 'yarn' | 'pip' | 'poetry' | 'cargo' | 'go' | 'composer' | 'gem';
}

export interface PluginDep {
  type: 'skill' | 'command' | 'agent';
  name: string;
}

export interface CachedDependencyData {
  id: string;
  pluginId?: string;
  sourcePath?: string;
  type: string;
  libraryDeps: LibraryDep[];
  pluginDeps: PluginDep[];
  installScriptNpm?: string;
  installScriptPnpm?: string;
  installScriptYarn?: string;
  installScriptPip?: string;
  installScriptPoetry?: string;
  installScriptCargo?: string;
  installScriptGo?: string;
  dockerfile?: string;
  depth: number;
  hasCycles: boolean;
  resolvedAt: number;
}

function parseFromDb(row: any): CachedDependencyData {
  return {
    id: row.id,
    pluginId: row.pluginId || undefined,
    sourcePath: row.sourcePath || undefined,
    type: row.type,
    libraryDeps: JSON.parse(row.libraryDeps || '[]'),
    pluginDeps: JSON.parse(row.pluginDeps || '[]'),
    installScriptNpm: row.installScriptNpm || undefined,
    installScriptPnpm: row.installScriptPnpm || undefined,
    installScriptYarn: row.installScriptYarn || undefined,
    installScriptPip: row.installScriptPip || undefined,
    installScriptPoetry: row.installScriptPoetry || undefined,
    installScriptCargo: row.installScriptCargo || undefined,
    installScriptGo: row.installScriptGo || undefined,
    dockerfile: row.dockerfile || undefined,
    depth: row.depth,
    hasCycles: !!row.hasCycles,
    resolvedAt: row.resolvedAt,
  };
}

/**
 * Compute hash of source file or directory for cache invalidation
 */
async function computeFileHash(sourcePath: string): Promise<string> {
  try {
    const stats = await stat(sourcePath);
    if (stats.isDirectory()) {
      const hashInput = `dir:${sourcePath}-${stats.mtimeMs}-${stats.size}`;
      return createHash('sha256').update(hashInput).digest('hex');
    } else {
      const content = await readFile(sourcePath, 'utf-8');
      const hashInput = `${content}-${stats.mtimeMs}-${stats.size}`;
      return createHash('sha256').update(hashInput).digest('hex');
    }
  } catch {
    return createHash('sha256').update(sourcePath).digest('hex');
  }
}

/**
 * Factory function — creates a DependencyCacheService bound to the provided db and schema
 */
export function createDependencyCacheService(db: any, schema: any) {
  const table = schema.pluginDependencyCache;

  return {
    /** Get cached dependency data by plugin ID */
    async getByPluginId(pluginId: string): Promise<CachedDependencyData | null> {
      const [cached] = await db.select().from(table).where(eq(table.pluginId, pluginId)).limit(1);
      return cached ? parseFromDb(cached) : null;
    },

    /** Get cached dependency data by source path, invalidates if hash changed */
    async getBySourcePath(sourcePath: string): Promise<CachedDependencyData | null> {
      const [cached] = await db.select().from(table).where(eq(table.sourcePath, sourcePath)).limit(1);
      if (!cached) return null;

      const currentHash = await computeFileHash(sourcePath);
      if (cached.sourceHash !== currentHash) {
        await db.delete(table).where(eq(table.id, cached.id));
        return null;
      }

      return parseFromDb(cached);
    },

    /** Store dependency data in cache */
    async set(data: Omit<CachedDependencyData, 'id'> & { id?: string }): Promise<string> {
      const sourceHash = data.sourcePath ? await computeFileHash(data.sourcePath) : null;
      const id = data.id || nanoid();

      const insertData: Record<string, any> = {
        id,
        pluginId: data.pluginId || null,
        sourcePath: data.sourcePath || null,
        sourceHash,
        type: data.type,
        libraryDeps: JSON.stringify(data.libraryDeps),
        pluginDeps: JSON.stringify(data.pluginDeps),
        installScriptNpm: data.installScriptNpm || null,
        installScriptPnpm: data.installScriptPnpm || null,
        installScriptYarn: data.installScriptYarn || null,
        installScriptPip: data.installScriptPip || null,
        installScriptPoetry: data.installScriptPoetry || null,
        installScriptCargo: data.installScriptCargo || null,
        installScriptGo: data.installScriptGo || null,
        dockerfile: data.dockerfile || null,
        depth: data.depth,
        hasCycles: data.hasCycles ? 1 : 0,
        resolvedAt: data.resolvedAt,
      };

      await db.insert(table).values(insertData as any);
      return id;
    },

    /** Invalidate a cache entry by ID */
    async invalidate(id: string): Promise<void> {
      await db.delete(table).where(eq(table.id, id));
    },

    /** Invalidate all cache entries for a plugin */
    async invalidateByPluginId(pluginId: string): Promise<void> {
      await db.delete(table).where(eq(table.pluginId, pluginId));
    },

    /** Invalidate all cache entries for a source path */
    async invalidateBySourcePath(sourcePath: string): Promise<void> {
      await db.delete(table).where(eq(table.sourcePath, sourcePath));
    },

    /** Compute file hash (exposed for external use) */
    computeFileHash,
  };
}

export type DependencyCacheService = ReturnType<typeof createDependencyCacheService>;
