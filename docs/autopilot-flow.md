# Autopilot Flow

How the fully autonomous task processor works end-to-end.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND                                                       │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │ autopilot-   │  │ use-autopilot.ts │  │ autopilot-        │  │
│  │ toggle.tsx   │──│ (Socket.io hook) │──│ store.ts (Zustand)│  │
│  └──────────────┘  └──────────────────┘  └───────────────────┘  │
│         │                   ▲                      ▲            │
│         │ emit              │ on                   │ set        │
└─────────┼───────────────────┼──────────────────────┼────────────┘
          │                   │                      │
     Socket.io           Socket.io              socket-provider.tsx
          │                   │                 (global listener)
          ▼                   │                      │
┌─────────────────────────────┼──────────────────────┼────────────┐
│  BACKEND                    │                      │            │
│  ┌──────────────┐     ┌─────┴──────────┐    ┌─────┴─────────┐  │
│  │ server.ts    │────▶│ AutopilotMgr   │───▶│ AgentManager  │  │
│  │ (Socket      │     │ (autopilot.ts) │    │ (Claude SDK)  │  │
│  │  handlers)   │     └────────────────┘    └───────────────┘  │
│  └──────────────┘              │                    │           │
│                                ▼                    ▼           │
│                          ┌──────────┐        ┌───────────┐     │
│                          │ SQLite   │        │ Claude    │     │
│                          │ (Drizzle)│        │ Code CLI  │     │
│                          └──────────┘        └───────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Complete Flow

### 1. Enable Autopilot

```
User clicks toggle → autopilot-toggle.tsx
  → socket.emit('autopilot:enable', { projectId })
    → server.ts handler
      → autopilotManager.enable(projectId)
        → Persists state: appSettings['autopilot_enabled_{projectId}'] = 'true'
        → Registers question listener on agentManager (once)
      → autopilotManager.planAndReorder(projectId, deps)
```

### 2. Planning Phase

Runs only when **>=2 TODO tasks** exist. Skips straight to processing if 0-1 tasks.

```
planAndReorder()
  → phase = 'planning'
  → emit('autopilot:status') to update UI
  → Query all TODO tasks ordered by position
  → Initialize TaskContext with all todo titles
  → Build planning prompt with task list
  → Create temp internal task + attempt in DB
  → agentManager.start({ attemptId, projectPath, prompt, maxTurns: 1 })
  → AI analyzes dependencies, returns JSON array of reordered IDs
  → Parse response from attemptLogs
  → Reorder task positions in DB
  → Clean up temp planning task
  → phase = 'processing'
  → emit('autopilot:planned')
  → pickNextTask()
```

**Planning prompt:**
```
Given these tasks, analyze dependencies and return optimal execution order.
Tasks:
1. [ID: xxx] Task title: description
2. [ID: yyy] Task title: description
Return ONLY a JSON array of task IDs: ["xxx", "yyy"]
```

### 3. Pick Next Task

```
pickNextTask(projectId)
  → Guard: exit if disabled or already processing a task
  → Query TODO tasks ordered by position
  → Filter out skipped tasks
  → If no available tasks:
      phase = 'idle', emit status, return
  → Take first available task
  → startTask(task, deps)
```

### 4. Start Task (Agent Execution)

```
startTask(task)
  → Create attempt with autopilot-injected prompt
  → Update task status: todo → in_progress
  → emit('task:updated') → kanban board updates
  → Track: currentTaskId, attemptToProject, taskContext
  → agentManager.start({ attemptId, projectPath, prompt })
  → emit('autopilot:task-started')
  → emit('task:started')
```

**Autopilot prompt injection appended to task description:**
```
[AUTOPILOT MODE] You are running in fully autonomous mode. Important rules:
- Do NOT use AskUserQuestion tool. There is no human available.
- Make all decisions yourself based on the task description.
- If something is ambiguous, choose the most reasonable approach and proceed.
- For any permission or confirmation, proceed with YES/allow.
- Complete the task fully without asking for clarification.

Tasks already completed: Task A, Task B
Remaining tasks after this: Task C, Task D
```

### 5. Question Interception

If the agent calls `AskUserQuestion` despite the prompt:

```
agentManager emits 'question' event
  → registerQuestionListener handler fires
  → Check: attemptId belongs to autopilot project?
  → If yes: suppress (don't write tool_result — CLI auto-handles)
  → Clear persistent question to prevent stale UI state
```

**Why suppress instead of answer?** The Claude Code CLI already auto-responds to `AskUserQuestion` via its own `tool_result`. Writing a second `tool_result` causes duplicate user messages and API 400 errors.

### 6. Task Completion

```
Agent exits → agentManager emits 'exit' event
  → server.ts exit handler
    → Determine exit status (code 0 = completed, else failed)
    → autopilotManager.onTaskFinished(taskId, status, deps)
```

#### 6a. Success (exit code 0)

```
onTaskFinished(taskId, 'completed')
  → Task status: in_progress → in_review
  → Add task title to completedTitles in TaskContext
  → Remove from allTodoTitles
  → Increment processedCount
  → Clear currentTaskId, retryCounts
  → emit('task:updated'), emit('autopilot:status')
  → setTimeout(3s) → pickNextTask()
```

**Note:** Tasks go to `in_review`, NOT `done`. Human reviews autopilot work manually.

#### 6b. Failure (non-zero exit)

```
onTaskFinished(taskId, 'failed')
  → Increment retryCount for this task
  → If retries < 3:
      → emit status
      → setTimeout(3s) → startTask(task) again (fresh session, no resume)
  → If retries >= 3 (MAX_RETRIES):
      → Task status: in_progress → todo (moved back)
      → Add taskId to skippedTaskIds
      → emit('task:updated'), emit('autopilot:status')
      → setTimeout(3s) → pickNextTask() (skips this task)
```

#### 6c. Cancelled

```
onTaskFinished(taskId, 'cancelled')
  → Clear currentTaskId, retryCounts
  → emit status
  → Stop (no next task picked)
```

### 7. Idle State

When no more TODO tasks remain (or all remaining are skipped):

```
pickNextTask() finds 0 available tasks
  → phase = 'idle'
  → emit('autopilot:status')
  → User reviews in_review tasks manually
  → User can mark tasks done or move back to todo
```

### 8. Disable Autopilot

```
User clicks toggle → socket.emit('autopilot:disable', { projectId })
  → autopilotManager.disable(projectId)
    → Remove from activeProjects
    → Clear currentTaskId, taskContexts
    → Delete appSettings['autopilot_enabled_{projectId}']
    → phase = 'idle'
  → emit('autopilot:status')
```

### 9. Server Restart Recovery

```
Server boots → autopilotManager.restoreFromSettings(db, schema)
  → Scan appSettings for 'autopilot_enabled_*' keys
  → Re-add to activeProjects with idle phase
  → Does NOT auto-resume processing (requires user re-trigger)
```

---

## State Machine

```
         enable
  OFF ──────────► PLANNING ──► PROCESSING ──► IDLE
   ▲                               │  ▲          │
   │                               │  │          │
   │ disable            task done  │  │ pick     │ new tasks
   └───────────────────────────────┘  └──────────┘
                                   │
                          failure  │  retry (max 3)
                                   └──► PROCESSING
```

**Phases:** `idle` | `planning` | `processing`

---

## Key Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_RETRIES` | 3 | Retries per failed task before skipping |
| `PICK_DELAY_MS` | 3000 | Delay (ms) before picking next task |

---

## Socket Events

| Event | Direction | Payload | When |
|-------|-----------|---------|------|
| `autopilot:enable` | Client→Server | `{ projectId }` | User enables |
| `autopilot:disable` | Client→Server | `{ projectId }` | User disables |
| `autopilot:status-request` | Client→Server | `{ projectId }` | Client polls |
| `autopilot:status` | Server→Client | `AutopilotStatus` | Any state change |
| `autopilot:planned` | Server→Client | `{ projectId, ...status }` | Planning done |
| `autopilot:task-started` | Server→Client | `{ projectId, taskId, attemptId, ...status }` | Task begins |
| `task:updated` | Server→Client | Full task object | Task status changes |
| `task:started` | Server→Client | `{ taskId }` | Task agent launched |

---

## Key Files

| File | Role |
|------|------|
| `src/lib/autopilot.ts` | Core engine — `AutopilotManager` class |
| `server.ts` | Socket handlers, exit handler integration |
| `src/hooks/use-autopilot.ts` | Frontend Socket.io hook |
| `src/stores/autopilot-store.ts` | Zustand state per project |
| `src/components/kanban/autopilot-toggle.tsx` | UI toggle button |
| `src/components/providers/socket-provider.tsx` | Global socket listener |
| `src/lib/agent-manager.ts` | Agent lifecycle, emits `question`/`exit` events |

---

## Master Context Awareness

Each project maintains a `TaskContext` that gives the agent big-picture awareness:

- **allTodoTitles** — All tasks remaining at start of autopilot run
- **completedTitles** — Tasks finished so far in current run
- **Current task details** — id, title, description, attemptId

This context is injected into each task's prompt so the agent understands the overall workflow and can maintain coherence across sequential tasks.
