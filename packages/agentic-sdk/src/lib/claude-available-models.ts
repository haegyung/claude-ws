/**
 * Claude model definitions - single source of truth for available models,
 * display names, and model ID utilities.
 * Model IDs from: https://platform.claude.com/docs/en/about-claude/models/overview
 */

export interface Model {
  id: string;
  name: string;
  description?: string;
  tier: 'opus' | 'sonnet' | 'haiku';
  group?: string;
}

export const AVAILABLE_MODELS: Model[] = [
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    description: 'Most capable model',
    tier: 'opus',
    group: 'Claude Code CLI',
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    description: 'Latest Sonnet model',
    tier: 'sonnet',
    group: 'Claude Code CLI',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    description: 'Fastest model',
    tier: 'haiku',
    group: 'Claude Code CLI',
  },
];

export const DEFAULT_MODEL_ID = 'claude-opus-4-6';
export const DEFAULT_MODEL_ALIAS = 'opus';

export function getModelById(id: string): Model | undefined {
  return AVAILABLE_MODELS.find((m) => m.id === id);
}

export function isValidModelId(id: string): boolean {
  return AVAILABLE_MODELS.some((m) => m.id === id);
}

/**
 * Convert model ID to human-readable display name dynamically.
 * Examples:
 *   claude-opus-4-5-20251101  -> Claude Opus 4.5
 *   my-custom-model-1-0       -> My Custom Model 1.0
 */
export function modelIdToDisplayName(id: string): string {
  const known = getModelById(id);
  if (known) return known.name;

  // Remove date suffix patterns like -20251101
  const withoutDate = id.replace(/-\d{8}$/, '');
  const parts = withoutDate.split('-');
  const result: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    // Merge consecutive single-digit parts into version numbers (e.g. "4" + "5" -> "4.5")
    if (i < parts.length - 1 && /^\d+$/.test(part) && /^\d+$/.test(parts[i + 1])) {
      const nextNext = parts[i + 2];
      if (!nextNext || !/^\d+$/.test(nextNext)) {
        result.push(`${part}.${parts[i + 1]}`);
        i++;
        continue;
      }
    }

    result.push(part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
  }

  return result.join(' ');
}

/** Get display name truncated to max 25 chars. */
export function getModelShortName(id: string): string {
  const model = getModelById(id);
  const name = model ? model.name : modelIdToDisplayName(id);
  return name.length > 25 ? name.slice(0, 22) + '...' : name;
}
