#!/bin/bash
# Phase E cutover driver (docs/plans/AZURE_MOVE_AND_AI_GATEWAY_PLAN.md): platform core from AWS to Azure, stores stay on AWS.
# Steps, in order: preflight freeze final-dump-restore identity stores-rejoin dns cloudfront smoke azure-live unfreeze.
# Dry run by default (reads only); --apply acts, with a typed confirmation before each irreversible step.
#   EDGE_IP=<AWS tenant edge EIP> AZURE_IP=52.172.147.62 bash deploy/azure/cutover/cutover.sh [--apply]
#   ... --step <name>    one step        ... --from <name>   that step and everything after it       --list
#   ... --step stores-rejoin --only <slug|pool>   one store's nodes first, as the canary
# Inputs (env): EDGE_IP, AZURE_IP (required); CUTOVER_DATE (export once at T-0); CUTOVER_SHA (image sha deployed on
#   Azure, default: this checkout's); RESTORE_CLEAN=1 (restore over a non-empty Azure DB); RESTORE_ALLOW_ERRORS=1
#   (carry on after pg_restore reports errors); SMOKE_TENANTS=1 (also smoke the stores in the Azure cluster);
#   UNFREEZE_AWS=1 (bring the AWS cluster back too, see README); AZURE_K3S_SERVER (default: K8S_SERVER_URL of the Azure overlay);
#   STORES_REDISCOVER=1 (read the AWS cluster's nodes again); BACKUPS_DIR, AWS_KUBECONFIG, AZ_KUBECONFIG.
# Artifacts and the rollback inputs: ~/Documents/db-backups/cutover-<date>/ ; timestamps: cutover-<date>.log
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/stores.sh"
STEPS=(preflight freeze final-dump-restore identity stores-rejoin dns cloudfront smoke azure-live unfreeze)
AZURE_IP=${AZURE_IP:-}; EDGE_IP=${EDGE_IP:-}
export RUN_DIR ANTH_TENANT ANTH_SA ANTH_RULE_AZURE RESTORE_CLEAN=${RESTORE_CLEAN:-} RESTORE_ALLOW_ERRORS=${RESTORE_ALLOW_ERRORS:-}
need_ips() { [ -n "$EDGE_IP" ] && [ -n "$AZURE_IP" ] || die "set EDGE_IP and AZURE_IP"; }
route53() { EDGE_IP=$EDGE_IP AZURE_IP=$AZURE_IP OUT_DIR=$1 bash "$R53" "${@:2}"; }

step_preflight() {
  local bad=0 sha out
  ko() { echo "   FAIL $*" >&2; bad=1; }
  need aws az kubectl psql python3 curl gh
  for v in EDGE_IP AZURE_IP; do
    [[ ${!v} =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] && echo "   ok $v=${!v}" || ko "$v is not set to an IPv4 address"
  done
  [ -d "$RUN_DIR" ] && [ -w "$RUN_DIR" ] && touch "$LOG" 2>/dev/null && echo "   ok backups writable ($RUN_DIR)" || ko "$RUN_DIR / $LOG not writable"
  for f in "$AWS_KUBECONFIG" "$AZ_KUBECONFIG"; do [ -s "$f" ] && echo "   ok $f" || ko "missing kubeconfig $f"; done
  if [ -s "$AWS_FREEZE_STATE" ] && ! grep -q '^freeze ' "$RUN_DIR/done.txt" 2>/dev/null; then
    ko "$AWS_FREEZE_STATE exists but this window has not frozen: a stale freeze? (freeze.sh off, or remove it)"
  fi
  if gh variable list --json name >/dev/null; then
    out=$(for v in "${GH_VARS[@]}"; do printf '%s=%s ' "$v" "$(gh_var "$v")"; done)
    echo "   ok GitHub variables readable: $out"
    if grep -q 'FLAGSHIP_CLOUD=azure' <<<"$out"; then ko "FLAGSHIP_CLOUD is already azure: an azure-live step from an earlier window? (rollback.sh --step release-lanes)"; fi
  else ko "gh cannot read the repository variables (gh auth login; the azure-live step sets them)"; fi
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
    else run=(docker run --rm -e PGPASSFILE=/run/pgpass -e PGHOST=host.docker.internal -e PGPORT -e PGUSER -e PGSSLMODE -v "$PGPASSFILE:/run/pgpass:ro" -v "$RUN_DIR:/in:ro" "postgres:$mj-alpine" pg_restore); in=/in; fi
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

# Existing stores join the Azure core's cluster in place (plan 6a); their Postgres stays on the node's EBS disk.
step_stores_rejoin() {
  need_ips; need aws kubectl python3 curl npx
  local server=${AZURE_K3S_SERVER:-$(grep -E '^ +K8S_SERVER_URL:' "$AZ_PROVISIONING" | awk '{print $2}')} slug out bad_stores=()
  [ -n "$server" ] || die "no Azure K8S_SERVER_URL (AZURE_K3S_SERVER, or $AZ_PROVISIONING)"
  say "Store nodes, as the AWS cluster has them"
  discover_nodes
  if $APPLY; then [ -s "$AWS_FREEZE_STATE" ] || die "the AWS cluster is not frozen ($AWS_FREEZE_STATE missing): freeze first"; fi
  KUBECONFIG=$AZ_KUBECONFIG kubectl get nodes >/dev/null || die "the Azure cluster does not answer"
  say "Re-join the nodes to $server (one typed confirmation per batch)"
  rejoin_all azure "$server" true
  say "Re-apply every store into the Azure cluster (the controller's reconcile-k8s, pods pinned to the same node and disk)"
  slugs_to_apply | tr '\n' ' '; echo
  if ! $APPLY; then echo "(dry run) would POST reconcile-k8s?slug=<slug> for each store, then check its Postgres pod and storefront through $EDGE_IP"; return 0; fi
  confirm_typed reapply "apply the Kubernetes objects of $(slugs_to_apply | wc -l | tr -d ' ') store(s) into the Azure cluster: their pods start"
  for slug in $(slugs_to_apply); do
    export SLUG=$slug
    out=$(KUBECONFIG=$AZ_KUBECONFIG lib_run azure 'in_cluster reconcile_k8s "/api/internal/provisioning/reconcile-k8s?slug=$SLUG"' 2>&1) || true
    # The route answers 200 even when a store failed, so read its body, then verify the store itself.
    if grep -q '"ok": *false' <<<"$out"; then echo "   $slug: reconcile reported a failure:" >&2; tail -5 <<<"$out" >&2; bad_stores+=("$slug"); continue; fi
    verify_store "$slug" || bad_stores+=("$slug")
  done
  [ ${#bad_stores[@]} = 0 ] || die "not healthy on Azure: ${bad_stores[*]} (re-run this step; --only <slug> for one)"
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

# Azure goes live and the release lanes follow it. Until now the Azure platform was on standby (overlays/azure-standby):
# the app CronJobs suspended, messaging, documents and voice at 0. This applies those objects from overlays/azure at
# the cutover tag, checks messaging and documents, then sets FLAGSHIP_CLOUD=azure and AZURE_TARGET=true and deletes
# AZURE_INGRESS_IP: from the next release the Azure lane carries the stores, and every AWS job is skipped. Late on
# purpose: AWS stays frozen, so nothing runs twice, and a rollback before this step has no Azure-sent messages to undo.
step_azure_live() {
  need gh kubectl python3
  local sha=${CUTOVER_SHA:-$(image_sha)} objs=$SCRATCH/azure-live.json v
  say "GitHub release lanes now"
  for v in "${GH_VARS[@]}"; do echo "   $v=$(gh_var "$v")"; done
  say "From overlays/azure at local-$sha: the app CronJobs (resumed) and messaging, documents and voice (their release replicas)"
  export AZURE_LIVE_TAG=local-$sha
  KUBECONFIG=$AZ_KUBECONFIG FLAGSHIP_CLOUD=azure lib_run azure 'k8s_tunnel; platform_manifests "$AZURE_LIVE_TAG" | kubectl create --dry-run=client -f - -o json' |
    python3 -I -c '
import json, re, sys
t, i, dec, items = sys.stdin.read(), 0, json.JSONDecoder(), []
while i < len(t):
    if t[i].isspace(): i += 1; continue
    d, i = dec.raw_decode(t, i); items += d["items"] if isinstance(d.get("items"), list) else [d]
keep = [o for o in items if (o["kind"] == "CronJob" and (o["metadata"].get("labels") or {}).get("app.kubernetes.io/part-of") == "jeffi-cron")
        or (o["kind"] == "Deployment" and re.fullmatch(r"jeffi-stores-(messaging|document|voice)-service", o["metadata"]["name"]))]
cron = [o for o in keep if o["kind"] == "CronJob"]
if not cron or any(o["spec"].get("suspend") for o in cron): sys.exit("the live overlay rendered no app CronJobs, or suspended ones")
print("   %d app CronJobs, not suspended" % len(cron), file=sys.stderr)
for o in keep:
    if o["kind"] == "Deployment": print("   deployment/%s replicas %s" % (o["metadata"]["name"], o["spec"].get("replicas", 1)), file=sys.stderr)
json.dump({"apiVersion": "v1", "kind": "List", "items": keep}, open(sys.argv[1], "w"))' "$objs"
  if ! $APPLY; then echo "(dry run) would apply them, then set FLAGSHIP_CLOUD=azure, AZURE_TARGET=true and delete AZURE_INGRESS_IP"; return 0; fi
  [ -s "$AWS_FREEZE_STATE" ] || die "the AWS cluster is not frozen ($AWS_FREEZE_STATE missing): its CronJobs and workers would run beside these"
  [ ! -s "$AZ_FREEZE_STATE" ] || die "the Azure platform is still quiesced ($AZ_FREEZE_STATE): run the identity step first"
  gh variable list --json name >/dev/null || die "gh cannot read the repository variables (gh auth login), so they could not be saved for the rollback"
  confirm_typed azure-live "resume the app CronJobs and the messaging, documents and voice workers on Azure, and make the Azure lane the release (GitHub variables)"
  if [ -s "$GH_VARS_BEFORE" ]; then echo "   kept the earlier $GH_VARS_BEFORE"
  else for v in "${GH_VARS[@]}"; do printf '%s=%s\n' "$v" "$(gh_var "$v")"; done > "$GH_VARS_BEFORE"; echo "   saved $GH_VARS_BEFORE (rollback.sh restores it)"; fi
  KUBECONFIG=$AZ_KUBECONFIG kubectl apply -f "$objs"
  for v in messaging-service document-service; do KUBECONFIG=$AZ_KUBECONFIG kubectl -n jeffi rollout status "deploy/jeffi-stores-$v" --timeout=600s; done
  for v in messaging documents; do JEFFI_CLOUD=azure KUBECONFIG=$AZ_KUBECONFIG bash "$BOOT/smoke.sh" "$sha" "$v" flagship; done
  say "GitHub variables"
  gh_var_set FLAGSHIP_CLOUD azure
  gh_var_set AZURE_TARGET true
  gh_var_set AZURE_INGRESS_IP ''
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
  grep -q '^azure-live ' "$RUN_DIR/done.txt" 2>/dev/null ||
    echo "   WARNING: azure-live has not run in this window: Azure's app CronJobs and workers are on standby, and releases still take the AWS lane" >&2
  echo "   Manual now: rename the Anthropic rule (README)."
}

main "$@"
