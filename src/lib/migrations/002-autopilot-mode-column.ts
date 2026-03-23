// Migration: Add autopilot_mode column to projects table
// Replaces old appSettings-based autopilot_enabled_{projectId} keys
import type { Migration } from './migration-runner';
import Database from 'better-sqlite3';

export const migration: Migration = {
  version: 2,
  name: 'autopilot-mode-column',
  run: () => {
    // Access the underlying better-sqlite3 instance
    const { db } = require('../db');
    const sqlite: Database.Database = (db as any).session?.client;

    // Add column (idempotent: catch if already exists)
    try {
      sqlite.exec(`ALTER TABLE projects ADD COLUMN autopilot_mode TEXT NOT NULL DEFAULT 'off'`);
    } catch {
      // Column already exists
    }

    // Migrate old appSettings keys to new column
    const oldSettings = sqlite.prepare(
      `SELECT key, value FROM app_settings WHERE key LIKE 'autopilot_enabled_%'`
    ).all() as Array<{ key: string; value: string }>;

    for (const setting of oldSettings) {
      if (setting.value === 'true') {
        const projectId = setting.key.replace('autopilot_enabled_', '');
        // Previously enabled → 'autonomous' (closest match to old boolean)
        sqlite.prepare(
          `UPDATE projects SET autopilot_mode = 'autonomous' WHERE id = ?`
        ).run(projectId);
      }
    }

    // Clean up old keys
    sqlite.prepare(`DELETE FROM app_settings WHERE key LIKE 'autopilot_enabled_%'`).run();
  },
};
