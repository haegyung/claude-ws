/**
 * Migration 001: Shared Session Directory Symlink
 *
 * Symlinks SDK's projects/ dir to ~/.claude/projects/ so both SDK and CLI
 * providers share session files for cross-provider resume.
 * Migrates existing SDK sessions before creating symlink.
 */

import { ensureSharedProjectsDir } from '../providers/claude-sdk-shared-session-directory-setup';
import { resolve } from 'path';
import type { Migration } from './migration-runner';

export const migration: Migration = {
  version: 1,
  name: 'shared-session-directory-symlink',
  run: () => {
    const isolatedConfigDir = resolve(
      process.env.DATA_DIR || './data',
      'claude-sdk-isolated-config'
    );
    ensureSharedProjectsDir(isolatedConfigDir);
  },
};
