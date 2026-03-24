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

function hasRoomPlaceholder(value: string): boolean {
  return /\{room_id\}|room_id/i.test(value);
}

function resolveRoomTemplate(value: string, roomId?: string): string {
  const trimmed = trimQuotes(value);
  if (!hasRoomPlaceholder(trimmed)) {
    return trimmed;
  }

  const normalizedRoomId = (roomId || '').trim();
  if (!normalizedRoomId) {
    return trimmed;
  }

  return trimmed
    .replace(/\{room_id\}/gi, normalizedRoomId)
    .replace(/room_id/gi, normalizedRoomId);
}

export function resolveApiHookUrl(hookEnvValues?: HookEnvMapLike, _hostname?: string, roomId?: string): string {
  const resolvedRoomId = (roomId || readVar('PROJECT_ID', hookEnvValues)).trim();
  const domainTemplate = readVar('API_HOOK_URL_DOMAIN', hookEnvValues);
  if (domainTemplate) {
    return resolveRoomTemplate(domainTemplate, resolvedRoomId);
  }

  const explicit = readVar('API_HOOK_URL', hookEnvValues);
  if (explicit) {
    return resolveRoomTemplate(explicit, resolvedRoomId);
  }

  const local = readVar('API_HOOK_URL_LOCAL', hookEnvValues);
  if (local) {
    return resolveRoomTemplate(local, resolvedRoomId);
  }

  return '';
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
