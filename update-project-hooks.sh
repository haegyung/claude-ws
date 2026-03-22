#!/bin/bash

# Script to update minio sync hooks for all projects
# Backs up existing hooks before applying updates

SCRIPT_DIR="/home/roxane/Privos/claudews"
TEMPLATE_PULL="$SCRIPT_DIR/src/hooks/template/hooks/minio-pull-sync.ts"
TEMPLATE_PUSH="$SCRIPT_DIR/src/hooks/template/hooks/minio-push-sync.ts"
PROJECTS_DIR="$SCRIPT_DIR/data/projects"
BACKUP_DIR="$SCRIPT_DIR/.claude/hooks-backup-$(date +%Y%m%d_%H%M%S)"
LOG_FILE="$SCRIPT_DIR/hook-update.log"

# Don't exit on error - we want to process all projects
set +e

echo "==========================================" | tee "$LOG_FILE"
echo "Updating MinIO Sync Hooks for All Projects" | tee -a "$LOG_FILE"
echo "==========================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Check if template files exist
if [ ! -f "$TEMPLATE_PULL" ]; then
    echo "❌ Error: Template pull sync not found: $TEMPLATE_PULL" | tee -a "$LOG_FILE"
    exit 1
fi

if [ ! -f "$TEMPLATE_PUSH" ]; then
    echo "❌ Error: Template push sync not found: $TEMPLATE_PUSH" | tee -a "$LOG_FILE"
    exit 1
fi

# Create backup directory
echo "📦 Creating backup directory: $BACKUP_DIR" | tee -a "$LOG_FILE"
mkdir -p "$BACKUP_DIR"

# Get list of projects
mapfile -t PULL_FILES < <(find "$PROJECTS_DIR" -name "minio-pull-sync.ts")
PROJECT_COUNT=${#PULL_FILES[@]}
echo "📊 Found $PROJECT_COUNT projects to update" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Initialize counters
UPDATED=0
SKIPPED=0
FAILED=0

# Extract project ID from hook env or legacy hook content
extract_project_id() {
    local pull_file="$1"
    local project_dir="$2"
    local env_file="$project_dir/.env"

    # 1) Prefer .env PROJECT_ID (most reliable)
    if [ -f "$env_file" ]; then
        local env_id
        env_id=$(grep -oP '^\s*PROJECT_ID\s*=\s*"?\K[^"]+' "$env_file" 2>/dev/null || true)
        if [ -n "$env_id" ]; then
            echo "$env_id"
            return 0
        fi
    fi

    # 2) Legacy pull hook pattern
    local legacy_id
    legacy_id=$(grep -oP 'targetPrefix:\s*"\K[^"]+' "$pull_file" 2>/dev/null || true)
    if [ -n "$legacy_id" ]; then
        echo "$legacy_id"
        return 0
    fi

    # 3) Fallback to PROJECT_ID in hook source
    local source_id
    source_id=$(grep -oP 'PROJECT_ID[^\n]*\|\|\s*"\K[^"]+' "$pull_file" 2>/dev/null || true)
    if [ -n "$source_id" ]; then
        echo "$source_id"
        return 0
    fi

    return 1
}

# Process each project
for PULL_FILE in "${PULL_FILES[@]}"; do
    PROJECT_DIR="$(dirname "$PULL_FILE")"
    PROJECT_NAME="$(basename "$(dirname "$(dirname "$PROJECT_DIR")")")"
    PUSH_FILE="$PROJECT_DIR/minio-push-sync.ts"

    echo "🔄 Processing: $PROJECT_NAME" | tee -a "$LOG_FILE"

    # Backup existing hooks
    BACKUP_PROJECT_DIR="$BACKUP_DIR/$PROJECT_NAME"
    mkdir -p "$BACKUP_PROJECT_DIR"

    if [ -f "$PULL_FILE" ]; then
        cp "$PULL_FILE" "$BACKUP_PROJECT_DIR/minio-pull-sync.ts.bak" 2>/dev/null
    fi

    if [ -f "$PUSH_FILE" ]; then
        cp "$PUSH_FILE" "$BACKUP_PROJECT_DIR/minio-push-sync.ts.bak" 2>/dev/null
    fi

    # Extract project ID from .env first, then fallback patterns
    PROJECT_ID=$(extract_project_id "$PULL_FILE" "$PROJECT_DIR" || echo "")

    if [ -z "$PROJECT_ID" ]; then
        echo "  ⚠️  Could not extract project ID, skipping..." | tee -a "$LOG_FILE"
        ((SKIPPED++))
        echo "" | tee -a "$LOG_FILE"
        continue
    fi

    # Update pull sync
    UPDATE_SUCCESS=true

    sed "s/__PROJECT_ID__/$PROJECT_ID/g" "$TEMPLATE_PULL" > "$PULL_FILE.tmp" 2>/dev/null

    if [ $? -eq 0 ] && [ -f "$PULL_FILE.tmp" ]; then
        mv "$PULL_FILE.tmp" "$PULL_FILE"
        echo "  ✅ Updated minio-pull-sync.ts" | tee -a "$LOG_FILE"
    else
        echo "  ❌ Failed to update minio-pull-sync.ts" | tee -a "$LOG_FILE"
        UPDATE_SUCCESS=false
    fi

    # Update push sync
    sed "s/__PROJECT_ID__/$PROJECT_ID/g" "$TEMPLATE_PUSH" > "$PUSH_FILE.tmp" 2>/dev/null

    if [ $? -eq 0 ] && [ -f "$PUSH_FILE.tmp" ]; then
        mv "$PUSH_FILE.tmp" "$PUSH_FILE"
        echo "  ✅ Updated minio-push-sync.ts" | tee -a "$LOG_FILE"
    else
        echo "  ❌ Failed to update minio-push-sync.ts" | tee -a "$LOG_FILE"
        UPDATE_SUCCESS=false
    fi

    if [ "$UPDATE_SUCCESS" = true ]; then
        ((UPDATED++))
    else
        ((FAILED++))
    fi

    echo "" | tee -a "$LOG_FILE"
done

echo "==========================================" | tee -a "$LOG_FILE"
echo "Update Summary" | tee -a "$LOG_FILE"
echo "==========================================" | tee -a "$LOG_FILE"
echo "📊 Projects found:    $PROJECT_COUNT" | tee -a "$LOG_FILE"
echo "✅ Updated:           $UPDATED" | tee -a "$LOG_FILE"
echo "⚠️  Skipped:           $SKIPPED" | tee -a "$LOG_FILE"
echo "❌ Failed:            $FAILED" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "📦 Backups saved to:  $BACKUP_DIR" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "✨ Update complete!" | tee -a "$LOG_FILE"
