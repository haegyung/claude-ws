import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// Projects table - workspace configuration
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  path: text('path').notNull().unique(),
  createdAt: integer('created_at', { mode: 'number' })
    .notNull()
    .$defaultFn(() => Date.now()),
});

// Tasks table - Kanban cards
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status', {
      enum: ['todo', 'in_progress', 'in_review', 'done', 'cancelled'],
    })
      .notNull()
      .default('todo'),
    position: integer('position').notNull(),
    chatInit: integer('chat_init', { mode: 'boolean' }).notNull().default(false),
    lastModel: text('last_model'),
    rewindSessionId: text('rewind_session_id'),
    rewindMessageUuid: text('rewind_message_uuid'),
    createdAt: integer('created_at', { mode: 'number' })
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer('updated_at', { mode: 'number' })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index('idx_tasks_project').on(table.projectId, table.status, table.position),
  ]
);

// Attempts table - each prompt submission per task
export const attempts = sqliteTable(
  'attempts',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    prompt: text('prompt').notNull(),
    displayPrompt: text('display_prompt'),
    status: text('status', {
      enum: ['running', 'completed', 'failed', 'cancelled'],
    })
      .notNull()
      .default('running'),
    sessionId: text('session_id'),
    branch: text('branch'),
    diffAdditions: integer('diff_additions').notNull().default(0),
    diffDeletions: integer('diff_deletions').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    totalCostUSD: text('total_cost_usd').notNull().default('0'),
    numTurns: integer('num_turns').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    contextUsed: integer('context_used').notNull().default(0),
    contextLimit: integer('context_limit').notNull().default(200000),
    contextPercentage: integer('context_percentage').notNull().default(0),
    baselineContext: integer('baseline_context').notNull().default(0),
    createdAt: integer('created_at', { mode: 'number' })
      .notNull()
      .$defaultFn(() => Date.now()),
    completedAt: integer('completed_at', { mode: 'number' }),
    outputFormat: text('output_format'),
    outputSchema: text('output_schema'),
  },
  (table) => [
    index('idx_attempts_task').on(table.taskId, table.createdAt),
  ]
);

// Attempt logs table - streaming output chunks
export const attemptLogs = sqliteTable(
  'attempt_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    attemptId: text('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['stdout', 'stderr', 'json'] }).notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at', { mode: 'number' })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index('idx_logs_attempt').on(table.attemptId, table.createdAt),
  ]
);

// Attempt files table - file attachments per attempt
export const attemptFiles = sqliteTable(
  'attempt_files',
  {
    id: text('id').primaryKey(),
    attemptId: text('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    createdAt: integer('created_at', { mode: 'number' })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [index('idx_attempt_files_attempt').on(table.attemptId)]
);

// Checkpoints table - conversation state snapshots for rewind
export const checkpoints = sqliteTable(
  'checkpoints',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    attemptId: text('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    gitCommitHash: text('git_commit_hash'),
    messageCount: integer('message_count').notNull(),
    summary: text('summary'),
    createdAt: integer('created_at', { mode: 'number' })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index('idx_checkpoints_task').on(table.taskId, table.createdAt),
  ]
);

// Shells table - background shell processes per project
export const shells = sqliteTable(
  'shells',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    attemptId: text('attempt_id')
      .references(() => attempts.id, { onDelete: 'set null' }),
    command: text('command').notNull(),
    cwd: text('cwd').notNull(),
    pid: integer('pid'),
    status: text('status', { enum: ['running', 'stopped', 'crashed'] })
      .notNull()
      .default('running'),
    exitCode: integer('exit_code'),
    exitSignal: text('exit_signal'),
    createdAt: integer('created_at', { mode: 'number' })
      .notNull()
      .$defaultFn(() => Date.now()),
    stoppedAt: integer('stopped_at', { mode: 'number' }),
  },
  (table) => [
    index('idx_shells_project').on(table.projectId, table.status),
  ]
);

// Subagents table - workflow agent tracking per attempt
export const subagents = sqliteTable(
  'subagents',
  {
    id: text('id').primaryKey(),
    attemptId: text('attempt_id').notNull(),
    type: text('type').notNull(),
    name: text('name'),
    parentId: text('parent_id'),
    teamName: text('team_name'),
    status: text('status', {
      enum: ['in_progress', 'completed', 'failed', 'orphaned'],
    }).notNull(),
    error: text('error'),
    startedAt: integer('started_at'),
    completedAt: integer('completed_at'),
    durationMs: integer('duration_ms'),
    depth: integer('depth').notNull().default(0),
    createdAt: integer('created_at', { mode: 'number' })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index('idx_subagents_attempt').on(table.attemptId),
  ]
);

// Agent Factory Plugins table - skills, commands, agents registry
export const agentFactoryPlugins = sqliteTable('agent_factory_plugins', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['skill', 'command', 'agent', 'agent_set'] }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  sourcePath: text('source_path'),
  storageType: text('storage_type', { enum: ['local', 'imported', 'external'] }).notNull().default('local'),
  agentSetPath: text('agent_set_path'),
  metadata: text('metadata'),
  createdAt: integer('created_at', { mode: 'number' })
    .notNull()
    .$defaultFn(() => Date.now()),
  updatedAt: integer('updated_at', { mode: 'number' })
    .notNull()
    .$defaultFn(() => Date.now()),
});

// Project Plugins table - many-to-many relationship between projects and plugins
export const projectPlugins = sqliteTable(
  'project_plugins',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    pluginId: text('plugin_id')
      .notNull()
      .references(() => agentFactoryPlugins.id, { onDelete: 'cascade' }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'number' })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index('idx_project_plugins').on(table.projectId, table.pluginId),
  ]
);

// Plugin Dependencies table - track package and plugin dependencies
export const pluginDependencies = sqliteTable(
  'plugin_dependencies',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id')
      .notNull()
      .references(() => agentFactoryPlugins.id, { onDelete: 'cascade' }),
    dependencyType: text('dependency_type', { enum: ['python', 'npm', 'system', 'skill', 'agent'] }).notNull(),
    spec: text('spec').notNull(),
    pluginDependencyId: text('plugin_dependency_id').references(() => agentFactoryPlugins.id, { onDelete: 'set null' }),
    installed: integer('installed', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'number' })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index('idx_plugin_deps').on(table.pluginId),
    index('idx_plugin_depends_on').on(table.pluginDependencyId),
  ]
);

// Plugin Dependency Cache table - cache resolved dependency trees and install scripts
export const pluginDependencyCache = sqliteTable(
  'plugin_dependency_cache',
  {
    id: text('id').primaryKey(),
    pluginId: text('plugin_id').references(() => agentFactoryPlugins.id, { onDelete: 'cascade' }),
    sourcePath: text('source_path'),
    sourceHash: text('source_hash'),
    type: text('type', { enum: ['skill', 'command', 'agent'] }).notNull(),
    libraryDeps: text('library_deps'),
    pluginDeps: text('plugin_deps'),
    installScriptNpm: text('install_script_npm'),
    installScriptPnpm: text('install_script_pnpm'),
    installScriptYarn: text('install_script_yarn'),
    installScriptPip: text('install_script_pip'),
    installScriptPoetry: text('install_script_poetry'),
    installScriptCargo: text('install_script_cargo'),
    installScriptGo: text('install_script_go'),
    dockerfile: text('dockerfile'),
    depth: integer('depth').notNull().default(0),
    hasCycles: integer('has_cycles', { mode: 'boolean' }).notNull().default(false),
    resolvedAt: integer('resolved_at', { mode: 'number' }).notNull(),
    createdAt: integer('created_at', { mode: 'number' })
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index('idx_cache_plugin').on(table.pluginId),
    index('idx_cache_source').on(table.sourcePath),
  ]
);

// App Settings table - global application settings
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'number' })
    .notNull()
    .$defaultFn(() => Date.now()),
});

// Type exports
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Attempt = typeof attempts.$inferSelect;
export type NewAttempt = typeof attempts.$inferInsert;
export type AttemptLog = typeof attemptLogs.$inferSelect;
export type NewAttemptLog = typeof attemptLogs.$inferInsert;
export type Checkpoint = typeof checkpoints.$inferSelect;
export type NewCheckpoint = typeof checkpoints.$inferInsert;
export type AttemptFile = typeof attemptFiles.$inferSelect;
export type NewAttemptFile = typeof attemptFiles.$inferInsert;
export type AgentFactoryPlugin = typeof agentFactoryPlugins.$inferSelect;
export type NewAgentFactoryPlugin = typeof agentFactoryPlugins.$inferInsert;
export type ProjectPlugin = typeof projectPlugins.$inferSelect;
export type NewProjectPlugin = typeof projectPlugins.$inferInsert;
export type PluginDependency = typeof pluginDependencies.$inferSelect;
export type NewPluginDependency = typeof pluginDependencies.$inferInsert;
export type PluginDependencyCache = typeof pluginDependencyCache.$inferSelect;
export type NewPluginDependencyCache = typeof pluginDependencyCache.$inferInsert;
export type Shell = typeof shells.$inferSelect;
export type NewShell = typeof shells.$inferInsert;
export type Subagent = typeof subagents.$inferSelect;
export type NewSubagent = typeof subagents.$inferInsert;
export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
