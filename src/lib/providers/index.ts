/**
 * Provider Registry — Factory for Claude providers
 */

import type { Provider, ProviderId } from './types';
import { ClaudeSDKProvider } from './claude-sdk-provider';
import { ClaudeCLIProvider } from './claude-cli-provider';

export type { Provider, ProviderId, ProviderSession, ProviderStartOptions, ProviderEventData } from './types';

const providers = new Map<ProviderId, Provider>();

function getOrCreate(id: ProviderId): Provider {
  if (!providers.has(id)) {
    switch (id) {
      case 'claude-sdk':
        providers.set(id, new ClaudeSDKProvider());
        break;
      case 'claude-cli':
        providers.set(id, new ClaudeCLIProvider());
        break;
      default:
        throw new Error(`Unknown provider: ${id}`);
    }
  }
  return providers.get(id)!;
}

/**
 * Get the active provider based on CLAUDE_PROVIDER env var.
 * Default: 'claude-sdk'
 */
export function getActiveProvider(): Provider {
  const envProvider = process.env.CLAUDE_PROVIDER;
  const id: ProviderId = envProvider === 'cli' ? 'claude-cli' : 'claude-sdk';
  return getOrCreate(id);
}

/**
 * Get a specific provider by ID
 */
export function getProvider(id: ProviderId): Provider {
  return getOrCreate(id);
}
