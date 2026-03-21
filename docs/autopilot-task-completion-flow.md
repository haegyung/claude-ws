# Autopilot Task Completion & Retry Flow

## Provider → Exit Event Pipeline

Both providers converge to a single `agentManager.emit('exit')` event in server.ts:

```
┌──────────────────────────┐   ┌──────────────────────────┐
│ CLI Provider              │   │ SDK Provider              │
│ child.on('exit', code)    │   │ conversation.run()        │
│ └─ emit('complete')       │   │ └─ emit('complete'/'error')│
└────────────┬─────────────┘   └────────────┬─────────────┘
             │                               │
             └───────────┬───────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────┐
│ agent-event-wiring.ts (shared by both providers)         │
│  on('complete') → emit('exit', { attemptId, code: 0 })   │
│  on('error')    → emit('exit', { attemptId, code: 1 })   │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│ server.ts — agentManager.on('exit')                      │
│                                                          │
│  status = attempt.status === 'cancelled' ? 'cancelled'   │
│         : code === 0 ? 'completed' : 'failed'            │
│                                                          │
│  → update attempt in DB                                  │
│  → emit task:finished socket event                       │
│  → route to autopilot or manual handler                  │
└─────────────────────────────────────────────────────────┘
```

**Key**: CLI `exit code 0` = completed, `exit code != 0` = failed.
SDK `conversation resolves` = completed, `rejects` = failed.
Both converge at agent-event-wiring.ts → same exit event.

---

## Mode Matrix

| Autopilot | AskUserQuestion | Mode Name | Question Behavior |
|-----------|----------------|-----------|-------------------|
| OFF | — | Manual | No autopilot involvement |
| ON | OFF | Autonomous (2-phase) | Gathering → Autonomous |
| ON | ON | Interactive | Questions always allowed |

---

## Flow 1: Autopilot OFF (Manual Mode)

```
agentManager exit event (server.ts) — CLI or SDK
│
├─ status = completed
│  └─ task.status = in_progress
│     └─ → in_review (direct, no validation)
│
├─ status = failed
│  └─ keep in_progress (manual retry by user)
│
└─ status = cancelled
   └─ no DB change
```

**Questions**: Always allowed (no autopilot gating).

---

## Flow 2: Autopilot ON, AskUserQuestion OFF (Autonomous 2-Phase)

### Task Startup

```
startTask()
│
├─ questionPhase = 'gathering'
│  ├─ Prompt: "Ask ALL questions NOW in single AskUserQuestion call"
│  └─ 30s fallback timer starts
│
├─ Agent calls AskUserQuestion?
│  ├─ YES → question allowed (gathering phase)
│  │        user answers → questionResolved event
│  │        → questionPhase = 'autonomous'
│  │        → all future questions SUPPRESSED
│  │
│  └─ NO (within 30s) → timer fires
│     → questionPhase = 'autonomous'
│
└─ Agent runs task autonomously
```

### Task Completion

```
agentManager exit event → onTaskFinished()  [CLI or SDK]
│
├─ isAutopilotTask? (tracked in currentTaskId map)
│
│  ├─ YES (autopilot-started task)
│  │  │
│  │  ├─ hasRestartCommand? (pm2 restart detected)
│  │  │  └─ YES + failed → treat as completed
│  │  │
│  │  ├─ effectiveStatus = completed
│  │  │  └─ → in_review (direct, no validation)
│  │  │     → pickNextTask()
│  │  │
│  │  ├─ effectiveStatus = failed
│  │  │  ├─ retries < 3 → retryTask (resume session + continue)
│  │  │  │                 task stays in_progress
│  │  │  └─ retries ≥ 3 → skip task
│  │  │                    → todo, add to skippedTaskIds
│  │  │                    → pickNextTask()
│  │  │
│  │  └─ effectiveStatus = cancelled
│  │     └─ clean up, no retry
│  │
│  └─ NO (manually-started task while autopilot is on)
│     │
│     ├─ completed → in_review (direct, no validation)
│     │
│     └─ failed
│        ├─ retries < 3 → keep in_progress, retryTask (resume session)
│        └─ retries ≥ 3 → keep in_progress, skip + pickNextTask
```

### Idle Timeout (Worker Sweep every 30s)

```
AutopilotWorker.checkTask()
│
├─ Agent alive?
│  ├─ YES → check idle timeout (default 60s)
│  │  ├─ idle > timeout → cancel agent
│  │  │                    → mark attempt failed
│  │  │                    → recoverTask() → onTaskFinished(failed)
│  │  │                    → retry flow (see above)
│  │  └─ not idle → skip (agent working normally)
│  │
│  └─ NO (agent dead, attempt stuck)
│     ├─ attempt.status = completed/failed → recoverTask()
│     │  └─ → onTaskFinished() → normal completion/retry flow
│     └─ attempt.status = running (orphan) → mark failed → recoverTask()
```

### Startup Sweep (on server restart)

```
sweepOnStartup()
│
├─ Fix stale 'running' attempts (no live agent) → mark failed
│
├─ For each in_progress task (no live agent):
│  ├─ has live agent → skip
│  └─ no live agent → keep in_progress, delegate to onTaskFinished()
│     ├─ autopilot enabled → retryTask (resume session context)
│     └─ autopilot disabled → keep in_progress (manual retry)
│
│  NOTE: Never auto-promote to in_review on startup.
│  Task may have been interrupted mid-work by pm2 restart.
```

---

## Flow 3: Autopilot ON, AskUserQuestion ON (Interactive)

### Task Startup

```
startTask()
│
├─ questionPhase = 'interactive'
│  ├─ No gathering prompt injected
│  └─ No suppression — questions always pass through
│
└─ Agent runs task with full user interaction
```

### Task Completion

Same as Flow 2 completion (no difference in exit handling).
Only difference: questions are never suppressed during execution.

---

## Answer Delivery Paths

```
AskUserQuestion emitted by agent
│
├─ Path A: Frontend socket.io
│  └─ question:answer → setAnswer in store
│     → answerQuestion() (resolves SDK Promise / writes CLI stdin)
│     → success? clear persistent store
│
├─ Path B: HTTP POST /api/tasks/:id/pending-question/answer
│  └─ same flow, idempotent (alreadyAnswered check)
│
└─ Path C: Autopilot suppression (autonomous phase)
   └─ clearPersistentQuestion → agent never sees question
```

---

## Status Transitions Summary

```
todo → in_progress → in_review → done (user manually approves)
                  ↑       │
                  │       └─ (user rejects → todo)
                  │
                  └── retry loop (max 3, then → todo + skipped)
```

| Trigger | From | To | Condition |
|---------|------|----|-----------|
| Agent completed (CLI/SDK) | in_progress | in_review | Always (no validation) |
| Agent failed (CLI/SDK) | in_progress | in_progress | Stays, retryTask resumes session |
| Max retries (3) | in_progress | todo | Added to skippedTaskIds |
| Idle timeout | in_progress | in_progress | Attempt cancelled, retry |
| Restart command | in_progress | in_review | Failed treated as completed |
| Server restart | in_progress | in_progress | Sweep → retryTask resumes session |
| User cancel | in_progress | — | No status change |

---

## Edge Cases

| Scenario | What happens |
|----------|-------------|
| Server restart during task | Running attempts marked failed. All in_progress tasks stay in_progress → `onTaskFinished` → `retryTask` resumes prior session with continuation prompt. Never auto-promoted to in_review. |
| Agent hangs (no events) | Idle timeout (60s default) detected by worker sweep → cancel + retry via `retryTask`. |
| Dual answer (socket.io + HTTP) | First write wins. `setAnswer` is idempotent, POST returns `alreadyAnswered: true`. |
| Agent asks question in autonomous phase | Suppressed immediately via `clearPersistentQuestion`. Agent never blocks. |
| 30s gathering timer fires while question pending | Timer checks `questionPhase` before acting — skips if still gathering (question in flight). |
| Restart command detected (pm2 restart) | `failed` exit treated as `completed` → in_review. |
