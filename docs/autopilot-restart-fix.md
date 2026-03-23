# Autopilot Restart Command Fix

## Problem
Autopilot was getting stuck and not moving forward when a task executed a restart command (e.g., `pm2 restart claude-ws`). When the server restarted, the agent process would terminate abruptly with a non-zero exit code, causing autopilot to treat the task as "failed" and either retry it indefinitely or skip it after max retries.

## Root Cause
The issue was in how autopilot determined task status. In `server.ts`, the status was determined by:
```typescript
const status: AttemptStatus = attempt.status === 'cancelled'
  ? 'cancelled'
  : (code === 0 ? 'completed' : 'failed');
```

When a task ran `pm2 restart claude-ws`, the server restart would terminate the agent process with a non-zero exit code, causing the task to be marked as "failed" even though the restart command itself was successful.

## Solution
The fix introduces intelligent detection of restart commands and special handling for them:

### 1. Restart Command Detection
Added patterns to detect restart commands:
- `pm2 restart claude-ws`
- `pm2 restart all`
- `service <name> restart`
- `systemctl restart`
- `restart.sh`

### 2. Command Tracking
- Track bash commands executed by autopilot tasks via the `json` event listener
- When a bash command matches a restart pattern, mark the attempt as having executed a restart command
- Store this in `restartCommandAttempts` Set

### 3. Smart Status Determination
Modified `onTaskFinished` to check if an attempt executed a restart command:
```typescript
const hasRestartCommand = this.restartCommandAttempts.has(attemptId);
const effectiveStatus = (hasRestartCommand && status === 'failed') ? 'completed' : status;
```

If a task with a restart command exits with a failed status, treat it as completed instead.

### 4. Cleanup
- Remove attempt from `restartCommandAttempts` after processing
- Clean up when autopilot is disabled
- Prevent memory leaks by properly tracking attempts

## Benefits
1. **Autopilot continues**: Tasks with restart commands now properly complete and autopilot moves to the next task
2. **No false failures**: Restart commands are recognized as successful operations
3. **Better logging**: Added detailed logging to track restart command detection and handling
4. **Extensible**: Easy to add more restart patterns if needed

## Files Modified
- `src/lib/autopilot.ts`: Added restart command detection and handling logic

## Testing
To test this fix:
1. Create a task that runs `pm2 restart claude-ws`
2. Enable autopilot
3. Verify that the task completes and autopilot moves to the next task instead of getting stuck

## Example Flow
```
1. Autopilot starts task "Restart server"
2. Agent executes: pm2 restart claude-ws
3. Autopilot detects restart command via json event listener
4. Server restarts, agent exits with non-zero code
5. onTaskFinished receives status='failed'
6. Checks restartCommandAttempts - finds the attempt
7. Treats task as 'completed' instead of 'failed'
8. Moves task to 'in_review'
9. Autopilot picks next task and continues
```

## Future Improvements
- Could add more sophisticated patterns for other server management commands
- Could track the actual exit code of restart commands for better accuracy
- Could add user configuration for custom restart patterns
