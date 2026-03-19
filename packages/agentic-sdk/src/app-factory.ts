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
import { createProjectService } from './services/project/project-crud';
import { createTaskService } from './services/task/task-crud-and-reorder';
import { createAttemptService } from './services/attempt/attempt-crud-and-logs';
import { createCheckpointService } from './services/checkpoint/checkpoint-crud-and-rewind';
import { createCheckpointOperationsService } from './services/checkpoints/fork-and-rewind-operations';
import { createFileService } from './services/file/filesystem-read-write';
import { createSearchService } from './services/search/content-search-and-file-glob';
import { createUploadService } from './services/attempt/attempt-file-upload-storage';
import { createShellService } from './services/shell/shell-process-db-tracking';
import { createCommandService } from './services/command/slash-command-listing';
import { createAgentFactoryService, type AgentFactoryService } from './services/agent-factory/agent-factory-plugin-registry';
import { createForceCreateService } from './services/force-create-project-and-task';
import { createAuthVerificationService } from './services/auth-verification';
import { createAttemptWorkflowService } from './services/attempts/workflow-tree';
import { createFileTreeBuilderService } from './services/files/tree-builder';
import { createAgentFactoryFilesystemService } from './services/agent-factory/plugin-filesystem-operations';
import type { EnvConfig } from './config/env-config';

// Route imports — folder-based domain routes
import attemptsDomainRoutes from './routes/attempts/index';
import attemptSseRoutes from './routes/attempt-sse-routes';
import tasksDomainRoutes from './routes/tasks/index';
import checkpointsDomainRoutes from './routes/checkpoints/index';
import filesDomainRoutes from './routes/files/index';
import searchDomainRoutes from './routes/search/index';
import filesystemRoutes from './routes/filesystem-routes';
import projectsDomainRoutes from './routes/projects/index';
import authDomainRoutes from './routes/auth/index';
import shellsDomainRoutes from './routes/shells/index';
import commandsDomainRoutes from './routes/commands/index';
import uploadsDomainRoutes from './routes/uploads/index';
import agentFactoryDomainRoutes from './routes/agent-factory/index';
import autopilotDomainRoutes from './routes/autopilot/index';
import type { AutopilotService } from './services/autopilot/autopilot-toggle-and-status';

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
    checkpointOps: createCheckpointOperationsService(db),
    file: createFileService(),
    search: createSearchService(),
    upload: createUploadService(db, uploadsDir),
    shell: createShellService(db),
    command: createCommandService(),
    agentFactory: createAgentFactoryService(db),
    forceCreate: createForceCreateService(db),
    auth: createAuthVerificationService(envConfig.apiAccessKey),
    attemptWorkflow: createAttemptWorkflowService(db),
    fileTreeBuilder: createFileTreeBuilderService(),
    agentFactoryFs: createAgentFactoryFilesystemService(),
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

  // Register folder-based domain routes
  await app.register(authDomainRoutes);
  await app.register(projectsDomainRoutes);
  await app.register(tasksDomainRoutes);
  await app.register(attemptsDomainRoutes);
  await app.register(attemptSseRoutes);
  await app.register(checkpointsDomainRoutes);
  await app.register(filesDomainRoutes);
  await app.register(searchDomainRoutes);
  await app.register(filesystemRoutes);
  await app.register(uploadsDomainRoutes);
  await app.register(shellsDomainRoutes);
  await app.register(commandsDomainRoutes);
  await app.register(agentFactoryDomainRoutes);
  await app.register(autopilotDomainRoutes);

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
      checkpointOps: ReturnType<typeof createCheckpointOperationsService>;
      file: ReturnType<typeof createFileService>;
      search: ReturnType<typeof createSearchService>;
      upload: ReturnType<typeof createUploadService>;
      shell: ReturnType<typeof createShellService>;
      command: ReturnType<typeof createCommandService>;
      agentFactory: AgentFactoryService;
      forceCreate: ReturnType<typeof createForceCreateService>;
      auth: ReturnType<typeof createAuthVerificationService>;
      attemptWorkflow: ReturnType<typeof createAttemptWorkflowService>;
      fileTreeBuilder: ReturnType<typeof createFileTreeBuilderService>;
      agentFactoryFs: ReturnType<typeof createAgentFactoryFilesystemService>;
      autopilot?: AutopilotService;
    };
    agentManager: AgentManager;
  }
}
