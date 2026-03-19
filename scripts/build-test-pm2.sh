#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_NAME="${PM2_APP_NAME:-claudews}"
ECOSYSTEM_FILE="${PM2_ECOSYSTEM_FILE:-ecosystem.config.js}"
BUILD_CMD="${BUILD_CMD:-pnpm build}"

# Resolve health URL from env override or fallback to localhost:PORT/api/tunnel/status
if [[ -n "${HEALTH_URL:-}" ]]; then
  HEALTH_URL="$HEALTH_URL"
else
  PORT_VALUE="${PORT:-8556}"
  if [[ -f .env ]]; then
    ENV_PORT="$(grep -E '^PORT=' .env | tail -n1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)"
    if [[ -n "$ENV_PORT" ]]; then
      PORT_VALUE="$ENV_PORT"
    fi
  fi
  HEALTH_URL="http://127.0.0.1:${PORT_VALUE}/api/tunnel/status"
fi

RETRY_COUNT="${HEALTH_RETRY_COUNT:-20}"
RETRY_DELAY_SECONDS="${HEALTH_RETRY_DELAY_SECONDS:-2}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "❌ Missing required command: $1"
    exit 1
  fi
}

need_cmd pnpm
need_cmd pm2
need_cmd curl

echo "📦 Building project..."
$BUILD_CMD

echo "🚀 Starting/Restarting PM2 app: $APP_NAME"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  if [[ ! -f "$ECOSYSTEM_FILE" ]]; then
    echo "❌ Ecosystem file not found: $ECOSYSTEM_FILE"
    exit 1
  fi

  # Prefer starting the specific app in ecosystem; fallback to starting entire file.
  if ! pm2 start "$ECOSYSTEM_FILE" --only "$APP_NAME"; then
    pm2 start "$ECOSYSTEM_FILE"
  fi
fi

pm2 save >/dev/null

echo "🩺 Health check: $HEALTH_URL"
attempt=1
while (( attempt <= RETRY_COUNT )); do
  if curl -fsS --max-time 8 "$HEALTH_URL" >/dev/null; then
    echo "✅ Health check passed (attempt $attempt/$RETRY_COUNT)"
    pm2 status "$APP_NAME"
    echo "✅ PM2 build + test completed"
    exit 0
  fi

  echo "⏳ Waiting for service... ($attempt/$RETRY_COUNT)"
  sleep "$RETRY_DELAY_SECONDS"
  ((attempt++))
done

echo "❌ Health check failed after $RETRY_COUNT attempts"
pm2 status "$APP_NAME" || true
echo "--- Last 120 lines of PM2 logs for $APP_NAME ---"
pm2 logs "$APP_NAME" --lines 120 --nostream || true
exit 1
