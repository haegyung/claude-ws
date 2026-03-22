# Claude CLI Model Filtering

## Overview
This change implements automatic filtering of Claude Code CLI models from the model selector when the Claude CLI binary is not installed on the system.

## Problem
When the Claude CLI binary is not installed, the model selector still shows "Claude Code CLI" models, which cannot be used and will cause errors when selected.

## Solution
The solution implements a check for Claude CLI availability and filters the model list accordingly:

### Changes Made

#### 1. `/src/app/api/models/route.ts`
- **Added `isClaudeCLIAvailable()` function**: Uses the existing `findClaudePath()` utility to detect if Claude CLI binary is available
- **Modified `buildModelList()` function**:
  - Added CLI availability check
  - Only includes CLI models (`AVAILABLE_MODELS`) if Claude CLI binary is found
  - Always includes SDK models if configured via environment variables
- **Updated `GET` handler**:
  - Automatically falls back to first available model if current model is no longer available
  - Defaults provider to 'claude-sdk' instead of 'claude-cli' when CLI is not available

#### 2. `/src/components/task/chat-model-selector.tsx`
- **Modified model splitting logic**: Added `hasCliModels` flag to track if CLI models are available
- **Updated dropdown rendering**:
  - Conditionally renders "Claude Code CLI" section only when `hasCliModels` is true
  - Hides the section separator when CLI models are not available
  - Shows only "Custom Models" section when CLI is unavailable

#### 3. `/src/stores/model-store.ts`
- **Dynamic provider detection**: Provider is now determined based on available models
- **Smart provider fallback**: Logic checks if CLI models are available before defaulting to 'claude-cli'
- **Affected functions**:
  - `loadModels()`: Determines default provider based on whether CLI models exist in the response
  - `setModel()`: Intelligently infers provider from model or available models
  - `getTaskProvider()`: Uses dynamic provider detection with proper fallback chain
  - Initial store state: Starts with 'claude-cli' but updates based on actual availability

## How It Works

1. **Detection**: When the `/api/models` endpoint is called, it checks for Claude CLI availability using `findClaudePath()`
2. **Filtering**: The model list is built conditionally:
   - If CLI is available: Includes both CLI and SDK models
   - If CLI is not available: Only includes SDK models (if configured)
3. **Provider Detection**: The default provider is dynamically determined:
   - If CLI models exist in the available models list → default to 'claude-cli'
   - If no CLI models exist → default to 'claude-sdk'
   - This ensures the provider matches the actually available models
4. **UI Updates**: The chat model selector component checks if CLI models exist and conditionally shows/hides the CLI section
5. **Fallback**: If a user's previously selected CLI model is no longer available, the system automatically falls back to the first available model with appropriate provider

## Benefits

1. **Better UX**: Users only see models that can actually be used
2. **Prevents Errors**: Eliminates errors from trying to use non-existent CLI binary
3. **Graceful Degradation**: System continues to work with SDK models even when CLI is unavailable
4. **Automatic Detection**: No manual configuration needed - system detects CLI availability automatically
5. **Smart Provider Selection**: Provider defaults to 'claude-cli' when available, 'claude-sdk' otherwise - matching user's actual capabilities

## Testing

To verify the changes:

1. **Without Claude CLI**:
   - Model selector should only show "Custom Models" section
   - No "Claude Code CLI" section should be visible
   - SDK models (if configured) should be available

2. **With Claude CLI installed**:
   - Model selector should show both "Claude Code CLI" and "Custom Models" sections
   - All CLI models should be available

3. **CLI Removed After Selection**:
   - If user had selected a CLI model and CLI is removed
   - System should automatically fall back to available SDK model
   - No errors should occur

## Files Modified

1. `/src/app/api/models/route.ts` - Model availability checking and filtering
2. `/src/components/task/chat-model-selector.tsx` - Conditional UI rendering
3. `/src/stores/model-store.ts` - Default provider updates

## Dependencies

- Uses existing `findClaudePath()` function from `/src/lib/cli-query.ts`
- No new dependencies added
