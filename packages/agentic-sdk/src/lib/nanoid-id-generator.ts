/**
 * Nanoid-based unique ID generator with optional prefix support.
 * Generates URL-safe 21-character IDs, optionally prefixed for readability.
 */
import { nanoid } from 'nanoid';

/**
 * Generate a unique ID with optional prefix.
 * @param prefix - Optional prefix (e.g. 'proj', 'task', 'attempt')
 * @returns Unique ID string like "proj_V1StGXR8_Z5jdHi6B-myT"
 */
export function generateId(prefix?: string): string {
  const id = nanoid(21);
  return prefix ? `${prefix}_${id}` : id;
}
