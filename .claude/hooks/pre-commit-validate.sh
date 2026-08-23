#!/usr/bin/env bash
# Pre-commit validation: secrets, .env files, large files, conflict markers, debug
set -euo pipefail

ERRORS=()
WARNINGS=()

# ── 1. Block .env files ──────────────────────────────────────────────────────
ENV_FILES=$(git diff --cached --name-only 2>/dev/null | grep -E '(^|/)\.env(\.[^/]*)?$' 2>/dev/null || true)
if [ -n "$ENV_FILES" ]; then
  ERRORS+=("BLOCKED: .env file(s) staged: $ENV_FILES")
fi

# ── 2. Credential / secret leak scan ────────────────────────────────────────
DIFF=$(git diff --cached 2>/dev/null || true)
if [ -n "$DIFF" ]; then
  CRED_HITS=$(echo "$DIFF" | grep -nE 2>/dev/null \
    '^\+(AKIA[0-9A-Z]+|sk-[a-zA-Z0-9]+|ghp_[a-zA-Z0-9]+|gho_[a-zA-Z0-9]+|glpat-[a-zA-Z0-9-]+|AIza[0-9A-Za-z_-]+|-----BEGIN [A-Z ]*PRIVATE KEY)' \
    | grep -v '^\+\+\+' 2>/dev/null | head -5 || true)
  if [ -n "$CRED_HITS" ]; then
    ERRORS+=("POSSIBLE SECRET in diff: $CRED_HITS")
  fi

  SECRET_ASSIGN=$(echo "$DIFF" | grep -nE 2>/dev/null \
    '^\+[^+]*(PASSWORD|SECRET|API_KEY|APIKEY|AUTH_TOKEN|ACCESS_TOKEN|PRIVATE_KEY|CLIENT_SECRET)[ ]*[=:][ ]*[^[:space:]][^[:space:]][^[:space:]][^[:space:]][^[:space:]][^[:space:]][^[:space:]][^[:space:]][^[:space:]]+' \
    | grep -ivE '(PLACEHOLDER|EXAMPLE|YOUR_|TODO|test|dummy|fake)' 2>/dev/null | head -5 || true)
  if [ -n "$SECRET_ASSIGN" ]; then
    ERRORS+=("POSSIBLE CREDENTIAL ASSIGNMENT: $SECRET_ASSIGN")
  fi
fi

# ── 3. Merge conflict markers ────────────────────────────────────────────────
CONFLICTS=$(git diff --cached --name-only 2>/dev/null | while IFS= read -r f; do
  git show ":$f" 2>/dev/null | grep -qE '^(<<<<<<<|=======|>>>>>>>)' 2>/dev/null && echo "$f" || true
done || true)
if [ -n "$CONFLICTS" ]; then
  ERRORS+=("MERGE CONFLICT MARKERS in: $CONFLICTS")
fi

# ── 4. Large files (>500 KB) ─────────────────────────────────────────────────
LARGE=$(git diff --cached --name-only 2>/dev/null | while IFS= read -r f; do
  SIZE=$(git cat-file -s ":$f" 2>/dev/null || echo 0)
  [ "$SIZE" -gt 512000 ] && echo "$f ($(( SIZE / 1024 ))KB)" || true
done || true)
if [ -n "$LARGE" ]; then
  WARNINGS+=("Large file(s) staged >500KB: $LARGE")
fi

# ── 5. Debug statements ───────────────────────────────────────────────────────
DEBUG_HITS=$(git diff --cached 2>/dev/null \
  | grep -nE 'console[.]log[(]|debugger;|binding[.]pry|byebug|pdb[.]set_trace' 2>/dev/null \
  | grep -v '^\+\+\+' 2>/dev/null | grep '^+' 2>/dev/null | head -5 || true)
if [ -n "$DEBUG_HITS" ]; then
  WARNINGS+=("Debug statements staged: $DEBUG_HITS")
fi

# ── Output ────────────────────────────────────────────────────────────────────
if [ ${#ERRORS[@]} -gt 0 ]; then
  MSG="PRE-COMMIT BLOCKED:"$'\n'
  for e in "${ERRORS[@]}"; do MSG+="  x $e"$'\n'; done
  for w in "${WARNINGS[@]}"; do MSG+="  ! $w"$'\n'; done
  python3 -c "import json,sys; print(json.dumps({'continue':False,'stopReason':sys.argv[1],'systemMessage':sys.argv[1]}))" "$MSG"
  exit 0
fi

if [ ${#WARNINGS[@]} -gt 0 ]; then
  MSG="PRE-COMMIT WARNINGS (proceeding):"$'\n'
  for w in "${WARNINGS[@]}"; do MSG+="  ! $w"$'\n'; done
  python3 -c "import json,sys; print(json.dumps({'systemMessage':sys.argv[1]}))" "$MSG"
fi

exit 0
