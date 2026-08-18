#!/usr/bin/env bash
#
# provisioning-drive.sh — driver + failsafes for the tenant provisioning state machine.
#
# Subcommands:
#   preflight   Validate config and prove the endpoint is deployed + auth-enforced.
#               NO SIDE EFFECTS — never advances a job.
#   sweep       One authenticated tick. Fires reconcileOrphanedTenants() (drift sweep).
#   drive       Repeatedly tick until every active job reaches a terminal state.
#   verify      Confirm nothing is left in flight after a drive.
#
# Env:
#   APP_URL        required   e.g. https://jeffistores.in
#   CRON_SECRET    required for sweep/drive/verify (not for preflight)
#   MAX_MINUTES    drive only, default 25
#   TICK_INTERVAL  seconds between ticks, default 20
#   LOG_FILE       optional path to append a full tick log (for CI artifacts)
#
# Exit codes:
#   0 ok   1 failure//misconfiguration   2 finished with jobs still in flight (deadline)
#
# WHY THE FAILSAFES LOOK LIKE THIS — mirrors src/lib/provisioning/steps.ts:
#   * advanceProvisioningJob() returns ONLY 'pending' | 'done' | 'failed'.
#     A raw "error: ..." string can only come from the worker route's own catch,
#     which means something failed OUTSIDE the engine's try (e.g. control-plane DB
#     unreachable) — that is treated as infrastructure-level and is NOT retried blindly.
#   * The engine self-terminates: MAX_PROVISION_ATTEMPTS=8, backoff 15s→10min cap,
#     and wait_db_available has its own 25-min deadline. So this driver must NOT
#     abort a job on stall — it reports and lets the engine own termination.
#   * results[].step is the step the job was on BEFORE the tick, so "progress"
#     means the step changed between ticks.
#   * A job in retry-backoff is skipped by activeProvisioningJobs() until
#     next_attempt_at passes, so `advanced == 0` for ONE tick is not proof of
#     completion — hence the consecutive-idle debounce.
set -uo pipefail

CMD="${1:-}"

# ---- engine constants (keep in sync with steps.ts) ---------------------------
ENGINE_WAIT_DB_DEADLINE_MIN=25   # DB_WAIT_DEADLINE_MS
ENGINE_BACKOFF_CAP_MIN=10        # BACKOFF_CAP_MS
IDLE_TICKS_TO_FINISH=2           # debounce against retry-backoff false finishes

APP_URL="${APP_URL:-}"
CRON_SECRET="${CRON_SECRET:-}"
MAX_MINUTES="${MAX_MINUTES:-25}"
TICK_INTERVAL="${TICK_INTERVAL:-20}"
LOG_FILE="${LOG_FILE:-}"

# ---- output helpers ----------------------------------------------------------
_ts() { date -u +%H:%M:%SZ; }
log()  { printf '[%s] %s\n' "$(_ts)" "$*"; [ -n "$LOG_FILE" ] && printf '[%s] %s\n' "$(_ts)" "$*" >> "$LOG_FILE"; return 0; }
warn() { printf '::warning::%s\n' "$*"; log "WARN: $*"; }
err()  { printf '::error::%s\n' "$*";   log "ERROR: $*"; }
summary() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY"; return 0; }
gh_out()  { [ -n "${GITHUB_OUTPUT:-}" ] && printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"; return 0; }

# ---- HTTP with bounded retry -------------------------------------------------
HTTP_CODE=""; HTTP_BODY=""; HTTP_ERR=""

http_call() {
  local url="$1" token="${2:-}" timeout="${3:-90}"
  local body_file err_file
  body_file="$(mktemp)"; err_file="$(mktemp)"
  local -a args=( -sS --max-time "$timeout" -o "$body_file" -w '%{http_code}' )
  [ -n "$token" ] && args+=( -H "Authorization: Bearer ${token}" )
  HTTP_CODE="$(curl "${args[@]}" "$url" 2>"$err_file")" || HTTP_CODE="000"
  HTTP_BODY="$(cat "$body_file" 2>/dev/null)"
  HTTP_ERR="$(cat "$err_file" 2>/dev/null)"
  rm -f "$body_file" "$err_file"
}

# Retries ONLY genuinely transient conditions. 4xx (auth/not-found) are definitive
# and must surface immediately rather than burning the retry budget.
http_retry() {
  local url="$1" token="${2:-}" timeout="${3:-90}" attempts="${4:-3}"
  local i delay=3
  for (( i = 1; i <= attempts; i++ )); do
    http_call "$url" "$token" "$timeout"
    case "$HTTP_CODE" in
      000|408|429|5??)
        if [ "$i" -lt "$attempts" ]; then
          log "  transient HTTP ${HTTP_CODE} (${HTTP_ERR:-no detail}) — retry ${i}/${attempts} in ${delay}s"
          sleep "$delay"; delay=$(( delay * 2 ))
        fi
        ;;
      *) return 0 ;;
    esac
  done
  return 0
}

is_json() { printf '%s' "${1:-}" | jq -e . >/dev/null 2>&1; }
jqr() { printf '%s' "${1:-}" | jq -r "$2" 2>/dev/null; }

require_tools() {
  local missing=""
  for t in curl jq; do command -v "$t" >/dev/null 2>&1 || missing="$missing $t"; done
  [ -n "$missing" ] && { err "missing required tool(s):$missing"; return 1; }
  return 0
}

endpoint_url() { printf '%s/api/cron/provisioning-worker' "${APP_URL%/}"; }
ready_url()    { printf '%s/api/ready' "${APP_URL%/}"; }

# =============================================================================
# preflight — prove we CAN drive before we try. No side effects.
# =============================================================================
cmd_preflight() {
  local rc=0
  require_tools || return 1

  if [ -z "$APP_URL" ]; then
    err "APP_URL is not set."
    return 1
  fi
  case "$APP_URL" in
    https://*) ;;
    *) err "APP_URL must be https (got: ${APP_URL}). CRON_SECRET must never cross plaintext HTTP."; return 1 ;;
  esac

  log "endpoint: $(endpoint_url)"

  # --- 1. app readiness (DB + Redis reachable). Driving a half-booted app just
  #        burns attempts against the engine's 8-attempt cap. ---
  http_retry "$(ready_url)" "" 20 5
  case "$HTTP_CODE" in
    200) log "readiness: OK" ;;
    404) warn "readiness: /api/ready returned 404 — older build without the liveness/readiness split. Continuing." ;;
    000) err "readiness: ${APP_URL} unreachable (${HTTP_ERR:-timeout}). Is the app up?"; rc=1 ;;
    *)   err "readiness: HTTP ${HTTP_CODE} — app is not ready to serve. Refusing to drive."; rc=1 ;;
  esac

  # --- 2. endpoint deployed + auth enforced. Probe with a DELIBERATELY INVALID
  #        token: proves the route exists and rejects bad auth WITHOUT advancing
  #        any job. The route 401s whenever the header != Bearer $CRON_SECRET. ---
  http_retry "$(endpoint_url)" "preflight-invalid-token-$(date +%s)" 20 3
  case "$HTTP_CODE" in
    401)
      log "auth probe: OK (401 on bad token, as expected)"
      ;;
    404)
      err "auth probe: 404 — /api/cron/provisioning-worker is NOT DEPLOYED. The route ships with PR #425; if that is unmerged, prod does not have it yet."
      rc=1
      ;;
    200)
      err "auth probe: 200 on an INVALID token — the endpoint is NOT authenticating. Anyone could drive provisioning. Check CRON_SECRET is set in the app env; refusing to continue."
      rc=1
      ;;
    000)
      err "auth probe: endpoint unreachable (${HTTP_ERR:-timeout})."
      rc=1
      ;;
    *)
      warn "auth probe: unexpected HTTP ${HTTP_CODE} (expected 401). Continuing, but verify the route."
      ;;
  esac

  # --- 3. our own secret must exist for the stages that follow ---
  if [ -z "$CRON_SECRET" ]; then
    err "CRON_SECRET is empty — sweep/drive would 401. Set it as a repository secret."
    rc=1
  elif [ "${#CRON_SECRET}" -lt 16 ]; then
    warn "CRON_SECRET is only ${#CRON_SECRET} chars — short for a bearer token."
  fi

  if [ "$rc" -eq 0 ]; then
    log "preflight PASSED"
    summary "✅ **Preflight passed** — endpoint deployed, auth enforced, app ready."
    gh_out ok true
  else
    summary "❌ **Preflight failed** — see the log. Nothing was driven."
    gh_out ok false
  fi
  return "$rc"
}

# =============================================================================
# tick — one authenticated call. Sets TICK_* globals. Returns 1 on HTTP failure.
# =============================================================================
TICK_ADVANCED=0; TICK_RECONCILED=0; TICK_RESULTS=""; TICK_RAW=""
do_tick() {
  http_retry "$(endpoint_url)" "$CRON_SECRET" 300 3
  TICK_RAW="$HTTP_BODY"

  if [ "$HTTP_CODE" != "200" ]; then
    case "$HTTP_CODE" in
      401) err "tick: 401 Unauthorized — CRON_SECRET does not match the app's value." ;;
      404) err "tick: 404 — worker route not deployed." ;;
      000) warn "tick: transport failure (${HTTP_ERR:-timeout})." ;;
      *)   warn "tick: HTTP ${HTTP_CODE}." ;;
    esac
    return 1
  fi

  # A 200 that is not JSON means something upstream (nginx/CDN) answered, not the app.
  if ! is_json "$TICK_RAW"; then
    warn "tick: 200 but body is not JSON — an upstream proxy likely answered. First 200 chars: $(printf '%s' "$TICK_RAW" | head -c 200)"
    return 1
  fi

  TICK_ADVANCED="$(jqr "$TICK_RAW" '.advanced // 0')"
  TICK_RECONCILED="$(jqr "$TICK_RAW" '.reconciled // [] | length')"
  TICK_RESULTS="$(jqr "$TICK_RAW" '.results[]? | [.tenantId, .step, .status] | @tsv')"
  return 0
}

report_reconciled() {
  [ "${TICK_RECONCILED:-0}" = "0" ] && return 0
  warn "${TICK_RECONCILED} tenant(s) were active with NO live infra and have been suspended. This means a provision failed partway or an RDS vanished out-of-band — those tenants were at risk of falling back to the MAIN database."
  jqr "$TICK_RAW" '.reconciled[]?' | while read -r t; do log "  suspended: $t"; done
  return 0
}

# =============================================================================
# sweep — scheduled path. One tick; the value is reconcileOrphanedTenants().
# =============================================================================
cmd_sweep() {
  require_tools || return 1
  [ -z "$CRON_SECRET" ] && { err "CRON_SECRET not set."; return 1; }

  if ! do_tick; then
    err "sweep tick failed."
    summary "❌ **Drift sweep failed** — the reconciliation sweep did not run."
    return 1
  fi

  log "sweep OK — reconciled=${TICK_RECONCILED}, jobs advanced=${TICK_ADVANCED}"
  report_reconciled

  summary "### Drift sweep"
  summary ""
  summary "- Orphaned tenants reconciled: **${TICK_RECONCILED}**"
  summary "- In-flight jobs advanced: **${TICK_ADVANCED}**"
  if [ "${TICK_ADVANCED}" != "0" ]; then
    summary ""
    summary "> ⚠️ Jobs were in flight during a scheduled sweep. Provisioning is operator-driven —"
    summary "> run this workflow manually (\`workflow_dispatch\`) to drive them to completion."
    warn "${TICK_ADVANCED} job(s) in flight but nobody is driving them. Trigger a manual run."
  fi
  gh_out reconciled "${TICK_RECONCILED}"
  return 0
}

# =============================================================================
# drive — loop until terminal. Reports stalls; never aborts a job itself.
# =============================================================================
cmd_drive() {
  require_tools || return 1
  [ -z "$CRON_SECRET" ] && { err "CRON_SECRET not set."; return 1; }

  case "$MAX_MINUTES" in
    ''|*[!0-9]*) err "MAX_MINUTES must be an integer (got '${MAX_MINUTES}')."; return 1 ;;
  esac
  if [ "$MAX_MINUTES" -lt 1 ] || [ "$MAX_MINUTES" -gt 120 ]; then
    err "MAX_MINUTES must be 1..120 (got ${MAX_MINUTES})."; return 1
  fi

  local state_file next_state deadline now tick=0 idle=0
  local consec_http_fail=0 any_failed=0 any_infra_error=0 saw_done=0
  state_file="$(mktemp)"; next_state="$(mktemp)"
  deadline=$(( $(date +%s) + MAX_MINUTES * 60 ))

  log "driving for up to ${MAX_MINUTES}m (tick every ${TICK_INTERVAL}s)"

  while :; do
    now="$(date +%s)"
    if [ "$now" -ge "$deadline" ]; then
      warn "hit the ${MAX_MINUTES}m limit with work still in flight. RDS creation alone takes ~10 min. Re-running this workflow is SAFE and IDEMPOTENT — it resumes from the current step."
      rm -f "$state_file" "$next_state"
      gh_out outcome deadline
      gh_out ticks "$tick"
      return 2
    fi

    tick=$(( tick + 1 ))

    if ! do_tick; then
      consec_http_fail=$(( consec_http_fail + 1 ))
      # 401/404 are definitive — do_tick already errored; don't grind.
      if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "404" ]; then
        rm -f "$state_file" "$next_state"; gh_out outcome config_error; return 1
      fi
      if [ "$consec_http_fail" -ge 5 ]; then
        err "5 consecutive tick failures — the app looks down. Aborting. In-flight jobs are unaffected and resume on the next run."
        rm -f "$state_file" "$next_state"; gh_out outcome unreachable; return 1
      fi
      sleep "$TICK_INTERVAL"; continue
    fi
    consec_http_fail=0

    report_reconciled

    # --- classify this tick's results, and track per-(tenant,step) age ---
    : > "$next_state"
    if [ -n "$TICK_RESULTS" ]; then
      while IFS=$'\t' read -r tid step status; do
        [ -z "${tid:-}" ] && continue
        log "  tenant=${tid} step=${step} -> ${status}"

        case "$status" in
          done)
            saw_done=1
            log "  ✅ ${tid} provisioning COMPLETE"
            ;;
          failed)
            any_failed=1
            err "tenant ${tid} FAILED at step '${step}'. The engine has already attempted auto-rollback (DNS + infra removed, status suspended) so no billable resources should be leaked — VERIFY in the console, then inspect provisioning_jobs.last_error."
            ;;
          error:*)
            # Only reachable from the worker route's own catch => outside the engine's
            # try/catch, i.e. control-plane DB trouble. Not a step failure.
            any_infra_error=1
            warn "tenant ${tid}: worker-level error at step '${step}': ${status}. This is OUTSIDE the state machine (likely control-plane DB) — the job itself was not marked failed."
            ;;
        esac

        # stall accounting: keep first-seen timestamp while (tenant,step) is unchanged
        local first_seen age budget
        first_seen="$(awk -F'\t' -v t="$tid" -v s="$step" '$1==t && $2==s {print $3; exit}' "$state_file")"
        [ -z "${first_seen:-}" ] && first_seen="$now"
        printf '%s\t%s\t%s\n' "$tid" "$step" "$first_seen" >> "$next_state"

        age=$(( now - first_seen ))
        if [ "$step" = "wait_db_available" ]; then
          budget=$(( (ENGINE_WAIT_DB_DEADLINE_MIN + 2) * 60 ))
        else
          budget=$(( (ENGINE_BACKOFF_CAP_MIN + 2) * 60 ))
        fi
        if [ "$age" -gt "$budget" ]; then
          warn "tenant ${tid} has been on step '${step}' for $(( age / 60 ))m, beyond the engine's own budget. The engine should self-terminate this job (25m deadline on wait_db_available, 8-attempt cap elsewhere) — if it has not, inspect provisioning_jobs manually."
        fi
      done <<< "$TICK_RESULTS"
    fi
    mv -f "$next_state" "$state_file"

    # --- completion debounce ---
    if [ "${TICK_ADVANCED}" = "0" ]; then
      idle=$(( idle + 1 ))
      log "  (no active jobs — idle ${idle}/${IDLE_TICKS_TO_FINISH})"
      if [ "$idle" -ge "$IDLE_TICKS_TO_FINISH" ]; then
        log "no active jobs remaining after ${tick} tick(s)."
        break
      fi
    else
      idle=0
    fi

    sleep "$TICK_INTERVAL"
  done

  rm -f "$state_file" "$next_state"
  gh_out ticks "$tick"

  summary "### Provisioning drive"
  summary ""
  summary "- Ticks: **${tick}**"
  summary "- Completed this run: **$([ "$saw_done" = "1" ] && echo yes || echo none)**"

  if [ "$any_failed" = "1" ]; then
    summary "- Result: ❌ **at least one job FAILED** (auto-rollback attempted — verify no orphaned RDS/bucket)"
    gh_out outcome failed
    return 1
  fi
  if [ "$any_infra_error" = "1" ]; then
    summary "- Result: ⚠️ **worker-level errors** (control-plane trouble, jobs not marked failed)"
    gh_out outcome infra_error
    return 1
  fi
  summary "- Result: ✅ **clean — nothing left in flight**"
  gh_out outcome success
  return 0
}

# =============================================================================
# verify — independent confirmation that nothing is still in flight.
# =============================================================================
cmd_verify() {
  require_tools || return 1
  [ -z "$CRON_SECRET" ] && { err "CRON_SECRET not set."; return 1; }

  if ! do_tick; then
    warn "verify tick failed — could not confirm final state."
    return 1
  fi
  report_reconciled

  if [ "${TICK_ADVANCED}" != "0" ]; then
    warn "verify: ${TICK_ADVANCED} job(s) STILL in flight after the drive stage. Re-run the workflow to continue (safe + idempotent)."
    summary "### Verify"
    summary ""
    summary "⚠️ **${TICK_ADVANCED} job(s) still in flight.** Re-run to continue driving."
    return 1
  fi

  if printf '%s' "$TICK_RAW" | jq -e '.results[]? | select(.status == "failed")' >/dev/null 2>&1; then
    err "verify: a job is in a FAILED terminal state."
    summary "### Verify"
    summary ""
    summary "❌ **A job ended in \`failed\`.** Check \`provisioning_jobs.last_error\` and confirm rollback left no billable resources."
    return 1
  fi

  log "verify OK — no active jobs, no failures."
  summary "### Verify"
  summary ""
  summary "✅ **Confirmed:** no jobs in flight, no failures."
  return 0
}

# =============================================================================
case "${CMD:-}" in
  preflight) cmd_preflight ;;
  sweep)     cmd_sweep ;;
  drive)     cmd_drive ;;
  verify)    cmd_verify ;;
  *)
    printf 'usage: %s {preflight|sweep|drive|verify}\n' "$(basename "$0")" >&2
    exit 64
    ;;
esac

