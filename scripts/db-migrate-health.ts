#!/usr/bin/env tsx
/**
 * Database health migration script
 *
 * Goals:
 * - Backup database before touching data
 * - Add legacy missing columns (idempotent)
 * - Clean orphan rows that can trigger FK-related runtime errors
 * - Verify FK integrity after cleanup
 *
 * Usage:
 *   pnpm db:migrate:health
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from 'dotenv';

type CleanupItem = {
  label: string;
  run: (db: Database.Database) => number;
};

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, type: string): boolean {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    return true;
  } catch {
    return false;
  }
}

function ensureLegacyColumns(db: Database.Database): number {
  let added = 0;
  const attemptsColumns = [
    ['total_tokens', 'INTEGER NOT NULL DEFAULT 0'],
    ['input_tokens', 'INTEGER NOT NULL DEFAULT 0'],
    ['output_tokens', 'INTEGER NOT NULL DEFAULT 0'],
    ['cache_creation_tokens', 'INTEGER NOT NULL DEFAULT 0'],
    ['cache_read_tokens', 'INTEGER NOT NULL DEFAULT 0'],
    ['total_cost_usd', "TEXT NOT NULL DEFAULT '0'"],
    ['num_turns', 'INTEGER NOT NULL DEFAULT 0'],
    ['duration_ms', 'INTEGER NOT NULL DEFAULT 0'],
    ['context_used', 'INTEGER NOT NULL DEFAULT 0'],
    ['context_limit', 'INTEGER NOT NULL DEFAULT 200000'],
    ['context_percentage', 'INTEGER NOT NULL DEFAULT 0'],
    ['baseline_context', 'INTEGER NOT NULL DEFAULT 0'],
    ['output_format', 'TEXT'],
    ['output_schema', 'TEXT'],
  ] as const;

  const tasksColumns = [
    ['chat_init', 'INTEGER NOT NULL DEFAULT 0'],
    ['rewind_session_id', 'TEXT'],
    ['rewind_message_uuid', 'TEXT'],
    ['last_model', 'TEXT'],
    ['last_provider', 'TEXT'],
    ['pending_file_ids', 'TEXT'],
  ] as const;

  const checkpointsColumns = [
    ['git_commit_hash', 'TEXT'],
  ] as const;

  for (const [name, type] of attemptsColumns) if (addColumnIfMissing(db, 'attempts', name, type)) added++;
  for (const [name, type] of tasksColumns) if (addColumnIfMissing(db, 'tasks', name, type)) added++;
  for (const [name, type] of checkpointsColumns) if (addColumnIfMissing(db, 'checkpoints', name, type)) added++;

  return added;
}

function deleteCount(db: Database.Database, sql: string): number {
  const stmt = db.prepare(sql);
  const result = stmt.run();
  return Number(result.changes || 0);
}

function updateCount(db: Database.Database, sql: string): number {
  const stmt = db.prepare(sql);
  const result = stmt.run();
  return Number(result.changes || 0);
}

function run(): void {
  const userCwd = process.env.CLAUDE_WS_USER_CWD || process.cwd();
  config({ path: path.join(userCwd, '.env') });

  const dbDir = process.env.DATA_DIR || path.join(userCwd, 'data');
  const dbPath = path.join(dbDir, 'claude-ws.db');

  if (!fs.existsSync(dbPath)) {
    console.log(`[db:migrate:health] DB not found: ${dbPath}`);
    process.exit(0);
  }

  fs.mkdirSync(dbDir, { recursive: true });
  const backupPath = path.join(dbDir, `claude-ws.db.backup-${nowStamp()}`);
  fs.copyFileSync(dbPath, backupPath);
  console.log(`[db:migrate:health] Backup created: ${backupPath}`);

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const fkBefore = db.prepare('PRAGMA foreign_key_check').all() as any[];
  console.log(`[db:migrate:health] FK violations before: ${fkBefore.length}`);

  const cleanup: CleanupItem[] = [
    { label: 'tasks without project', run: (x) => deleteCount(x, `DELETE FROM tasks WHERE project_id NOT IN (SELECT id FROM projects)`) },
    { label: 'attempts without task', run: (x) => deleteCount(x, `DELETE FROM attempts WHERE task_id NOT IN (SELECT id FROM tasks)`) },
    { label: 'attempt_logs without attempt', run: (x) => deleteCount(x, `DELETE FROM attempt_logs WHERE attempt_id NOT IN (SELECT id FROM attempts)`) },
    { label: 'attempt_files without attempt', run: (x) => deleteCount(x, `DELETE FROM attempt_files WHERE attempt_id NOT IN (SELECT id FROM attempts)`) },
    {
      label: 'checkpoints without task/attempt',
      run: (x) => deleteCount(
        x,
        `DELETE FROM checkpoints
         WHERE task_id NOT IN (SELECT id FROM tasks)
            OR attempt_id NOT IN (SELECT id FROM attempts)`
      ),
    },
    {
      label: 'shells with missing attempt -> NULL',
      run: (x) => updateCount(
        x,
        `UPDATE shells
         SET attempt_id = NULL
         WHERE attempt_id IS NOT NULL
           AND attempt_id NOT IN (SELECT id FROM attempts)`
      ),
    },
    {
      label: 'project_plugins orphan refs',
      run: (x) => deleteCount(
        x,
        `DELETE FROM project_plugins
         WHERE project_id NOT IN (SELECT id FROM projects)
            OR plugin_id NOT IN (SELECT id FROM agent_factory_plugins)`
      ),
    },
    {
      label: 'plugin_dependencies without owner plugin',
      run: (x) => deleteCount(
        x,
        `DELETE FROM plugin_dependencies
         WHERE plugin_id NOT IN (SELECT id FROM agent_factory_plugins)`
      ),
    },
    {
      label: 'plugin_dependencies missing referenced plugin -> NULL',
      run: (x) => updateCount(
        x,
        `UPDATE plugin_dependencies
         SET plugin_dependency_id = NULL
         WHERE plugin_dependency_id IS NOT NULL
           AND plugin_dependency_id NOT IN (SELECT id FROM agent_factory_plugins)`
      ),
    },
    {
      label: 'plugin_dependency_cache missing plugin -> NULL',
      run: (x) => updateCount(
        x,
        `UPDATE plugin_dependency_cache
         SET plugin_id = NULL
         WHERE plugin_id IS NOT NULL
           AND plugin_id NOT IN (SELECT id FROM agent_factory_plugins)`
      ),
    },
    {
      label: 'subagents without attempt',
      run: (x) => deleteCount(x, `DELETE FROM subagents WHERE attempt_id NOT IN (SELECT id FROM attempts)`),
    },
    {
      label: 'tracked_tasks without attempt',
      run: (x) => deleteCount(x, `DELETE FROM tracked_tasks WHERE attempt_id NOT IN (SELECT id FROM attempts)`),
    },
    {
      label: 'agent_messages without attempt',
      run: (x) => deleteCount(x, `DELETE FROM agent_messages WHERE attempt_id NOT IN (SELECT id FROM attempts)`),
    },
  ];

  const tx = db.transaction(() => {
    const addedColumns = ensureLegacyColumns(db);
    console.log(`[db:migrate:health] Added missing columns: ${addedColumns}`);

    let totalChanges = 0;
    for (const item of cleanup) {
      const changed = item.run(db);
      totalChanges += changed;
      if (changed > 0) {
        console.log(`[db:migrate:health] ${item.label}: ${changed}`);
      }
    }
    return totalChanges;
  });

  const changedRows = tx();

  const fkAfter = db.prepare('PRAGMA foreign_key_check').all() as any[];
  const quickCheck = db.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined;
  db.close();

  console.log(`[db:migrate:health] Total repaired rows: ${changedRows}`);
  console.log(`[db:migrate:health] FK violations after: ${fkAfter.length}`);
  console.log(`[db:migrate:health] quick_check: ${quickCheck?.quick_check ?? 'unknown'}`);

  if (fkAfter.length > 0) {
    console.log('[db:migrate:health] WARNING: FK violations remain. Restore backup and inspect manually if needed.');
    process.exit(1);
  }

  console.log('[db:migrate:health] Done.');
}

run();
