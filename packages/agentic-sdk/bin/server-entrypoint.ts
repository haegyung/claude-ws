import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env from project root (claude-ws), not from packages/agentic-sdk
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..', '..');
config({ path: path.join(projectRoot, '.env') });

import { createApp } from '../src/app-factory';
import { loadEnvConfig } from '../src/config/env-config';

async function main() {
  const envConfig = loadEnvConfig();
  const app = await createApp(envConfig);

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    await app.listen({ port: envConfig.port, host: '0.0.0.0' });
    app.log.info(`Agentic SDK server listening on port ${envConfig.port}`);
  } catch (err) {
    app.log.error(err, 'Failed to start server');
    process.exit(1);
  }
}

main();
