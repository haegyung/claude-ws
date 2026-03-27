import Docker from 'dockerode';
import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync, promises as fs } from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import net from 'node:net';

import { db } from '@/lib/db';
import { containerPool, poolProjects, poolProjectActivityLog } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { createLogger } from '@/lib/logger';

const log = createLogger('ContainerPoolManager');

export interface PoolConfig {
  pool: {
    size: number;
    basePort: number;
    image: string;
  };
  networking: {
    dockerNetwork: string;
  };
  sharedProxy: {
    url: string;
  };
  storage: {
    basePath: string;
    poolTempBase: string;
  };
  healthCheck: {
    intervalSeconds: number;
    timeoutSeconds: number;
    retries: number;
  };
}

export interface AllocationResult {
  container_id: string;
  port: number;
  access_url: string;
  data_path: string;
}

type ReleaseOptions = {
  returnToPool?: boolean;
  clearData?: boolean;
};

export class ContainerPoolManager {
  private docker: Docker;
  private config: PoolConfig;

  constructor() {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    this.config = this.loadConfig();
  }

  /**
   * Allocate container from pool to project
   */
  async allocateContainer(projectId: string, projectName: string): Promise<AllocationResult> {
    log.info(`Allocating container for project: ${projectId}`);

    // 1. Find idle container from pool
    let poolContainer = await db.query.containerPool.findFirst({
      where: eq(containerPool.status, 'idle'),
      orderBy: [containerPool.createdAt],
    });

    // Remove stale/invalid idle entries until we get a startable container.
    while (poolContainer) {
      if (await this.isContainerMissing(poolContainer.containerId)) {
        log.warn(`Stale idle container record found: ${poolContainer.containerId}. Removing from pool DB.`);
        await db.delete(containerPool).where(eq(containerPool.containerId, poolContainer.containerId));
        poolContainer = await db.query.containerPool.findFirst({
          where: eq(containerPool.status, 'idle'),
          orderBy: [containerPool.createdAt],
        });
        continue;
      }

      try {
        const warmContainer = this.docker.getContainer(poolContainer.containerId);
        const inspectResult = await warmContainer.inspect();
        if (!inspectResult.State.Running) {
          await warmContainer.start();
        }
        break;
      } catch (error) {
        if (this.isPortAlreadyAllocatedError(error)) {
          log.warn(`Idle container ${poolContainer.containerId} cannot start due to occupied port ${poolContainer.containerPort}. Removing stale container and retrying.`);
          await this.removeContainerIfExists(poolContainer.containerId);
          await db.delete(containerPool).where(eq(containerPool.containerId, poolContainer.containerId));
          poolContainer = await db.query.containerPool.findFirst({
            where: eq(containerPool.status, 'idle'),
            orderBy: [containerPool.createdAt],
          });
          continue;
        }
        throw error;
      }
    }

    if (!poolContainer) {
      throw new Error('POOL_EXHAUSTED: No idle containers available in pool');
    }

    log.info(`Found idle container: ${poolContainer.containerId}`);

    // 2. Use pre-mounted slot directory associated with this container.
    const dataPath = this.getContainerMountPath(poolContainer.containerId);
    await this.prepareDataPath(dataPath);

    // 3. Start sleeping container instead of recreating with new bind mount.
    const warmContainer = this.docker.getContainer(poolContainer.containerId);
    await this.ensureContainerNetworkAttached(poolContainer.containerId);

    let projectWorkspaceHostPath: string;
    try {
      projectWorkspaceHostPath = await this.updateContainerProjectInDb(dataPath, projectId, projectName);
    } catch (error) {
      try {
        await warmContainer.stop({ t: 5 });
      } catch {
        // Ignore stop errors after failed initialization.
      }
      throw error;
    }

    log.info(`Started warmed container ${poolContainer.containerId} for project ${projectId}`);

    // 6. Update database
    db.transaction((tx) => {
      tx
        .update(poolProjects)
        .set({
          containerId: poolContainer.containerId,
          containerPort: poolContainer.containerPort,
          status: 'allocated',
          dataPath: projectWorkspaceHostPath,
          lastActivityAt: new Date(),
        })
        .where(eq(poolProjects.id, projectId))
        .run();

      tx
        .update(containerPool)
        .set({
          status: 'allocated',
          projectId,
          allocatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(containerPool.containerId, poolContainer.containerId))
        .run();

      // Log activity
      tx.insert(poolProjectActivityLog).values({
        id: nanoid(),
        projectId,
        containerId: poolContainer.containerId,
        action: 'allocated',
        details: JSON.stringify({
          containerDataPath: dataPath,
          projectWorkspaceHostPath,
          projectName,
          allocationTimeMs: Date.now(),
        }),
        timestamp: new Date(),
        performedBy: 'system',
        performedAt: new Date(),
      }).run();
    });

    // 7. Trigger pool replenishment asynchronously
    this.replenishPool().catch((err) => {
      log.error(`Pool replenishment failed: ${err}`);
    });

    return {
      container_id: poolContainer.containerId,
      port: poolContainer.containerPort,
      access_url: `/api/gateway/${projectId}`,
      data_path: projectWorkspaceHostPath,
    };
  }

  /**
   * Stop project container. Optionally return it to idle pool.
   */
  async releaseContainer(containerId: string, projectId: string, options: ReleaseOptions = {}): Promise<void> {
    const { returnToPool = false, clearData = false } = options;
    log.info(`Stopping container ${containerId} (returnToPool=${returnToPool}, clearData=${clearData})`);
    const containerPort = await this.getPortFromId(containerId);

    // 1. Stop container
    let isStopped = false;
    try {
      const container = this.docker.getContainer(containerId);
      await container.stop({ t: 10 }); // 10 second timeout
      isStopped = true;
    } catch (error) {
      log.warn(`Failed to stop container ${containerId} gracefully: ${error}`);
      try {
        const container = this.docker.getContainer(containerId);
        await container.kill();
        isStopped = true;
      } catch (killError) {
        log.error(`Failed to force-stop container ${containerId}: ${killError}`);
      }
    }

    if (!isStopped) {
      await db
        .update(containerPool)
        .set({
          status: 'stopping',
          healthStatus: 'error',
          errorMessage: `Failed to stop container ${containerId}`,
          updatedAt: new Date(),
        })
        .where(eq(containerPool.containerId, containerId));
      throw new Error(`RELEASE_FAILED: Could not stop container ${containerId}`);
    }

    if (returnToPool && clearData) {
      const dataPath = this.getContainerMountPath(containerId);
      await this.clearDirectory(dataPath);
      await this.prepareDataPath(dataPath);
      await this.initializeContainerProjectInDb(dataPath);
    }

    // 3. Update database
    db.transaction((tx) => {
      tx
        .update(poolProjects)
        .set({
          status: 'stopped',
          stoppedAt: new Date(),
          lastActivityAt: new Date(),
        })
        .where(eq(poolProjects.id, projectId))
        .run();

      tx
        .update(containerPool)
        .set({
          status: returnToPool ? 'idle' : 'stopped',
          projectId: returnToPool ? null : projectId,
          allocatedAt: returnToPool ? null : new Date(),
          updatedAt: new Date(),
          healthStatus: 'healthy',
          errorMessage: null,
        })
        .where(eq(containerPool.containerId, containerId))
        .run();

      // Log activity
      tx.insert(poolProjectActivityLog).values({
        id: nanoid(),
        projectId,
        containerId,
        action: 'stopped',
        details: JSON.stringify({ returnedToPool: returnToPool, containerPort, clearData }),
        timestamp: new Date(),
        performedBy: 'system',
        performedAt: new Date(),
      }).run();
    });
  }

  /**
   * Ensure an existing project's container is running before routing traffic.
   */
  async ensureProjectContainerReady(projectId: string): Promise<void> {
    const project = await db.query.poolProjects.findFirst({
      where: eq(poolProjects.id, projectId),
    });

    if (!project?.containerId) {
      throw new Error(`PROJECT_NOT_ALLOCATED: ${projectId}`);
    }
    const containerId = project.containerId;

    const poolItem = await db.query.containerPool.findFirst({
      where: eq(containerPool.containerId, containerId),
    });

    if (!poolItem) {
      throw new Error(`POOL_CONTAINER_NOT_FOUND: ${containerId}`);
    }

    const dockerContainer = this.docker.getContainer(containerId);
    const inspectResult = await dockerContainer.inspect();

    if (!inspectResult.State.Running) {
      await this.ensureContainerNetworkAttached(containerId);
      await dockerContainer.start();
      log.info(`Restarted stopped container ${containerId} for project ${projectId}`);
    }

    const now = new Date();
    db.transaction((tx) => {
      tx
        .update(poolProjects)
        .set({
          status: 'allocated',
          stoppedAt: null,
          lastActivityAt: now,
        })
        .where(eq(poolProjects.id, projectId))
        .run();

      tx
        .update(containerPool)
        .set({
          status: 'allocated',
          projectId,
          allocatedAt: poolItem.allocatedAt ?? now,
          updatedAt: now,
          healthStatus: 'healthy',
          errorMessage: null,
        })
        .where(eq(containerPool.containerId, containerId))
        .run();

      tx.insert(poolProjectActivityLog).values({
        id: nanoid(),
        projectId,
        containerId,
        action: 'restarted',
        details: JSON.stringify({ containerPort: project.containerPort }),
        timestamp: now,
        performedBy: 'system',
        performedAt: now,
      }).run();
    });
  }

  /**
   * Get logs from a container
   */
  async getContainerLogs(containerId: string, options: {
    tail?: number;
    timestamps?: boolean;
    stdout?: boolean;
    stderr?: boolean;
  } = {}): Promise<string> {
    const {
      tail = 100,
      timestamps = true,
      stdout = true,
      stderr = true,
    } = options;

    log.info(`Fetching logs for container: ${containerId}`);

    try {
      const container = this.docker.getContainer(containerId);

      const logs = await container.logs({
        stdout,
        stderr,
        tail,
        timestamps,
        follow: false,
      });

      // Docker logs are Buffer with newlines, need to decode and clean up
      const logString = logs.toString('utf-8');

      // Remove Docker log headers (8 bytes header per line)
      const cleanedLogs = logString
        .split('\n')
        .map(line => line.slice(8)) // Remove header
        .filter(line => line.trim())
        .join('\n');

      return cleanedLogs;
    } catch (error) {
      log.error(`Failed to get logs for container ${containerId}:`, error);
      throw new Error(`LOGS_FAILED: ${error}`);
    }
  }

  /**
   * Ensure pool has required number of idle containers
   */
  async replenishPool(): Promise<void> {
    await this.ensurePoolImageAvailable();
    await this.reconcilePoolState();

    const idleCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(containerPool)
      .where(eq(containerPool.status, 'idle'));
    const idleCount = idleCountResult[0]?.count ?? 0;

    const needed = this.config.pool.size - idleCount;

    if (needed > 0) {
      log.info(`Replenishing pool: need ${needed} more containers`);
      for (let i = 0; i < needed; i++) {
        await this.createIdleContainer();
      }
      log.info('Pool replenished successfully');
    }
  }

  /**
   * Reconcile stale DB state (e.g. after server restart/crash).
   */
  private async reconcilePoolState(): Promise<void> {
    const containers = await db.query.containerPool.findMany();

    for (const poolItem of containers) {
      if (poolItem.status !== 'allocated') {
        continue;
      }

      if (!poolItem.projectId) {
        await db
          .update(containerPool)
          .set({
            status: 'idle',
            projectId: null,
            allocatedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(containerPool.containerId, poolItem.containerId));
        continue;
      }

      const project = await db.query.poolProjects.findFirst({
        where: eq(poolProjects.id, poolItem.projectId),
      });

      const isProjectMapped =
        project &&
        project.status === 'allocated' &&
        project.containerId === poolItem.containerId;

      if (!isProjectMapped) {
        await db
          .update(containerPool)
          .set({
            status: 'idle',
            projectId: null,
            allocatedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(containerPool.containerId, poolItem.containerId));
      }
    }
  }

  /**
   * Create new idle container for pool
   */
  private async createIdleContainer(): Promise<void> {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 9);
    const containerId = `claude-ws-pool-${timestamp}-${randomStr}`;
    const dataPath = this.getContainerMountPath(containerId);
    await this.prepareDataPath(dataPath);
    await this.initializeContainerProjectInDb(dataPath);

    const maxAttempts = 20;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const port = await this.getNextAvailablePort();
      try {
        await this.docker.createContainer({
          Image: this.config.pool.image,
          name: containerId,
          Cmd: ['pnpm', 'start'],
          ExposedPorts: { '8053/tcp': {} },
          HostConfig: {
            PortBindings: { '8053/tcp': [{ HostPort: String(port) }] },
            Binds: [`${dataPath}:/app/data`],
            RestartPolicy: { Name: 'unless-stopped' },
            NetworkMode: this.config.networking.dockerNetwork,
          },
          Env: this.buildContainerEnv(),
          Labels: {
            'claude-ws.pool': 'true',
            'claude-ws.managed': 'true',
            'claude-ws.pool.created': new Date().toISOString(),
          },
        });

        await db.insert(containerPool).values({
          id: containerId,
          containerId,
          status: 'idle',
          containerPort: port,
          projectId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastActivityAt: new Date(),
          lastHealthCheck: new Date(),
          healthStatus: 'healthy',
        });

        log.info(`Created warm sleeping container: ${containerId} on port ${port}`);
        return;
      } catch (error) {
        if (this.isPortAlreadyAllocatedError(error) && attempt < maxAttempts) {
          log.warn(`Port ${port} is already allocated while creating ${containerId}, retrying (${attempt}/${maxAttempts})`);
          continue;
        }
        throw error;
      }
    }

    throw new Error(`POOL_PORT_EXHAUSTED: Could not allocate port for ${containerId}`);
  }

  /**
   * Health check for all pool containers
   */
  async healthCheck(): Promise<void> {
    log.debug('Running health check for all containers');

    const containers = await db.query.containerPool.findMany();

    for (const container of containers) {
      try {
        const dockerContainer = this.docker.getContainer(container.containerId);
        const status = await dockerContainer.inspect();

        const isHealthy =
          container.status === 'idle'
            ? true
            : status.State.Running && status.State.Health?.Status !== 'unhealthy';

        await db
          .update(containerPool)
          .set({
            healthStatus: isHealthy ? 'healthy' : 'unhealthy',
            lastHealthCheck: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(containerPool.containerId, container.containerId));

        if (!isHealthy && container.status === 'allocated') {
          log.warn(`Unhealthy allocated container detected: ${container.containerId}`);
        }
      } catch (error) {
        log.error(`Health check failed for ${container.containerId}: ${error}`);

        await db
          .update(containerPool)
          .set({
            healthStatus: 'error',
            errorMessage: String(error),
            lastHealthCheck: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(containerPool.containerId, container.containerId));
      }
    }
  }

  /**
   * Get next available port for pool container
   */
  private async getNextAvailablePort(): Promise<number> {
    const containers = await db.query.containerPool.findMany();

    const usedPorts = new Set(containers.map((c) => c.containerPort));
    const basePort = this.config.pool.basePort;
    const maxPort = Math.max(
      basePort + this.config.pool.size * 5,
      basePort + containers.length + 100
    );

    for (let port = basePort; port <= maxPort; port++) {
      if (usedPorts.has(port)) {
        continue;
      }
      if (await this.isHostPortAvailable(port)) {
        return port;
      }
    }

    throw new Error(`POOL_PORT_EXHAUSTED: No available host port in range ${basePort}-${maxPort}`);
  }

  private async getPortFromId(containerId: string): Promise<number> {
    const container = await db.query.containerPool.findFirst({
      where: eq(containerPool.containerId, containerId),
    });

    return container?.containerPort || this.config.pool.basePort;
  }

  private getContainerMountPath(containerId: string): string {
    return path.join(this.config.storage.basePath, containerId);
  }

  private async clearDirectory(directoryPath: string): Promise<void> {
    await fs.rm(directoryPath, { recursive: true, force: true });
  }

  private async prepareDataPath(dataPath: string): Promise<void> {
    const filesPath = path.join(dataPath, 'files');
    const checkpointsPath = path.join(dataPath, 'checkpoints');
    await fs.mkdir(dataPath, { recursive: true });
    await fs.mkdir(filesPath, { recursive: true });
    await fs.mkdir(checkpointsPath, { recursive: true });
    // Pool containers run as non-root, so host-mounted directories must be writable.
    await fs.chmod(dataPath, 0o777);
    await fs.chmod(filesPath, 0o777);
    await fs.chmod(checkpointsPath, 0o777);
  }

  private loadConfig(): PoolConfig {
    const basePath = this.resolveStoragePath(
      process.env.DATA_BASE_PATH || '/srv/claude-ws/pool-data',
      'data/pool-data',
      'DATA_BASE_PATH'
    );
    const poolTempBase = this.resolveStoragePath(
      process.env.POOL_TEMP_BASE || '/srv/claude-ws/pool-temp',
      'data/pool-temp',
      'POOL_TEMP_BASE'
    );
    const sharedProxyPort = parseInt(process.env.SHARED_LLM_PROXY_PORT || '8666', 10);
    const sharedProxyUrl =
      process.env.SHARED_LLM_PROXY_URL ||
      `http://shared-llm-proxy:${sharedProxyPort}/api/proxy/anthropic`;

    return {
      pool: {
        size: parseInt(process.env.POOL_SIZE || '5'),
        basePort: parseInt(process.env.POOL_BASE_PORT || '30000'),
        image: process.env.POOL_IMAGE || 'claude-ws:latest',
      },
      networking: {
        dockerNetwork: process.env.POOL_DOCKER_NETWORK || 'claude-network',
      },
      sharedProxy: {
        url: sharedProxyUrl,
      },
      storage: {
        basePath,
        poolTempBase,
      },
      healthCheck: {
        intervalSeconds: parseInt(process.env.HEALTH_CHECK_INTERVAL_SECONDS || '60'),
        timeoutSeconds: parseInt(process.env.HEALTH_CHECK_TIMEOUT_SECONDS || '10'),
        retries: parseInt(process.env.HEALTH_CHECK_RETRIES || '3'),
      },
    };
  }

  private resolveStoragePath(configuredPath: string, fallbackRelativePath: string, envName: string): string {
    try {
      mkdirSync(configuredPath, { recursive: true });
      return configuredPath;
    } catch (error) {
      const isPermissionError =
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'EACCES';

      if (process.env.NODE_ENV === 'production' || !isPermissionError) {
        throw error;
      }

      const fallbackPath = path.resolve(process.cwd(), fallbackRelativePath);
      mkdirSync(fallbackPath, { recursive: true });
      log.warn(
        `${envName} path "${configuredPath}" is not writable, falling back to "${fallbackPath}" in development`
      );
      return fallbackPath;
    }
  }

  private async ensurePoolImageAvailable(): Promise<void> {
    try {
      await this.docker.getImage(this.config.pool.image).inspect();
    } catch (error) {
      const statusCode = (error as { statusCode?: number })?.statusCode;
      if (statusCode !== 404) {
        throw error;
      }

      throw new Error(
        `POOL_IMAGE_NOT_FOUND: Docker image "${this.config.pool.image}" was not found. ` +
          `Set POOL_IMAGE in packages/admin-panel/.env to an existing image, or build one first (example: docker build -t ${this.config.pool.image} .).`
      );
    }
  }

  private async isContainerMissing(containerId: string): Promise<boolean> {
    try {
      await this.docker.getContainer(containerId).inspect();
      return false;
    } catch (error) {
      const statusCode = (error as { statusCode?: number })?.statusCode;
      if (statusCode === 404) {
        return true;
      }
      throw error;
    }
  }

  private async removeContainerIfExists(containerId: string): Promise<void> {
    try {
      await this.docker.getContainer(containerId).remove({ force: true });
    } catch (error) {
      const statusCode = (error as { statusCode?: number })?.statusCode;
      if (statusCode !== 404) {
        log.warn(`Failed to remove container ${containerId}: ${error}`);
      }
    }
  }

  private async ensureContainerNetworkAttached(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    const inspectResult = await container.inspect();
    const networks = inspectResult.NetworkSettings?.Networks ?? {};
    const targetNetwork = this.config.networking.dockerNetwork;
    if (networks[targetNetwork]) {
      return;
    }

    if (Object.keys(networks).length === 0) {
      log.warn(`Container ${containerId} has no attached Docker network; connecting to "${targetNetwork}".`);
    } else {
      log.warn(`Container ${containerId} is not attached to "${targetNetwork}", attaching now.`);
    }

    await this.docker.getNetwork(targetNetwork).connect({ Container: containerId });
  }

  private isPortAlreadyAllocatedError(error: unknown): boolean {
    const message = String(error);
    return message.includes('port is already allocated') || message.includes('Bind for 0.0.0.0');
  }

  private async isHostPortAvailable(port: number): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '0.0.0.0');
    });
  }

  private async initializeContainerProjectInDb(dataPath: string): Promise<void> {
    const projectId = 'pool-project';
    const projectName = 'Idle Project';
    const projectPath = '/app/data/pool-idle';
    await this.upsertContainerProject(dataPath, projectId, projectName, projectPath);
  }

  private async updateContainerProjectInDb(dataPath: string, projectId: string, projectName: string): Promise<string> {
    const projectSlug = this.sanitizeProjectName(projectName || projectId);
    const projectPath = `/app/data/${projectSlug}`;
    return this.upsertContainerProject(dataPath, projectId, projectName, projectPath);
  }

  private async upsertContainerProject(
    dataPath: string,
    projectId: string,
    projectName: string,
    projectPath: string
  ): Promise<string> {
    const relativePath = projectPath.replace('/app/data/', '');
    const projectDirPath = path.join(dataPath, relativePath);
    await fs.mkdir(projectDirPath, { recursive: true });
    await fs.chmod(projectDirPath, 0o777);

    const dbFilePath = path.join(dataPath, 'claude-ws.db');
    const sqlite = new BetterSqlite3(dbFilePath);

    try {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );
      `);

      sqlite.prepare('DELETE FROM projects').run();
      sqlite
        .prepare('INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)')
        .run(projectId, projectName, projectPath, Date.now());
    } finally {
      sqlite.close();
    }

    // Ensure runtime user in container can write the SQLite file.
    await fs.chmod(dbFilePath, 0o666);
    return projectDirPath;
  }

  private sanitizeProjectName(name: string): string {
    const sanitized = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return sanitized || 'project';
  }

  private buildContainerEnv(): string[] {
    const env = [
      'NODE_ENV=production',
      'PORT=8053',
      'DATA_DIR=/app/data',
      'POOL_MODE=true',
      `ANTHROPIC_BASE_URL=${this.config.sharedProxy.url}`,
      // Pool containers should run with SDK provider and ANTHROPIC_* env vars.
      'CLAUDE_PROVIDER=sdk',
    ];

    const passthroughKeys = [
      'API_ACCESS_KEY',
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'API_TIMEOUT_MS',
    ];

    for (const key of passthroughKeys) {
      const value = process.env[key];
      if (value) {
        env.push(`${key}=${value}`);
      }
    }

    return env;
  }
}

// Singleton instance
export const containerPoolManager = new ContainerPoolManager();
