/**
 * Public API - exports createApp factory, config loader, and shared modules
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
