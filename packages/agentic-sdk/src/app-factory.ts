/**
 * Application factory - wires together Fastify app, plugins, database, services, agent, and routes
 */
import path from 'path';
import { buildFastifyApp } from './fastify-app-setup';
import { registerAuthPlugin } from './plugins/fastify-auth-plugin';
import { registerErrorHandlerPlugin } from './plugins/fastify-error-handler-plugin';
import { createDbConnection } from './db/database-connection';
import { initDbTables } from './db/database-init-tables';
import { AgentProvider } from './agent/claude-sdk-agent-provider';
import { AgentManager } from './agent/agent-lifecycle-manager';
import { createProjectService } from './services/project-crud-service';
import { createTaskService } from './services/task-crud-and-reorder-service';
import { createAttemptService } from './services/attempt-crud-and-logs-service';
import { createCheckpointService } from './services/checkpoint-crud-and-rewind-service';
import { createFileService } from './services/filesystem-read-write-service';
import { createSearchService } from './services/content-search-and-file-glob-service';
import { createUploadService } from './services/attempt-file-upload-storage-service';
import { createShellService } from './services/shell-process-db-tracking-service';
import { createCommandService } from './services/slash-command-listing-service';
import { createAgentFactoryService } from './services/agent-factory-plugin-registry-service';
import type { EnvConfig } from './config/env-config';

// Route imports
import authRoutes from './routes/auth-routes';
import projectRoutes from './routes/project-routes';
import taskRoutes from './routes/task-routes';
import attemptRoutes from './routes/attempt-routes';
import attemptSseRoutes from './routes/attempt-sse-routes';
import checkpointRoutes from './routes/checkpoint-routes';
import fileRoutes from './routes/file-routes';
import searchRoutes from './routes/search-routes';
import filesystemRoutes from './routes/filesystem-routes';
import uploadRoutes from './routes/upload-routes';
import shellRoutes from './routes/shell-routes';
import commandRoutes from './routes/command-routes';
import agentFactoryPluginRoutes from './routes/agent-factory-plugin-routes';
import agentFactoryProjectRoutes from './routes/agent-factory-project-routes';

export async function createApp(envConfig: EnvConfig) {
  const app = await buildFastifyApp(envConfig);

  // Initialize database
  const { sqlite, db } = createDbConnection(envConfig.dataDir);
  initDbTables(sqlite);

  // Create services
  const uploadsDir = path.join(envConfig.dataDir, 'uploads');
  const services = {
    project: createProjectService(db),
    task: createTaskService(db),
    attempt: createAttemptService(db),
    checkpoint: createCheckpointService(db),
    file: createFileService(),
    search: createSearchService(),
    upload: createUploadService(db, uploadsDir),
    shell: createShellService(db),
    command: createCommandService(),
    agentFactory: createAgentFactoryService(db),
  };

  // Create agent manager
  const provider = new AgentProvider({
    anthropicBaseUrl: envConfig.anthropicBaseUrl,
    anthropicAuthToken: envConfig.anthropicAuthToken,
    anthropicModel: envConfig.anthropicModel,
    anthropicDefaultOpusModel: envConfig.anthropicDefaultOpusModel,
    anthropicDefaultSonnetModel: envConfig.anthropicDefaultSonnetModel,
    anthropicDefaultHaikuModel: envConfig.anthropicDefaultHaikuModel,
  });
  const agentManager = new AgentManager(provider);

  // Wire agent events to persist logs and update attempt status
  agentManager.on('json', async (data: { attemptId: string; data: unknown }) => {
    try {
      const content = typeof data.data === 'string' ? data.data : JSON.stringify(data.data);
      await services.attempt.addLog(data.attemptId, 'json', content);
    } catch (err) {
      app.log.error({ err, attemptId: data.attemptId }, 'Failed to persist agent log');
    }
  });

  agentManager.on('stderr', async (data: { attemptId: string; content: string }) => {
    try {
      await services.attempt.addLog(data.attemptId, 'stderr', data.content);
    } catch (err) {
      app.log.error({ err, attemptId: data.attemptId }, 'Failed to persist stderr log');
    }
  });

  agentManager.on('exit', async (data: { attemptId: string; code: number }) => {
    try {
      const status = data.code === 0 ? 'completed' : 'error';
      await services.attempt.updateStatus(data.attemptId, status);
    } catch (err) {
      app.log.error({ err, attemptId: data.attemptId }, 'Failed to update attempt status');
    }
  });

  agentManager.on('question', async (data: { attemptId: string; toolUseId: string; questions: unknown[] }) => {
    try {
      await services.attempt.addLog(data.attemptId, 'json', JSON.stringify({ toolUseId: data.toolUseId, questions: data.questions }));
    } catch (err) {
      app.log.error({ err, attemptId: data.attemptId }, 'Failed to persist question log');
    }
  });

  // Decorate app
  app.decorate('db', db);
  app.decorate('sqlite', sqlite);
  app.decorate('envConfig', envConfig);
  app.decorate('services', services);
  app.decorate('agentManager', agentManager);

  // Register plugins
  await app.register(registerAuthPlugin, { envConfig });
  await app.register(registerErrorHandlerPlugin);

  // Health check (no auth)
  app.get('/health', async () => ({ status: 'ok', timestamp: Date.now() }));

  // Register routes
  await app.register(authRoutes);
  await app.register(projectRoutes);
  await app.register(taskRoutes);
  await app.register(attemptRoutes);
  await app.register(attemptSseRoutes);
  await app.register(checkpointRoutes);
  await app.register(fileRoutes);
  await app.register(searchRoutes);
  await app.register(filesystemRoutes);
  await app.register(uploadRoutes);
  await app.register(shellRoutes);
  await app.register(commandRoutes);
  await app.register(agentFactoryPluginRoutes);
  await app.register(agentFactoryProjectRoutes);

  return app;
}

// Augment Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    db: ReturnType<typeof createDbConnection>['db'];
    sqlite: ReturnType<typeof createDbConnection>['sqlite'];
    envConfig: EnvConfig;
    services: {
      project: ReturnType<typeof createProjectService>;
      task: ReturnType<typeof createTaskService>;
      attempt: ReturnType<typeof createAttemptService>;
      checkpoint: ReturnType<typeof createCheckpointService>;
      file: ReturnType<typeof createFileService>;
      search: ReturnType<typeof createSearchService>;
      upload: ReturnType<typeof createUploadService>;
      shell: ReturnType<typeof createShellService>;
      command: ReturnType<typeof createCommandService>;
      agentFactory: ReturnType<typeof createAgentFactoryService>;
    };
    agentManager: AgentManager;
  }
}
