type HookEnvMapLike = Map<string, string> | undefined;

function trimQuotes(value: string): string {
  return value.trim().replace(/^"|"$/g, '');
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/g, '');
}

function joinUrl(base: string, path: string): string {
  const normalizedBase = stripTrailingSlashes(base);
  const normalizedPath = path.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedPath}`;
}

function readVar(key: string, hookEnvValues?: HookEnvMapLike): string {
  const fromMap = hookEnvValues?.get(key);
  if (fromMap && fromMap.trim()) return trimQuotes(fromMap);

  const fromEnv = process.env[key];
  if (fromEnv && fromEnv.trim()) return trimQuotes(fromEnv);

  return '';
}

function shouldUseLocalByHost(hostname?: string): boolean {
  const fromHost = (hostname || '').toLowerCase();
  const fromEnvHost = (process.env.HOST || '').toLowerCase();
  const appUrl = (process.env.API_BASE_URL || process.env.CORS_ORIGIN || '').toLowerCase();

  const localMarkers = ['localhost', '127.0.0.1', '0.0.0.0'];
  if (fromHost) {
    return localMarkers.some((marker) => fromHost.includes(marker));
  }

  const hasLocalEnvHost = localMarkers.some((marker) => fromEnvHost.includes(marker) || appUrl.includes(marker));
  if (hasLocalEnvHost) return true;

  return process.env.NODE_ENV !== 'production';
}

export function resolveApiHookUrl(hookEnvValues?: HookEnvMapLike, hostname?: string): string {
  const explicit = readVar('API_HOOK_URL', hookEnvValues);
  if (explicit) return explicit;

  const local = readVar('API_HOOK_URL_LOCAL', hookEnvValues);
  const domain = readVar('API_HOOK_URL_DOMAIN', hookEnvValues);

  if (shouldUseLocalByHost(hostname)) {
    return local || domain;
  }

  return domain || local;
}

/**
 * Build sync endpoint URL from either:
 * - new-style base: .../api/sync/ or .../api/v1/internal/rooms/:id/files/
 * - legacy base: http://host:port
 */
export function buildApiHookEndpoint(apiHookUrl: string, endpointPath: string): string {
  const base = stripTrailingSlashes(apiHookUrl);
  const lowerBase = base.toLowerCase();
  const endpoint = endpointPath.replace(/^\/+/, '');

  const isNewStyleBase = lowerBase.endsWith('/api/sync') || lowerBase.endsWith('/files');
  if (isNewStyleBase) {
    return joinUrl(base, endpoint);
  }

  // Backward compatibility for old API_HOOK_URL values that point to app host root.
  return joinUrl(joinUrl(base, 'api/sync'), endpoint);
}
