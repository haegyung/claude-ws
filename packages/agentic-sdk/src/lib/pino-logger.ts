/**
 * Centralized Pino logger utility with environment-aware configuration.
 * Development: pino-pretty colorized output at debug level.
 * Production: JSON structured logs respecting LOG_LEVEL env var.
 */

// Use require for pino to avoid esModuleInterop issues and ensure
// compatibility with both Next.js bundler (client/server) and standalone ESM.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';
const level = process.env.LOG_LEVEL || (isDev ? 'debug' : 'warn');

export interface Logger {
  fatal: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  info: (obj: object | string, msg?: string) => void;
  debug: (obj: object | string, msg?: string) => void;
  trace: (obj: object | string, msg?: string) => void;
  child: (bindings: object) => Logger;
}

export const logger: Logger = pino({
  level,
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});

/**
 * Create a child logger with module context binding.
 * @param module - Module name (e.g. 'AuthPlugin', 'DbConnection')
 */
export function createLogger(module: string): Logger {
  return logger.child({ module });
}
