/**
 * Incremental Migration Runner
 *
 * Runs numbered migrations on every server startup. Tracks the current
 * migration version in the `app_settings` table (key: 'migration_version').
 *
 * Covers all data-layer changes: DB schema, config folder, data folder.
 * Each migration runs exactly once, in order, and is idempotent as a safety net.
 *
 * To add a new migration:
 * 1. Create src/lib/migrations/NNN-descriptive-name.ts exporting { version, name, run }
 * 2. Import and append to the `migrations` array below
 * 3. The runner auto-executes it on next server start
 */

import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { createLogger } from '../logger';
import { migration as m001 } from './001-shared-session-directory-symlink';
import { migration as m002 } from './002-autopilot-mode-column';

const log = createLogger('MigrationRunner');

export interface Migration {
  version: number;
  name: string;
  /** Must be synchronous — server startup blocks on migrations. */
  run: () => void;
}

/**
 * Registry of all migrations, in order.
 * Append new migrations here after creating the file.
 */
const migrations: Migration[] = [
  m001,
  m002,
];

const MIGRATION_VERSION_KEY = 'migration_version';

function getCurrentVersion(): number {
  try {
    const row = db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, MIGRATION_VERSION_KEY))
      .get();
    if (!row) return 0;
    const parsed = parseInt(row.value, 10);
    return isNaN(parsed) ? 0 : parsed;
  } catch {
    return 0;
  }
}

function setCurrentVersion(version: number): void {
  db.insert(schema.appSettings)
    .values({ key: MIGRATION_VERSION_KEY, value: String(version), updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: String(version), updatedAt: Date.now() },
    })
    .run();
}

/**
 * Run all pending migrations. Call once at server startup, after initDb().
 */
export function runMigrations(): void {
  // Validate registry is sorted with no gaps
  for (let i = 0; i < migrations.length; i++) {
    if (migrations[i].version !== i + 1) {
      throw new Error(`Migration registry out of order: expected version ${i + 1}, got ${migrations[i].version}`);
    }
  }

  const currentVersion = getCurrentVersion();
  const pending = migrations.filter(m => m.version > currentVersion);

  if (pending.length === 0) {
    log.debug({ currentVersion }, 'No pending migrations');
    return;
  }

  log.info({ currentVersion, pending: pending.length }, 'Running migrations');

  for (const m of pending) {
    try {
      log.info({ version: m.version, name: m.name }, 'Running migration');
      m.run();
      setCurrentVersion(m.version);
      log.info({ version: m.version, name: m.name }, 'Migration completed');
    } catch (err) {
      log.error({ err, version: m.version, name: m.name }, 'Migration failed — halting');
      throw err;
    }
  }
}
