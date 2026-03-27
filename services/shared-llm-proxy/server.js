const http = require('node:http');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');

const PORT = Number.parseInt(process.env.SHARED_LLM_PROXY_PORT || '8666', 10);
const HOST = process.env.SHARED_LLM_PROXY_HOST || '0.0.0.0';
const TARGET_BASE = process.env.ANTHROPIC_PROXIED_BASE_URL || 'https://api.anthropic.com';
const RETRY_TIMES = Number.parseInt(process.env.ANTHROPIC_API_RETRY_TIMES || '3', 10);
const RETRY_DELAY_MS = Number.parseInt(process.env.ANTHROPIC_API_RETRY_DELAY_MS || '10000', 10);
const CACHE_TTL_MS = Number.parseInt(process.env.SHARED_LLM_PROXY_CACHE_TTL_MS || '3600000', 10);
const CACHE_MAX_ENTRIES = Number.parseInt(process.env.SHARED_LLM_PROXY_CACHE_MAX_ENTRIES || '5000', 10);

const cache = new Map();

function getConfiguredApiKey() {
  return process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status >= 500;
}

async function fetchWithRetry(url, options, attempt = 1) {
  try {
    const response = await fetch(url, options);
    if (isRetryableStatus(response.status) && attempt < RETRY_TIMES) {
      await sleep(RETRY_DELAY_MS);
      return fetchWithRetry(url, options, attempt + 1);
    }
    return response;
  } catch (error) {
    if (attempt < RETRY_TIMES) {
      await sleep(RETRY_DELAY_MS);
      return fetchWithRetry(url, options, attempt + 1);
    }
    throw error;
  }
}

function pruneExpiredCache(now) {
  for (const [key, entry] of cache.entries()) {
    if (now - entry.cachedAt > CACHE_TTL_MS) {
      cache.delete(key);
    }
  }
}

function evictCacheIfNeeded() {
  while (cache.size > CACHE_MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (!firstKey) {
      break;
    }
    cache.delete(firstKey);
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function normalizeHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'undefined') {
      continue;
    }
    const lower = key.toLowerCase();
    if (
      lower === 'host' ||
      lower === 'connection' ||
      lower === 'content-length' ||
      lower.startsWith('x-forwarded') ||
      lower.startsWith('x-real')
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      headers.set(key, value.join(','));
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

function writeProxyResponse(res, response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'content-encoding' || lower === 'transfer-encoding') {
      return;
    }
    headers[key] = value;
  });

  res.writeHead(response.status, headers);
  if (!response.body) {
    res.end();
    return;
  }

  Readable.fromWeb(response.body).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method || 'GET';
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        service: 'shared-llm-proxy',
        targetBase: TARGET_BASE,
        hasApiKey: Boolean(getConfiguredApiKey()),
      });
      return;
    }

    if (!url.pathname.startsWith('/api/proxy/anthropic')) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    const pathAfterProxy = url.pathname.replace('/api/proxy/anthropic', '') || '/';
    const targetUrl = `${TARGET_BASE}${pathAfterProxy}${url.search}`;
    const bodyBuffer = method === 'GET' || method === 'HEAD' ? Buffer.alloc(0) : await readBody(req);
    const bodyText = bodyBuffer.length > 0 ? bodyBuffer.toString('utf-8') : '';
    const isCountTokens = method === 'POST' && pathAfterProxy.includes('/v1/messages/count_tokens') && bodyText.length > 0;
    const apiKey = getConfiguredApiKey();

    const headers = normalizeHeaders(req);
    if (!headers.has('x-api-key') && !headers.has('authorization')) {
      if (!apiKey) {
        sendJson(res, 503, {
          error: 'PROXY_KEY_NOT_CONFIGURED',
          message: 'Shared LLM proxy is missing ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY',
        });
        return;
      }
      headers.set('x-api-key', apiKey);
    }

    if (isCountTokens) {
      const now = Date.now();
      pruneExpiredCache(now);
      const cacheKey = createHash('sha256').update(bodyText).digest('hex');
      const cached = cache.get(cacheKey);
      if (cached && now - cached.cachedAt <= CACHE_TTL_MS) {
        res.writeHead(cached.status, cached.headers);
        res.end(cached.body);
        return;
      }

      const response = await fetchWithRetry(targetUrl, {
        method,
        headers,
        body: bodyBuffer,
      });
      const responseBody = await response.text();
      const responseHeaders = {};
      response.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (lower === 'content-encoding' || lower === 'transfer-encoding') {
          return;
        }
        responseHeaders[key] = value;
      });

      if (response.ok) {
        cache.set(cacheKey, {
          status: response.status,
          headers: responseHeaders,
          body: responseBody,
          cachedAt: Date.now(),
        });
        evictCacheIfNeeded();
      }

      res.writeHead(response.status, responseHeaders);
      res.end(responseBody);
      return;
    }

    const response = await fetchWithRetry(targetUrl, {
      method,
      headers,
      body: bodyBuffer.length > 0 ? bodyBuffer : undefined,
    });
    writeProxyResponse(res, response);
  } catch (error) {
    sendJson(res, 500, {
      error: 'PROXY_INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[shared-llm-proxy] listening on http://${HOST}:${PORT}`);
});
