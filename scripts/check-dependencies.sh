#!/bin/bash
set -e

echo "🔍 Checking dependencies for production build..."
echo ""

# Find all imports from source files
echo "Scanning imports in src/, server.ts, next.config.ts..."
IMPORTS=$(find src -name "*.ts" -o -name "*.tsx" | xargs grep -h "^import.*from ['\"]" | sed -E "s/.*from ['\"]([^'\"\/]+).*/\1/" | sort -u)
# Exclude dev-only config files (drizzle.config.ts) — they only run during development
ROOT_IMPORTS=$(grep -h "^import.*from ['\"]" next.config.ts server.ts 2>/dev/null | sed -E "s/.*from ['\"]([^'\"\/]+).*/\1/" | sort -u)

ALL_IMPORTS=$(echo -e "$IMPORTS\n$ROOT_IMPORTS" | sort -u | grep -v "^\." | grep -v "^@/" | grep -v "^node:")

# Get dependencies from package.json
DEPENDENCIES=$(node -pe "Object.keys(require('./package.json').dependencies || {}).join('\n')")
DEV_DEPENDENCIES=$(node -pe "Object.keys(require('./package.json').devDependencies || {}).join('\n')")

echo ""
echo "Checking for production code imports from devDependencies..."
echo ""

ERRORS=0

for import in $ALL_IMPORTS; do
  # Skip Node.js built-ins
  if [[ "$import" =~ ^(fs|path|os|crypto|http|https|stream|util|events|readline|child_process)$ ]]; then
    continue
  fi

  # Check scoped packages (@org/package)
  if [[ "$import" == @* ]]; then
    # Extract org name (e.g., @anthropic-ai, @codemirror)
    org=$(echo "$import" | cut -d'/' -f1)

    # Check if ANY package from this org is in dependencies
    if ! echo "$DEPENDENCIES" | grep -q "^$org"; then
      # Check if it's in devDependencies (BAD)
      if echo "$DEV_DEPENDENCIES" | grep -q "^$org"; then
        echo "❌ ERROR: Production code imports '$org/*' but packages are in devDependencies"
        ERRORS=$((ERRORS + 1))
      fi
    fi
  else
    # Regular package
    if ! echo "$DEPENDENCIES" | grep -q "^$import$"; then
      # Check if it's in devDependencies (BAD)
      if echo "$DEV_DEPENDENCIES" | grep -q "^$import$"; then
        echo "❌ ERROR: Production code imports '$import' but it's in devDependencies"
        ERRORS=$((ERRORS + 1))
      fi
    fi
  fi
done

echo ""
if [ $ERRORS -eq 0 ]; then
  echo "✅ All production imports are in dependencies!"
  exit 0
else
  echo "❌ Found $ERRORS dependency issues"
  echo ""
  echo "Fix: Move packages from devDependencies to dependencies in package.json"
  exit 1
fi
