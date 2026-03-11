# Agentic SDK Server

Headless backend for [claude-ws](https://github.com/Claude-Workspace/claude-ws) — exposes the full claude-ws API as pure REST + SSE without the frontend UI. Built for programmatic task execution, CI/CD pipelines, automation scripts, and custom integrations.

## What is this?

The main claude-ws ships a Next.js app with a full UI (Kanban board, code editor, etc.). This package is a **lightweight Fastify alternative** that implements the same API contract but without:

- No frontend (no React, no Next.js)
- No Socket.io (uses SSE for streaming)
- No browser needed

Use it when you want to **control Claude Code agents programmatically** — create projects, queue tasks, stream agent output, and retrieve results via HTTP.

## Quick Start

```bash
# From the claude-ws project root
pnpm install

# Development (with file watching)
pnpm agentic-sdk:dev

# Production
pnpm agentic-sdk:start
```

Server starts at `http://localhost:3100`.

## Configuration

All environment variables are read from the **parent claude-ws `.env`** file.

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENTIC_SDK_PORT` | Server port | `3100` |
| `AGENTIC_SDK_DATA_DIR` | SQLite + uploads directory | `<project-root>/data` |
| `API_ACCESS_KEY` | API key for `x-api-key` header auth (empty = no auth) | — |
| `ANTHROPIC_BASE_URL` | Anthropic API base URL (or compatible endpoint) | `https://api.anthropic.com` |
| `ANTHROPIC_AUTH_TOKEN` | Auth token for the Anthropic API | — |
| `ANTHROPIC_MODEL` | Default model for agent queries | — |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Model for opus tier | Falls back to `ANTHROPIC_MODEL` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Model for sonnet tier | Falls back to `ANTHROPIC_MODEL` |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Model for haiku tier | Falls back to `ANTHROPIC_MODEL` |
| `LOG_LEVEL` | Pino log level | `debug` |

### Example `.env`

```env
API_ACCESS_KEY=my-secret-key
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_AUTH_TOKEN=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

## Usage Example

```bash
KEY="my-secret-key"

# Create a project
curl -X POST http://localhost:3100/api/projects \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"name": "my-app", "path": "/home/user/my-app"}'

# Create a task
curl -X POST http://localhost:3100/api/tasks \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"projectId": "proj_...", "title": "Add auth module"}'

# Run an agent (queue mode — returns immediately)
curl -X POST http://localhost:3100/api/attempts \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"taskId": "task_...", "prompt": "Implement JWT authentication"}'

# Stream agent output via SSE
curl -N http://localhost:3100/api/attempts/atmp_.../stream \
  -H "x-api-key: $KEY"

# Or run synchronously (waits for completion)
curl -X POST http://localhost:3100/api/attempts \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"taskId": "task_...", "prompt": "Fix the login bug", "request_method": "sync"}'
```

## API Endpoints

### Core

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (no auth) |
| GET | `/api/auth/verify` | Verify API key |
| GET | `/api/filesystem/info` | Server filesystem metadata |
| GET | `/api/commands` | List available slash commands |

### Projects

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List all projects |
| GET | `/api/projects/:id` | Get project |
| POST | `/api/projects` | Create project |
| PUT | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project (cascades) |

### Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tasks?projectId=` | List tasks |
| GET | `/api/tasks/:id` | Get task |
| POST | `/api/tasks` | Create task |
| PUT | `/api/tasks/:id` | Update task |
| DELETE | `/api/tasks/:id` | Delete task |
| PUT | `/api/tasks/:id/reorder` | Reorder task |
| GET | `/api/tasks/:id/attempts` | List task attempts |
| GET | `/api/tasks/:id/conversation` | Get conversation logs |

### Attempts (Agent Execution)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/attempts` | Create attempt and start agent |
| GET | `/api/attempts/:id` | Get attempt with logs |
| GET | `/api/attempts/:id/status` | Lightweight status check |
| GET | `/api/attempts/:id/stream` | SSE stream of real-time output |
| POST | `/api/attempts/:id/cancel` | Cancel running attempt |
| POST | `/api/attempts/:id/answer` | Answer agent question |

#### Attempt Options

```json
{
  "taskId": "task_...",
  "prompt": "Build the auth module",
  "force_create": true,
  "projectName": "my-project",
  "taskTitle": "Auth module",
  "projectRootPath": "/path/to/project",
  "request_method": "queue",
  "output_format": "json",
  "output_schema": "{ users: [{ name, email }] }",
  "timeout": 300000
}
```

- `force_create` — auto-creates project + task if they don't exist
- `request_method` — `queue` (default) or `sync` (waits for completion)
- `output_format` / `output_schema` — structured output instructions

### Checkpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tasks/:taskId/checkpoints` | List checkpoints |
| POST | `/api/tasks/:taskId/checkpoints` | Create checkpoint |
| POST | `/api/tasks/:taskId/checkpoints/:id/rewind` | Rewind to checkpoint |
| POST | `/api/tasks/:taskId/checkpoints/backfill` | Bulk insert checkpoints |

### Files & Search

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/files?projectPath=&subPath=` | List directory |
| GET | `/api/files/content?projectPath=&filePath=` | Read file |
| POST | `/api/files` | Write file |
| DELETE | `/api/files?projectPath=&filePath=` | Delete file |
| GET | `/api/search?projectPath=&query=` | Search content |
| GET | `/api/search/files?projectPath=&pattern=` | Search files by name |

### Shells & Uploads

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/shells?projectId=` | List shells |
| POST | `/api/shells` | Create shell record |
| PUT | `/api/shells/:id` | Update shell |
| GET | `/api/uploads?attemptId=` | List uploads |
| POST | `/api/uploads` | Upload file (multipart) |
| DELETE | `/api/uploads/:id` | Delete upload |

### Agent Factory

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agent-factory/plugins` | List plugins |
| POST | `/api/agent-factory/plugins` | Create plugin |
| PUT | `/api/agent-factory/plugins/:id` | Update plugin |
| DELETE | `/api/agent-factory/plugins/:id` | Delete plugin |
| GET | `/api/agent-factory/plugins/:id/file` | Get plugin source |
| PUT | `/api/agent-factory/plugins/:id/file` | Update plugin source |
| POST | `/api/agent-factory/discover` | Discover plugins |
| POST | `/api/agent-factory/projects/:projectId/plugins/:pluginId` | Associate plugin |
| DELETE | `/api/agent-factory/projects/:projectId/plugins/:pluginId` | Disassociate plugin |

## Architecture

```
packages/agentic-sdk/
├── bin/
│   └── server-entrypoint.ts            # Entry point, dotenv, graceful shutdown
└── src/
    ├── index.ts                        # Public API exports
    ├── app-factory.ts                  # Wires plugins, services, routes, agent
    ├── fastify-app-setup.ts            # CORS, multipart, request logging
    ├── config/
    │   └── env-config.ts               # Typed env var loading
    ├── db/
    │   ├── database-schema.ts          # Drizzle ORM schema (13 tables)
    │   ├── database-connection.ts      # SQLite WAL + foreign keys
    │   └── database-init-tables.ts     # Migrations
    ├── plugins/
    │   ├── fastify-auth-plugin.ts      # x-api-key timing-safe auth
    │   └── fastify-error-handler-plugin.ts
    ├── agent/
    │   ├── claude-sdk-agent-provider.ts          # SDK query(), MCP config
    │   ├── agent-lifecycle-manager.ts            # Start/cancel orchestration
    │   ├── claude-sdk-message-to-output-adapter.ts
    │   └── agent-start-options-and-event-types.ts
    ├── services/                       # Database + filesystem services
    ├── routes/                         # Fastify route handlers
    └── lib/                            # Logger, ID generator, crypto
```

## Tech Stack

- **Fastify 5** — HTTP server
- **SQLite + Drizzle ORM** — Local-first database (same schema as claude-ws)
- **Claude Agent SDK** — `@anthropic-ai/claude-agent-sdk` for agent execution
- **SSE** — Server-Sent Events for real-time streaming
- **Pino** — Structured logging

## Authentication

Set `API_ACCESS_KEY` in `.env` to enable auth. All requests must include the `x-api-key` header. `/health` is always public. When `API_ACCESS_KEY` is empty, all requests are allowed.

## License

MIT
