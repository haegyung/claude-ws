/**
 * Public API - exports createApp factory, config loader, shared modules, and all service factories
 */
export { createApp } from './app-factory';
export { loadEnvConfig, type EnvConfig } from './config/env-config';

// Shared modules - re-exported for use by claude-ws via @agentic-sdk/* path alias
export { createLogger, logger, type Logger } from './lib/pino-logger';
export {
  type Model,
  AVAILABLE_MODELS,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_ALIAS,
  getModelById,
  isValidModelId,
  modelIdToDisplayName,
  getModelShortName,
} from './lib/claude-available-models';
export { safeCompare } from './lib/timing-safe-compare';

// --- Projects ---
export { createProjectService } from './services/project-crud-service';

// --- Tasks ---
export { createTaskService } from './services/task-crud-and-reorder-service';

// --- Attempts ---
export { createAttemptService } from './services/attempt-crud-and-logs-service';
export { createUploadService } from './services/attempt-file-upload-storage-service';

// --- Checkpoints ---
export { createCheckpointService } from './services/checkpoint-crud-and-rewind-service';
export { createCheckpointOperationsService } from './services/checkpoint-fork-and-rewind-operations-service';

// --- Files ---
export { createFileService } from './services/filesystem-read-write-service';
export { createFileOperationsService } from './services/file-operations-and-upload-service';
export { createFileContentReadWriteService, type FileContentResult } from './services/file-content-read-write-service';
export {
  createFileTreeAndContentService,
} from './services/file-tree-and-content-service';
export {
  createFileTreeBuilderService,
  type GitFileStatusCode,
  type FileEntry,
  type FileTreeResult,
} from './services/file-tree-builder-service';
export {
  LANGUAGE_MAP,
  BINARY_EXTENSIONS,
  EXCLUDED_DIRS,
  EXCLUDED_FILES,
  MAX_FILE_SIZE,
  CONTENT_TYPE_MAP,
  getContentTypeForExtension,
  detectLanguage,
} from './services/file-mime-and-language-constants';

// --- Search ---
export { createSearchService } from './services/content-search-and-file-glob-service';
export { createFileSearchService } from './services/file-search-and-content-search-service';
export { createChatHistorySearchService } from './services/chat-history-search-service';

// --- Shells ---
export { createShellService } from './services/shell-process-db-tracking-service';

// --- Commands ---
export {
  createCommandService,
  type CommandInfo,
} from './services/slash-command-listing-service';

// --- Force-create helpers ---
export {
  createForceCreateService,
  ForceCreateError,
  sanitizeDirName,
  type ForceCreateParams,
  type ForceCreateResult,
} from './services/force-create-project-and-task-service';

// --- Auth ---
export { createAuthVerificationService } from './services/auth-verification-service';

// --- Attempt Workflow ---
export { createAttemptWorkflowService } from './services/attempt-workflow-tree-service';

// --- Agent Factory ---
export { createAgentFactoryService } from './services/agent-factory-plugin-registry-service';
export { createAgentFactoryProjectSyncService } from './services/agent-factory-project-sync-and-install-service';
export {
  createAgentFactoryFilesystemService,
  type FileNode,
  type DiscoveredItem as AgentFactoryDiscoveredItem,
  type DiscoveredFolder as AgentFactoryDiscoveredFolder,
} from './services/agent-factory-plugin-filesystem-operations-service';

// --- Agent Factory: Dir Resolver ---
export {
  getDataDir,
  getAgentFactoryDir,
  getGlobalClaudeDir,
} from './services/agent-factory-dir-resolver-service';

// --- Agent Factory: Archive Extraction ---
export {
  extractZip,
  extractTar,
  extractGzip,
  extractArchive,
} from './services/agent-factory-archive-extraction-service';

// --- Agent Factory: Upload Helpers ---
export {
  type ExtractedItem,
  detectPluginType,
  extractDescriptionFromMarkdown,
  moveDirectory,
  moveDirectoryContents,
  processFile,
  processDirectory,
  previewDirectory,
  previewDirectoryContents,
} from './services/agent-factory-upload-filesystem-helpers-service';

// --- Agent Factory: Upload Analysis & Import ---
export {
  type UploadSession,
  analyzeForPreview,
  analyzeAndOrganize,
  importFromSession,
} from './services/agent-factory-upload-analysis-and-import-service';

// --- Agent Factory: Component Import ---
export {
  createAgentFactoryImportService,
  ImportError,
} from './services/agent-factory-component-import-service';

// --- Agent Factory: Dependency Parsers ---
export {
  type LibraryDep,
  type PluginDep,
  extractLibraries,
  extractComponents,
  analyzePackageFiles,
} from './services/agent-factory-dependency-extractor-parsers-service';

// --- Agent Factory: Dependency Extractor ---
export {
  type ExtractedDeps,
  DependencyExtractor,
  dependencyExtractor,
} from './services/agent-factory-dependency-extractor-service';

// --- Agent Factory: Claude Dependency Analyzer ---
export {
  type AnalysisResult,
  ClaudeDependencyAnalyzer,
  claudeDependencyAnalyzer,
} from './services/agent-factory-claude-dependency-analyzer-service';

// --- Agent Factory: Install Script Templates ---
export {
  generateNpm,
  generatePnpm,
  generateYarn,
  generatePip,
  generatePoetry,
  generateCargo,
  generateGo,
} from './services/agent-factory-install-script-templates-service';

// --- Agent Factory: Install Script Generator ---
export {
  type GeneratedScripts,
  InstallScriptGenerator,
  installScriptGenerator,
} from './services/agent-factory-install-script-generator-service';

// --- Agent Factory: Dependency Cache ---
export {
  type CachedDependencyData,
  type DependencyCacheService,
  createDependencyCacheService,
} from './services/agent-factory-dependency-cache-service';

// --- Agent Factory: Dependency Resolver ---
export {
  type ResolveOptions,
  type ResolvedComponent,
  type ResolvedDependencyTree,
  type DependencyResolverService,
  createDependencyResolverService,
} from './services/agent-factory-dependency-resolver-service';

// --- Agent Factory: Plugin File Generator ---
export {
  type GeneratePluginFileOptions,
  type PluginFileExistsError,
  generatePluginFile,
  getPluginPath,
  pluginExists,
} from './services/agent-factory-plugin-file-generator-service';

// --- Agent Factory: Component Discovery ---
export {
  EXCLUDED_DIRS as AF_COMPONENT_EXCLUDED_DIRS,
  type DiscoveredItem,
  type DiscoveredFolder,
  discoverComponents,
  scanDirectoryForComponents,
  scanComponentDirectory,
  buildFolderHierarchy,
  parseYamlFrontmatter,
} from './services/agent-factory-component-discovery-service';

// --- Agent Factory: Component Install Helpers ---
export {
  copyDirectory,
  installSingleFile,
  installAgentSet,
  isAgentSetInstalled,
  uninstallAgentSet,
} from './services/agent-factory-component-install-copy-helpers';

// --- File Search: Filesystem Scan Helpers ---
export {
  EXCLUDED_DIRS as SEARCH_EXCLUDED_DIRS,
  EXCLUDED_FILES as SEARCH_EXCLUDED_FILES,
  BINARY_EXTENSIONS as SEARCH_BINARY_EXTENSIONS,
  MAX_SEARCH_FILE_SIZE,
  simpleFuzzyMatch,
  collectAllFiles,
  escapeRegex,
  type ContentMatch,
  searchFileContent,
  type ContentFileResult,
  searchDirContent,
} from './services/file-search-filesystem-scan-helpers';

// --- File Operations: Path Security & Compression Helpers ---
export {
  validateRootPath,
  validatePathWithinRoot,
  isCompressedFile,
  extractArchive as extractArchiveCompressed,
} from './services/file-operations-path-security-and-compression-helpers';
