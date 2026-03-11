/**
 * SQLite database connection factory with WAL mode and foreign keys enabled
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import path from 'path';
import * as schema from './database-schema.ts';

export function createDbConnection(dataDir: string) {
  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Ensure tmp dir exists for formatted output files
  const tmpDir = path.join(dataDir, 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'agentic-sdk.db');
  const sqlite = new Database(dbPath);

  // WAL mode for better concurrent read performance
  sqlite.pragma('journal_mode = WAL');

  // Required for CASCADE deletes to work
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  return { sqlite, db };
}

export type DbConnection = ReturnType<typeof createDbConnection>;
export type DrizzleDb = DbConnection['db'];
