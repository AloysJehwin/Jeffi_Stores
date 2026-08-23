#!/usr/bin/env bash
# Post-commit summary — print hash + message + changed files
set -euo pipefail

HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
MSG=$(git log -1 --pretty=format:"%s" 2>/dev/null || echo "")
FILES=$(git diff-tree --no-commit-id -r --name-only HEAD 2>/dev/null | head -20 || true)
COUNT=$(git diff-tree --no-commit-id -r --name-only HEAD 2>/dev/null | wc -l | tr -d ' ' || echo "?")
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

SUMMARY="Committed [$HASH] on $BRANCH: $MSG ($COUNT file(s) changed)"$'\n'"$FILES"

python3 -c "import json,sys; print(json.dumps({'systemMessage':sys.argv[1]}))" "$SUMMARY"
exit 0
