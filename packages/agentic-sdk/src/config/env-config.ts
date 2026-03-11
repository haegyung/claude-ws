/**
 * Environment configuration loader - reads from parent claude-ws .env
 * Falls back to sensible defaults for standalone operation
 */
import path from 'path';
import { fileURLToPath } from 'url';

export interface EnvConfig {
  port: number;
  apiAccessKey: string;
  anthropicBaseUrl: string;
  anthropicAuthToken: string;
  anthropicModel: string;
  anthropicDefaultOpusModel: string;
  anthropicDefaultSonnetModel: string;
  anthropicDefaultHaikuModel: string;
  dataDir: string;
  logLevel: string;
  nodeEnv: string;
}

export function loadEnvConfig(): EnvConfig {
  const model = process.env.ANTHROPIC_MODEL ?? '';
  // Data dir: use AGENTIC_SDK_DATA_DIR, or DATA_DIR, or default to project-root/data
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const dataDir = process.env.AGENTIC_SDK_DATA_DIR
    ?? process.env.DATA_DIR
    ?? path.join(projectRoot, 'data');

  return {
    port: parseInt(process.env.AGENTIC_SDK_PORT ?? process.env.PORT ?? '3100', 10),
    apiAccessKey: process.env.API_ACCESS_KEY ?? '',
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
    anthropicAuthToken: process.env.ANTHROPIC_AUTH_TOKEN ?? '',
    anthropicModel: model,
    anthropicDefaultOpusModel: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? model,
    anthropicDefaultSonnetModel: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? model,
    anthropicDefaultHaikuModel: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? model,
    dataDir,
    logLevel: process.env.LOG_LEVEL ?? 'debug',
    nodeEnv: process.env.NODE_ENV ?? 'development',
  };
}
