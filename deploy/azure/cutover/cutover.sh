#!/bin/bash
# Phase E cutover driver (docs/plans/AZURE_MOVE_AND_AI_GATEWAY_PLAN.md): platform core from AWS to Azure, stores stay on AWS.
# Steps, in order: preflight freeze final-dump-restore identity dns cloudfront smoke unfreeze.
# Dry run by default (reads only); --apply acts, with a typed confirmation before each irreversible step.
#   EDGE_IP=<AWS tenant edge EIP> AZURE_IP=52.172.147.62 bash deploy/azure/cutover/cutover.sh [--apply]
#   ... --step <name>    one step        ... --from <name>   that step and everything after it       --list
# Inputs (env): EDGE_IP, AZURE_IP (required); CUTOVER_DATE (export once at T-0); CUTOVER_SHA (image sha deployed on
#   Azure, default: this checkout's); RESTORE_CLEAN=1 (restore over a non-empty Azure DB); RESTORE_ALLOW_ERRORS=1
#   (carry on after pg_restore reports errors); SMOKE_TENANTS=1 (also smoke the stores in the Azure cluster);
#   UNFREEZE_AWS=1 (bring the AWS cluster back too, see README); BACKUPS_DIR, AWS_KUBECONFIG, AZ_KUBECONFIG.
# Artifacts and the rollback inputs: ~/Documents/db-backups/cutover-<date>/ ; timestamps: cutover-<date>.log
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
STEPS=(preflight freeze final-dump-restore identity dns cloudfront smoke unfreeze)
AZURE_IP=${AZURE_IP:-}; EDGE_IP=${EDGE_IP:-}
export RUN_DIR ANTH_TENANT ANTH_SA ANTH_RULE_AZURE RESTORE_CLEAN=${RESTORE_CLEAN:-} RESTORE_ALLOW_ERRORS=${RESTORE_ALLOW_ERRORS:-}
need_ips() { [ -n "$EDGE_IP" ] && [ -n "$AZURE_IP" ] || die "set EDGE_IP and AZURE_IP"; }
route53() { EDGE_IP=$EDGE_IP AZURE_IP=$AZURE_IP OUT_DIR=$1 bash "$R53" "${@:2}"; }

step_preflight() {
  local bad=0 sha out
  ko() { echo "   FAIL $*" >&2; bad=1; }
  need aws az kubectl psql python3 curl
  for v in EDGE_IP AZURE_IP; do
    [[ ${!v} =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] && echo "   ok $v=${!v}" || ko "$v is not set to an IPv4 address"
  done
  [ -d "$RUN_DIR" ] && [ -w "$RUN_DIR" ] && touch "$LOG" 2>/dev/null && echo "   ok backups writable ($RUN_DIR)" || ko "$RUN_DIR / $LOG not writable"
  for f in "$AWS_KUBECONFIG" "$AZ_KUBECONFIG"; do [ -s "$f" ] && echo "   ok $f" || ko "missing kubeconfig $f"; done
  if [ -s "$AWS_FREEZE_STATE" ] && ! grep -q '^freeze ' "$RUN_DIR/done.txt" 2>/dev/null; then
    ko "$AWS_FREEZE_STATE exists but this window has not frozen: a stale freeze? (freeze.sh off, or remove it)"
  fi
  [ $bad = 0 ] || return 1
  say "DNS TTLs already lowered (route53-plan.sh --lower-ttl finds nothing left to lower)"
  out=$(route53 "$SCRATCH" --lower-ttl 2>&1) || { echo "$out" >&2; ko "route53-plan.sh --lower-ttl failed"; }
  grep -E '^ +|change\(s\)' <<<"$out" || true
  grep -q '^0 change(s)' <<<"$out" && echo "   ok TTLs at 60 or alias" || ko "records still have TTL > 60: run route53-plan.sh --lower-ttl --apply and wait out the old TTL"
  say "Azure Postgres reachable (jeffi_stores as app_user)"
  lib_run azure 'tunnel; psql_app jeffi_stores -Atc "select current_user || '"' on '"' || current_database() || '"', public tables: '"' || (select count(*) from pg_tables where schemaname = '"'public'"')"' \
    && echo "   ok" || ko "Azure Postgres not reachable"
  say "Azure platform healthy (smoke.sh flagship, public hosts through --connect-to $AZURE_IP)"
  sha=${CUTOVER_SHA:-$(image_sha)}
  JEFFI_CLOUD=azure KUBECONFIG=$AZ_KUBECONFIG SMOKE_CONNECT_TO="::$AZURE_IP:" bash "$BOOT/smoke.sh" "$sha" flagship || ko "Azure smoke failed (sha $sha: set CUTOVER_SHA to what Release - Azure deployed)"
  [ $bad = 0 ] || return 1
  echo; echo "Preflight passed."
}

step_freeze() {
  say "Write freeze of the live (AWS) cluster: CronJobs suspended, app Deployments to 0, Redis kept (freeze.sh on)"
  if ! $APPLY; then echo "(dry run) would run freeze.sh on against $AWS_KUBECONFIG, state $AWS_FREEZE_STATE"; return 0; fi
  confirm_typed freeze "freeze all writes on the AWS platform and every store (users see the maintenance page)"
  aws_tunnel
  freeze_aws on
  date +%s > "$RUN_DIR/frozen-at"
}

step_final_dump_restore() {
  local dump=$RUN_DIR/jeffi_stores.dump
  if ! $APPLY; then
    echo "(dry run) would: pg_dump -Fc jeffi_stores from the RDS (tunnel via the AWS core, app_user IAM token) into $dump;"
    echo "  quiesce the Azure platform pods (freeze.sh on, state $AZ_FREEZE_STATE); pg_restore as app_user (PGPASSFILE 0600 from Key Vault) into Azure jeffi_stores;"
    echo "  compare table counts. The Azure pods stay at 0 until the identity step."
    return 0
  fi
  [ -s "$AWS_FREEZE_STATE" ] || die "the AWS cluster is not frozen ($AWS_FREEZE_STATE missing): run the freeze step first"
  confirm_typed restore "dump the frozen RDS jeffi_stores and restore it into Azure Postgres (overwrites the Azure copy if RESTORE_CLEAN=1)"
  say "Dump from RDS"
  lib_run aws 'tunnel; pg_major > "$RUN_DIR/pg_major"
    pg_docker pg_dump -d jeffi_stores -Fc -f /out/jeffi_stores.dump'
  chmod 600 "$dump"
  echo "   $(du -h "$dump" | cut -f1) in $dump (PG $(cat "$RUN_DIR/pg_major"))"
  say "Quiesce the Azure platform"
  if [ -s "$AZ_FREEZE_STATE" ]; then echo "   already quiesced ($AZ_FREEZE_STATE)"; else freeze_azure on; fi
  say "Restore into Azure Postgres"
  lib_run azure '
    tunnel
    n=$(psql_app jeffi_stores -Atc "select count(*) from pg_tables where schemaname = '"'public'"'")
    flags=(--no-owner --no-privileges -j 4)
    if [ "$n" != 0 ]; then
      [ -n "$RESTORE_CLEAN" ] || { echo "Azure jeffi_stores already has $n public tables: re-run with RESTORE_CLEAN=1 to restore over them" >&2; exit 1; }
      flags+=(--clean --if-exists)
    fi
    mj=$(cat "$RUN_DIR/pg_major"); lm=$(pg_restore --version 2>/dev/null | grep -oE "[0-9]+" | head -1 || true)
    # The local client when it is at least the dump version, else the matching image; the password file is mounted, never passed.
    if [ "${lm:-0}" -ge "$mj" ]; then run=(pg_restore); in=$RUN_DIR
    else run=(docker run --rm -e PGPASSFILE=/run/pgpass -e PGHOST -e PGPORT -e PGUSER -e PGSSLMODE -v "$PGPASSFILE:/run/pgpass:ro" -v "$RUN_DIR:/in:ro" "postgres:$mj-alpine" pg_restore); in=/in; fi
    tables=$("${run[@]}" -l "$in/jeffi_stores.dump" | grep -cE "; [0-9]+ [0-9]+ TABLE public " || true)
    rc=0; (pg_env; "${run[@]}" "${flags[@]}" -d jeffi_stores "$in/jeffi_stores.dump") > "$RUN_DIR/restore.log" 2>&1 || rc=$?
    echo "   pg_restore exit $rc, $(grep -c "^pg_restore: error" "$RUN_DIR/restore.log" || true) error line(s); log $RUN_DIR/restore.log"
    if [ $rc != 0 ] && [ -z "$RESTORE_ALLOW_ERRORS" ]; then echo "Read the log; if the errors are benign re-run this step with RESTORE_ALLOW_ERRORS=1" >&2; exit 1; fi
    got=$(psql_app jeffi_stores -Atc "select count(*) from pg_tables where schemaname = '"'public'"'")
    echo "   public tables: dump $tables, Azure $got"
    [ "$tables" = "$got" ] || echo "   WARNING: table counts differ (extension-owned tables can explain a few); check before going on" >&2
  '
}

step_identity() {
  local sql=$RUN_DIR/identity.sql
  # Only the platform row's rule id moves; the service account must still be the expected one. Idempotent.
  cat > "$sql" <<'SQL'
select 'before ' || federation_rule_id from public.ai_provider_identities where tenant_id::text = :'tid' and provider = 'anthropic';
update public.ai_provider_identities set federation_rule_id = :'rule', updated_at = now()
 where tenant_id::text = :'tid' and provider = 'anthropic' and service_account_id = :'sa' and federation_rule_id <> :'rule';
select 'after  ' || federation_rule_id from public.ai_provider_identities where tenant_id::text = :'tid' and provider = 'anthropic';
SQL
  export SQL_FILE=$sql
  if ! $APPLY; then
    echo "(dry run) current value in Azure, then would set federation_rule_id=$ANTH_RULE_AZURE:"
    lib_run azure 'tunnel; psql_app jeffi_stores -qAt -v tid="$ANTH_TENANT" -c "select '"'before '"' || federation_rule_id from public.ai_provider_identities where tenant_id::text = '"'$ANTH_TENANT'"' and provider = '"'anthropic'"'"' \
      || echo "   (Azure DB has no such table yet: restore first)"
    return 0
  fi
  confirm_typed identity "set the platform Anthropic federation_rule_id to $ANTH_RULE_AZURE in the Azure database"
  local out
  out=$(lib_run azure 'tunnel; psql_app jeffi_stores -qAt -v tid="$ANTH_TENANT" -v rule="$ANTH_RULE_AZURE" -v sa="$ANTH_SA" -f "$SQL_FILE"')
  echo "$out" | grep -E '^(before|after) '
  grep -qx "after  $ANTH_RULE_AZURE" <<<"$out" || die "the platform row is not on $ANTH_RULE_AZURE (no row, or a different service account than $ANTH_SA)"
  say "Bring the Azure platform up on the restored data (freeze.sh off, Azure)"
  if [ -s "$AZ_FREEZE_STATE" ]; then freeze_azure off; else echo "   not quiesced: nothing to resume"; fi
}

step_dns() {
  need_ips
  say "Plan (route53-plan.sh, nothing applied)"
  route53 "$SCRATCH"
  $APPLY || { echo "(dry run) --apply would submit it with TTL 60"; return 0; }
  confirm_typed dns "move the store wildcards to $EDGE_IP and the platform hosts to $AZURE_IP in Route 53"
  mkdir -p "$RUN_DIR/dns-apply"
  route53 "$RUN_DIR/dns-apply" --apply
  # The first apply's batch is the real rollback; a re-run would only hold the already-changed records.
  if [ -s "$RUN_DIR/route53-rollback.json" ]; then echo "   kept the earlier $RUN_DIR/route53-rollback.json"
  else cp "$(ls -t "$RUN_DIR"/dns-apply/route53-rollback-*.json | head -1)" "$RUN_DIR/route53-rollback.json"; echo "   rollback batch: $RUN_DIR/route53-rollback.json"; fi
}

step_cloudfront() {
  local mobile
  need_ips
  say "origin.jeffistores.in must answer from the Azure core (certificate and routing)"
  if curl -sS --max-time 20 -o /dev/null -w '   %{http_code} https://origin.jeffistores.in/\n' --connect-to "$ORIGIN_HOST:443:$AZURE_IP:443" "https://$ORIGIN_HOST/"; then :; else
    $APPLY && die "origin.jeffistores.in does not answer over TLS on $AZURE_IP"; echo "   (dry run: not reachable yet)"
  fi
  mobile=$(cf_id_for_alias "$MOBILE_HOST")
  echo "   website distribution $SITE_DIST; mobile distribution ${mobile:-none}"
  $APPLY && confirm_typed cloudfront "repoint the origin of $SITE_DIST${mobile:+ and $mobile} to $ORIGIN_HOST (before-configs saved in $RUN_DIR)"
  say "Website distribution"; cf_repoint "$SITE_DIST" "$ORIGIN_HOST"
  if [ -n "$mobile" ]; then say "Mobile distribution"; cf_repoint "$mobile" "$ORIGIN_HOST"; fi
}

step_smoke() {
  need_ips
  local sha=${CUTOVER_SHA:-$(image_sha)} got n=0
  if command -v dig >/dev/null; then
    say "Waiting for DNS (public resolver) to show the Azure IP"
    while [ $n -lt 30 ]; do
      got=$(dig +short @1.1.1.1 ecom.jeffistores.in A | head -1 || true)
      [ "$got" = "$AZURE_IP" ] && { echo "   ecom.jeffistores.in -> $got"; break; }
      $APPLY || { echo "   (dry run) ecom.jeffistores.in -> ${got:-none}"; break; }
      n=$((n + 1)); sleep 10
    done
    got=$(dig +short @1.1.1.1 cutover-smoke.jeffistores.in A | head -1 || true)
    [ "$got" = "$EDGE_IP" ] && echo "   store wildcard -> $got" || echo "   WARNING: store wildcard resolves to ${got:-nothing}, expected $EDGE_IP" >&2
  else echo "   dig not installed: DNS propagation not checked"; fi
  if ! $APPLY; then echo "(dry run) would run smoke.sh $sha flagship against the live hosts"; return 0; fi
  say "smoke.sh flagship, live hosts"
  JEFFI_CLOUD=azure KUBECONFIG=$AZ_KUBECONFIG bash "$BOOT/smoke.sh" "$sha" flagship
  if [ -n "${SMOKE_TENANTS:-}" ]; then say "smoke.sh tenants"; JEFFI_CLOUD=azure KUBECONFIG=$AZ_KUBECONFIG bash "$BOOT/smoke.sh" "$sha" tenants; fi
}

step_unfreeze() {
  if ! $APPLY; then echo "(dry run) would resume the Azure pods if still quiesced; the AWS cluster stays frozen unless UNFREEZE_AWS=1"; return 0; fi
  confirm_typed unfreeze "end the freeze: the platform serves from Azure"
  if [ -s "$AZ_FREEZE_STATE" ]; then freeze_azure off; else echo "   Azure pods already running"; fi
  if [ -n "${UNFREEZE_AWS:-}" ]; then
    confirm_typed unfreeze-aws "resume the AWS cluster too: its platform pods would run again against the stale RDS (split brain) while the stores come back"
    aws_tunnel; freeze_aws off
  else
    echo "   The AWS cluster stays frozen on purpose: its platform would run against the stale RDS. State: $AWS_FREEZE_STATE"
  fi
  echo "   Frozen for $(( ($(date +%s) - $(cat "$RUN_DIR/frozen-at" 2>/dev/null || date +%s)) / 60 )) minute(s)."
  echo "   Manual now: unset the GitHub variable AZURE_INGRESS_IP, set AZURE_TARGET=true, rename the Anthropic rule (README)."
}

main "$@"
