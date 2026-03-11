# Claude Workspace

> **DISCLAIMER:** This software is provided "AS IS" without warranty. [Read full disclaimer](./DISCLAIMER.md).

**Visual workspace for Claude Code** — Kanban board, code editor, Git integration, local-first SQLite.

![Desktop](./public/desktop-review-0.jpeg)

---

## Features

- **Kanban Board** — Drag-and-drop task management with full conversation history
- **Real-time Streaming** — Live Claude responses via Socket.io
- **Checkpoints** — Save and rewind to any conversation state
- **Code Editor** — Tabbed CodeMirror with syntax highlighting and AI suggestions
- **Git Integration** — Status, stage, commit, diff, visual graph
- **Agent Factory** — Plugin system for custom skills, commands, agents
- **Agentic SDK** — Headless REST + SSE backend for programmatic access ([docs](./packages/agentic-sdk/README.md))
- **Themes** — Light, Dark, VS Code variants, Dracula

---

## Quick Start

**Prerequisites:** Node.js 20+, pnpm 9+, [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)

```bash
# Option 1: npx (quick try)
npx -y claude-ws

# Option 2: Global install
npm install -g claude-ws
claude-ws

# Option 3: From source
git clone https://github.com/Claude-Workspace/claude-ws.git
cd claude-ws
pnpm install && pnpm dev
```

Open http://localhost:8556

---

## Project Structure

```
claude-ws/
├── src/                        # Next.js app (frontend + API routes)
├── server.ts                   # Custom server entry point
├── packages/
│   └── agentic-sdk/            # Headless Fastify backend (REST + SSE)
├── public/                     # Static assets, swagger docs
├── drizzle/                    # Database migrations
├── locales/                    # i18n translations
└── scripts/                    # Build and maintenance scripts
```

### Packages

| Package | Description |
|---------|-------------|
| **[agentic-sdk](./packages/agentic-sdk/)** | Standalone Fastify server implementing the full claude-ws API. No frontend, no Socket.io — pure REST + SSE. Use it for headless automation, CI/CD pipelines, or custom integrations. |

---

## Running the Agentic SDK

The agentic-sdk is a headless backend that exposes the same API as the main claude-ws server but without the UI. Useful for programmatic task execution, automation, and integration with external tools.

```bash
# Development (with file watching)
pnpm agentic-sdk:dev

# Production
pnpm agentic-sdk:start
```

Server starts at http://localhost:3100. See [agentic-sdk README](./packages/agentic-sdk/README.md) for full API documentation.

---

## API Documentation

See [Swagger API Docs](README-docs-swagger.md)

---

## Configuration

Create `.env` file at the project root:

```bash
# Server
PORT=8556
API_ACCESS_KEY=your-secret-key

# Anthropic API (or custom proxy)
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_AUTH_TOKEN=your-token
ANTHROPIC_MODEL=claude-sonnet-4-20250514

# Model tier overrides (optional)
ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-6
ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-6
ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-4-5-20251001
```

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8556` |
| `API_ACCESS_KEY` | API authentication key | (empty) |
| `ANTHROPIC_BASE_URL` | Anthropic API base URL (or custom endpoint) | `https://api.anthropic.com` |
| `ANTHROPIC_AUTH_TOKEN` | Auth token for the Anthropic API | — |
| `ANTHROPIC_MODEL` | Default model | — |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Model for opus tier | Falls back to `ANTHROPIC_MODEL` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Model for sonnet tier | Falls back to `ANTHROPIC_MODEL` |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Model for haiku tier | Falls back to `ANTHROPIC_MODEL` |
| `LOG_LEVEL` | Logging level | `debug` (dev), `warn` (prod) |
| `ANTHROPIC_API_RETRY_TIMES` | Retry attempts for failed API requests | `3` |
| `ANTHROPIC_API_RETRY_DELAY_MS` | Delay between retries (ms) | `10000` |

---

## Remote Access

For secure remote access, see [Cloudflare Tunnel Setup](./docs/cloudflare-tunnel.md).

---

## Tech Stack

Next.js 16, React 19, Fastify 5, SQLite + Drizzle ORM, Socket.io, Claude Agent SDK, Tailwind CSS 4, Radix UI, Zustand, Pino

---

## License

MIT
