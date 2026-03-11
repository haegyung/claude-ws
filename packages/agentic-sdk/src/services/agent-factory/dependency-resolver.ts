/**
 * Agent Factory dependency resolver service
 * Recursively resolves plugin component dependencies with cycle detection and depth limiting
 * Uses factory pattern for db injection — call createDependencyResolverService(db, schema)
 */
import { eq, and } from 'drizzle-orm';
import { dependencyExtractor } from './dependency-extractor.ts';
import type { LibraryDep, PluginDep } from './dependency-extractor-parsers.ts';

export type { LibraryDep, PluginDep };

export interface ResolveOptions {
  maxDepth?: number;
  currentDepth?: number;
  visited?: Set<string>;
}

export interface ResolvedComponent {
  type: 'skill' | 'command' | 'agent';
  name: string;
  depth: number;
  cycle?: boolean;
  missing?: boolean;
  truncated?: boolean;
  children?: ResolvedComponent[];
}

export interface ResolvedDependencyTree {
  root: { type: string; name: string };
  libraries: LibraryDep[];
  components: ResolvedComponent[];
  maxDepth: number;
  hasCycles: boolean;
  totalComponents: number;
  allLibraries: LibraryDep[];
  componentMap: Map<string, PluginDep>;
}

const DEFAULT_MAX_DEPTH = 5;

function calculateMaxDepth(components: ResolvedComponent[]): number {
  let max = 0;
  for (const comp of components) {
    if (comp.depth > max) max = comp.depth;
    if (comp.children) {
      const childMax = calculateMaxDepth(comp.children);
      if (childMax > max) max = childMax;
    }
  }
  return max;
}

function countComponents(components: ResolvedComponent[]): number {
  let count = components.length;
  for (const comp of components) {
    if (comp.children) count += countComponents(comp.children);
  }
  return count;
}

/**
 * Factory function — creates a DependencyResolver bound to the provided db and schema
 */
export function createDependencyResolverService(db: any, schema: any) {
  const table = schema.agentFactoryPlugins;

  async function findComponent(dep: PluginDep): Promise<{
    id: string; type: string; name: string; sourcePath: string | null;
  } | null> {
    try {
      const [component] = await db
        .select({
          id: table.id,
          type: table.type,
          name: table.name,
          sourcePath: table.sourcePath,
        })
        .from(table)
        .where(and(eq(table.name, dep.name), eq(table.type, dep.type)))
        .limit(1);
      return component || null;
    } catch {
      return null;
    }
  }

  async function resolveComponents(
    componentDeps: PluginDep[],
    options: ResolveOptions,
    allLibraries: Map<string, LibraryDep>,
    allComponents: Map<string, PluginDep>,
    hasCycles: Set<string>
  ): Promise<ResolvedComponent[]> {
    const { maxDepth = DEFAULT_MAX_DEPTH, currentDepth = 0, visited = new Set() } = options;
    const resolved: ResolvedComponent[] = [];

    for (const compDep of componentDeps) {
      const key = `${compDep.type}-${compDep.name}`;
      allComponents.set(key, compDep);

      if (currentDepth >= maxDepth) {
        resolved.push({ ...compDep, depth: currentDepth, truncated: true });
        continue;
      }

      if (visited.has(key)) {
        hasCycles.add(key);
        resolved.push({ ...compDep, depth: currentDepth, cycle: true });
        continue;
      }

      const component = await findComponent(compDep);

      if (!component) {
        resolved.push({ ...compDep, depth: currentDepth, missing: true });
        continue;
      }

      if (component.sourcePath === null) {
        resolved.push({ ...compDep, depth: currentDepth, children: [] });
        continue;
      }

      const deps = await dependencyExtractor.extract(component.sourcePath, component.type);

      for (const lib of deps.libraries) {
        const libKey = `${lib.manager}:${lib.name}`;
        if (!allLibraries.has(libKey)) allLibraries.set(libKey, lib);
      }

      const newVisited = new Set(visited);
      newVisited.add(key);

      const children = await resolveComponents(
        deps.plugins,
        { maxDepth, currentDepth: currentDepth + 1, visited: newVisited },
        allLibraries,
        allComponents,
        hasCycles
      );

      resolved.push({
        ...compDep,
        depth: currentDepth,
        children: children.length > 0 ? children : undefined,
      });
    }

    return resolved;
  }

  return {
    /**
     * Resolve full dependency tree for a component
     */
    async resolve(
      component: { id: string; type: string; name: string; sourcePath: string },
      options: ResolveOptions = {}
    ): Promise<ResolvedDependencyTree> {
      const { maxDepth = DEFAULT_MAX_DEPTH, currentDepth = 0, visited = new Set() } = options;

      const allLibraries = new Map<string, LibraryDep>();
      const allComponents = new Map<string, PluginDep>();
      const hasCycles = new Set<string>();

      const rootDeps = await dependencyExtractor.extract(component.sourcePath, component.type);

      for (const lib of rootDeps.libraries) {
        allLibraries.set(`${lib.manager}:${lib.name}`, lib);
      }

      const components = await resolveComponents(
        rootDeps.plugins,
        { maxDepth, currentDepth: currentDepth + 1, visited },
        allLibraries,
        allComponents,
        hasCycles
      );

      return {
        root: { type: component.type, name: component.name },
        libraries: rootDeps.libraries,
        components,
        maxDepth: calculateMaxDepth(components),
        hasCycles: hasCycles.size > 0,
        totalComponents: countComponents(components),
        allLibraries: Array.from(allLibraries.values()),
        componentMap: allComponents,
      };
    },

    /**
     * Flatten a component tree into a single array (useful for caching)
     */
    flattenComponents(components: ResolvedComponent[]): PluginDep[] {
      const result: PluginDep[] = [];
      for (const comp of components) {
        result.push({ type: comp.type, name: comp.name });
        if (comp.children) result.push(...this.flattenComponents(comp.children));
      }
      return result;
    },
  };
}

export type DependencyResolverService = ReturnType<typeof createDependencyResolverService>;
