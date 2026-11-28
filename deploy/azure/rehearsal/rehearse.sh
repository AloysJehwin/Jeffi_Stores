#!/bin/bash
# Phase D: bring the whole platform up on the Azure core, prove it, and time it, on a restored COPY of production.
# REHEARSAL SAFE MODE is always on (see README): the copy must not reach real customers, owners, payment providers
# or marketplaces. It has three parts, each checked before the run goes on:
#   database   safe-mode.sql on the Azure copy (flags off, campaigns and outreach paused, credentials blanked)
#   manifests  a kubectl shim, first on PATH for the platform scripts only, renders the overlay through safe-mode.jq:
#              kill-switch env on every container, every CronJob suspended, messaging/document/voice at 0 replicas
#   credentials the pods read secrets from Key Vault, so the rehearsal gets its own vault (--vault, default
#              jeffi-reh-kv) holding the allowlisted keys only (secret-keys-keep.txt, -deny.txt, secret-sources.txt),
#              every container points at it, and google-sa is deleted: no live provider credential reaches a pod
#   verify     the run fails if a running pod lacks a switch or the vault pointer, a CronJob is not suspended, or a
#              denied key exists in the rehearsal vault or any platform or store Secret
# Hostnames: the PRODUCTION ones. Nothing is tested through DNS; smoke.sh and curl connect straight to the Azure
# ingress IP (SMOKE_CONNECT_TO / --connect-to). --rewrite-hosts (opt-in) renders <app>.<domain> instead; see README.
#   1  (--restore) restore-dump.sh --apply (restore + scrub), then release-db.sh --cloud=azure
#   2  scrub + check the database, secrets.sh, apply-platform.sh and rollout.sh platform with JEFFI_CLOUD=azure,
#      the wildcard certificate (DNS-01: a temporary _acme-challenge TXT record), then the pod/CronJob verification
#   3  smoke.sh per service against the Azure IP
#   4  a throwaway store: tenant rows like createTenant()'s, advanced by the controller's advance route (the
#      CronJobs stay suspended), smoke, then the admin deprovision route (needs --admin-cookie-file)
# Dry run unless --apply: the checks and the render preview are read-only. Anything billable or touching DNS asks
# first (--yes skips, except --no-safe-mode). Output also goes to ~/Documents/db-backups/rehearsal-<date>.log.
# Usage: bash deploy/azure/rehearsal/rehearse.sh [--apply] [--yes] [--tag local-xxxxxxxx] [--azure-ip IP]
#          [--ingress-ip IP] [--restore] [--skip-platform] [--skip-store] [--admin-cookie-file FILE] [--plan basic]
#          [--slug NAME] [--keep-store] [--store-timeout-min 45]
#          [--rewrite-hosts [--domain az-rehearsal.jeffistores.in] [--with-dns]] [--no-safe-mode]
export JEFFI_CLOUD=azure
# A rehearsal is before the cutover by definition: the platform renders on standby (overlays/azure-standby), under safe mode.
[ "${FLAGSHIP_CLOUD:-aws}" = aws ] || { echo "FLAGSHIP_CLOUD=${FLAGSHIP_CLOUD}: Azure is the live flagship, a rehearsal would park it" >&2; exit 2; }
export FLAGSHIP_CLOUD=aws
source "$(dirname "$0")/common.sh"
DOMAIN=az-rehearsal.jeffistores.in; TAG=; AZURE_IP=${AZURE_INGRESS_IP:-}; INGRESS_IP=; RESTORE=false; WITH_DNS=false
SKIP_PLATFORM=false; SKIP_STORE=false; COOKIE=; PLAN=basic; SLUG=; KEEP_STORE=false; STORE_TIMEOUT=45
REWRITE=false; SAFE=true
args=("$@"); i=0
while [ $i -lt ${#args[@]} ]; do
  case ${args[$i]} in
    --domain) DOMAIN=${args[$((i+1))]:?}; i=$((i+1)) ;;
    --tag) TAG=${args[$((i+1))]:?}; i=$((i+1)) ;;
    --azure-ip) AZURE_IP=${args[$((i+1))]:?}; i=$((i+1)) ;;
    --ingress-ip) INGRESS_IP=${args[$((i+1))]:?}; i=$((i+1)) ;;
    --admin-cookie-file) COOKIE=${args[$((i+1))]:?}; i=$((i+1)) ;;
    --plan) PLAN=${args[$((i+1))]:?}; i=$((i+1)) ;;
    --slug) SLUG=${args[$((i+1))]:?}; i=$((i+1)) ;;
    --store-timeout-min) STORE_TIMEOUT=${args[$((i+1))]:?}; i=$((i+1)) ;;
    --restore) RESTORE=true ;; --with-dns) WITH_DNS=true ;; --skip-platform) SKIP_PLATFORM=true ;;
    --skip-store) SKIP_STORE=true ;; --keep-store) KEEP_STORE=true ;; --rewrite-hosts) REWRITE=true ;;
    --no-safe-mode) SAFE=false ;;
    --vault) REH_VAULT=${args[$((i+1))]:?}; i=$((i+1)) ;;
  esac
  i=$((i+1))
done
$REWRITE || ! $WITH_DNS || { echo "--with-dns only goes with --rewrite-hosts (production hostnames are never pointed at Azure here)" >&2; exit 2; }
if $REWRITE; then
  [[ $DOMAIN =~ ^([a-z0-9-]+\.)+[a-z]+$ ]] || { echo "bad --domain: $DOMAIN" >&2; exit 2; }
  case ${DOMAIN%%.*} in
    www|ecom|admin|business|public|mobile|voice|k8s|forms|vault|certificate|oidc|origin|invoice|quotation|purchaseorder|jeffistores)
      echo "--domain $DOMAIN is a production host" >&2; exit 2 ;;
  esac
  [ "$DOMAIN" != jeffistores.in ] || { echo "--domain is the production apex" >&2; exit 2; }
  HOSTBASE=$DOMAIN
else HOSTBASE=jeffistores.in; fi
[[ $STORE_TIMEOUT =~ ^[0-9]+$ ]] || { echo "bad --store-timeout-min" >&2; exit 2; }
need kubectl az aws psql curl python3 sed jq
cd "$REPO"
SHA=$(image_sha); [ -n "$TAG" ] || TAG=local-$SHA; SHA=${TAG#local-}
LOG=$BK_ROOT/rehearsal-$(date +%Y-%m-%d).log
SHIM_DIR=$(mktemp -d); chmod 700 "$SHIM_DIR"; on_exit "rm -rf '$SHIM_DIR'"
source "$REH_DIR/safe-secrets.sh"
# The kill-switch env plus the rehearsal vault: every container is pointed at it instead of jeffi-prod-kv.
SAFE_ENV=$SHIM_DIR/safe-env.json
jq --arg v "$REH_VAULT" '. + [{name: "AZURE_KEY_VAULT_NAME", value: $v}, {name: "AZURE_KEY_VAULT_URL", value: ("https://" + $v + ".vault.azure.net")}]' \
  "$REH_DIR/safe-env.json" > "$SAFE_ENV"
FAILED=()
run() { timed "$@" || FAILED+=("$1"); }
must() { timed "$@" || { FAILED+=("$1"); print_times; echo "Stopped: $1 failed." >&2; exit 1; }; }

if ! $SAFE; then
  echo "SAFE MODE OFF: the restored production copy could message customers, call payment providers and push to marketplaces." >&2
  read -r -p "Type exactly 'contact real customers' to continue (--yes does not apply): " a
  [ "$a" = 'contact real customers' ] || { echo "Stopped."; exit 1; }
fi

# ---- the render shim, first on PATH for the platform scripts only
REAL_KUBECTL=$(command -v kubectl)
cat > "$SHIM_DIR/kubectl" <<EOF
#!/bin/bash
set -o pipefail
REAL='$REAL_KUBECTL'
rw() {
  local extra=()
  [ -z "\${REH_INGRESS_IP:-}" ] || extra=(-e "s#REPLACE_ME_edge_elastic_ip#\$REH_INGRESS_IP#g")
  if [ "\${REH_REWRITE:-}" = 1 ]; then
    sed -E -e 's#(wif-voice|oidc|origin)\.jeffistores\.in#\1.KEEPJEFFI#g' -e 's#@jeffistores\.in#@KEEPJEFFI#g' \\
      -e "s#jeffistores\.in#\$REH_DOMAIN#g" -e 's#KEEPJEFFI#jeffistores.in#g' \${extra[@]+"\${extra[@]}"}
  else sed -E -e 's#^\$##' \${extra[@]+"\${extra[@]}"}; fi
}
safe() { if [ "\${REH_SAFE:-}" = 1 ]; then "\$REAL" create --dry-run=client -f - -o json | jq --argjson safe "\$(cat '$SAFE_ENV')" -f '$REH_DIR/safe-mode.jq'; else cat; fi; }
case "\${1:-}" in
  kustomize) "\$REAL" "\$@" | rw | safe ;;
  apply) if [ \$# -eq 3 ] && [ "\$2" = -f ] && [ -f "\$3" ]; then rw < "\$3" | "\$REAL" apply -f -; else exec "\$REAL" "\$@"; fi ;;
  *) exec "\$REAL" "\$@" ;;
esac
EOF
chmod 700 "$SHIM_DIR/kubectl"
export REH_DOMAIN=$DOMAIN REH_INGRESS_IP=$INGRESS_IP REH_REWRITE=$($REWRITE && echo 1 || echo 0) REH_SAFE=$($SAFE && echo 1 || echo 0)
# smoke.sh: as is for production hostnames; with --rewrite-hosts a copy with its hosts rewritten.
SMOKE=$REPO/deploy/k8s/bootstrap/smoke.sh
if $REWRITE; then
  sed -E -e "s#jeffistores\.in#$DOMAIN#g" -e "s#^source .*#source '$REPO/deploy/k8s/db/lib.sh'#" "$SMOKE" > "$SHIM_DIR/smoke.sh"
  SMOKE=$SHIM_DIR/smoke.sh
fi
# Services whose pods exist in safe mode (messaging, documents and voice are parked at 0 replicas).
SMOKE_SERVICES="controller storefront admin business public-api mobile showcase ai-gateway"

hosts_of() { grep -oE '[A-Za-z0-9*._-]*jeffistores\.in' | sort -u; }

# ---- checks that fail the run (also run in the dry run where the cluster has the objects)
verify_pods() { # every running pod in jeffi / jeffi-edge carries every switch
  local out
  out=$(kubectl get pods -A -o json | jq -r --argjson want "$(cat "$SAFE_ENV")" '
    .items[] | select(.metadata.namespace as $n | ["jeffi", "jeffi-edge"] | index($n))
    | select(.metadata.deletionTimestamp == null and .status.phase != "Succeeded" and .status.phase != "Failed")
    | select(.metadata.labels.app != "flagship-postgres") # the database: no outbound calls (safe-mode.jq leaves it as is)
    | .metadata.name as $p | .spec.containers[] | . as $c | $want[]
    | select(. as $w | ([$c.env[]? | select(.name == $w.name and .value == $w.value)] | length) == 0)
    | "\($p)/\($c.name) lacks \(.name)=\(.value)"')
  [ -z "$out" ] || { echo "$out" | head -20 >&2; echo "safe mode: a running pod is missing a switch" >&2; return 1; }
  echo "all $(kubectl get pods -A -o json | jq '[.items[] | select(.metadata.namespace as $n | ["jeffi","jeffi-edge"] | index($n)) | select(.status.phase=="Running" and .metadata.labels.app != "flagship-postgres")] | length') running app pods carry the switches (flagship-postgres exempt)"
}
verify_cronjobs() {
  local out
  out=$(kubectl get cronjob -A -o json | jq -r '.items[] | select(.spec.suspend != true) | "\(.metadata.namespace)/\(.metadata.name)"')
  [ -z "$out" ] || { echo "$out" >&2; echo "safe mode: CronJobs not suspended" >&2; return 1; }
  echo "all $(kubectl get cronjob -A --no-headers | wc -l | tr -d ' ') CronJobs suspended"
}
verify_db() {
  local n; n=$(db_violations jeffi_stores)
  [ "$n" = 0 ] || { echo "safe mode: $n violation(s) in the Azure copy (bash deploy/azure/rehearsal/restore-dump.sh --apply --scrub-only)" >&2; return 1; }
  echo "database copy: 0 violations"
}

# ---- preflight (read-only)
say "Preflight"
echo "hostnames: $($REWRITE && echo "REWRITTEN to <app>.$DOMAIN (--rewrite-hosts)" || echo "production, tested through the Azure IP only"); image tag $TAG; safe mode $($SAFE && echo ON || echo OFF)"
[ -f "$KUBECONFIG" ] || { echo "no kubeconfig at $KUBECONFIG (README step 5)" >&2; exit 1; }
az account show --query name -o tsv >/dev/null || { echo "az is not logged in" >&2; exit 1; }
aws sts get-caller-identity --query Account --output text >/dev/null || { echo "aws is not logged in" >&2; exit 1; }
k8s_tunnel
kubectl get nodes --no-headers | sed 's/^/   node /'
[ -n "$AZURE_IP" ] || AZURE_IP=$(az network public-ip list -g "$AZ_RG" --query '[0].ipAddress' -o tsv)
[ -n "$AZURE_IP" ] || { echo "no Azure ingress IP (use --azure-ip)" >&2; exit 1; }
echo "Azure ingress IP $AZURE_IP"
if ! out=$(PATH=$SHIM_DIR:$PATH platform_manifests "$TAG" 2>&1); then
  echo "$out" | tail -3 >&2
  echo "The overlay does not render. Fill REPLACE_ME values (README step 8), or pass --ingress-ip to point store hosts somewhere for this rehearsal." >&2
  exit 1
fi
say "Render preview (what the platform scripts will apply)"
rendered=$(PATH=$SHIM_DIR:$PATH kubectl kustomize "$REPO/deploy/k8s/overlays/azure-standby")
if $SAFE; then
  echo "CronJobs rendered suspended: $(jq -s '[.[] | (.items // [.])[] | select(.kind=="CronJob" and .spec.suspend==true)] | length' <<<"$rendered")"
  echo "parked at 0 replicas: $(jq -r -s '[.[] | (.items // [.])[] | select(.kind=="Deployment" and .spec.replicas==0) | .metadata.name] | join(", ")' <<<"$rendered")"
  echo "switches on every container: $(jq -r '[.[].name] | join(" ")' "$SAFE_ENV")"
fi
echo "hostnames in the manifests:"; hosts_of <<<"$rendered" | sed 's/^/   /'
[ -z "$COOKIE" ] || [ -s "$COOKIE" ] || { echo "no such cookie file: $COOKIE" >&2; exit 1; }
if ! $SKIP_STORE && [ -z "$COOKIE" ]; then
  echo "The store round trip needs --admin-cookie-file (an administrator's 'Cookie: ...' header line) so the test store can be deleted; or pass --skip-store." >&2
  $APPLY && exit 1
fi

say "Plan"
$RESTORE && echo "  1  restore the prod dump into Azure Postgres (restore-dump.sh, scrubbed), then release-db.sh --cloud=azure"
$SAFE && echo "  -  rehearsal Key Vault $REH_VAULT: created if missing, filled with the allowlisted keys of $(grep -vcE '^[[:space:]]*(#|$)' "$SOURCES_FILE") secrets (secret-sources.txt)"
echo "  2  database scrub + check$($SKIP_PLATFORM || echo ", secrets.sh, apply-platform.sh $TAG, rollout.sh $TAG platform, wildcard certificate, pod and CronJob verification")"
echo "  3  smoke.sh $SHA per service ($SMOKE_SERVICES) via $AZURE_IP"
$WITH_DNS && echo "  -  Route 53: A $DOMAIN and *.$DOMAIN -> $AZURE_IP (rollback batch saved)"
$SKIP_STORE || echo "  4  throwaway store ${SLUG:-rehearsal-<mmddhhmm>} on plan $PLAN: provision, smoke, deprovision$($KEEP_STORE && echo ' (kept: --keep-store)')"
if ! $APPLY; then echo; echo "Dry run: nothing changed (--apply)."; exit 0; fi

mkdir -p "$BK_ROOT"
exec > >(tee -a "$LOG") 2>&1
echo "=== rehearsal $(date '+%Y-%m-%d %H:%M:%S') tag $TAG hostnames $HOSTBASE azure-ip $AZURE_IP safe-mode $($SAFE && echo on || echo OFF) (log $LOG)"
T0=$SECONDS

# ---- 1 restore
if $RESTORE; then
  say "1. Database restore"
  must restore-dump bash "$REPO/deploy/azure/rehearsal/restore-dump.sh" --apply $($YES && echo --yes) --target-db jeffi_stores
  must release-db bash "$REPO/deploy/k8s/db/release-db.sh" --cloud=azure $($YES && echo --yes)
fi

# ---- 2 safe mode on the database, then the platform
tunnel
if $SAFE; then
  say "2. Safe mode: database"
  must safe-mode-db db_scrub jeffi_stores # again: release-db's migrations may have added rows
  must safe-mode-db-check verify_db
fi
if $SAFE; then
  say "2. Safe mode: credentials (rehearsal vault $REH_VAULT)"
  confirm "Create Key Vault $REH_VAULT in $AZ_RG (standard tier, RBAC; about no cost) with role assignments for you and the cluster identities, and copy the allowlisted keys of the production secrets into it? Values are never printed."
  must reh-vault-create reh_vault_create
  must reh-vault-copy reh_vault_fill
fi
ecr_kick() { # the first pull secret: the 6-hourly ecr-refresh has not run yet on a fresh cluster
  local end=$((SECONDS + 600)) job
  while [ $SECONDS -lt $end ]; do
    if kubectl -n jeffi get cronjob ecr-refresh >/dev/null 2>&1; then
      job=ecr-refresh-reh-$(date +%s)
      kubectl -n jeffi create job --from=cronjob/ecr-refresh "$job" >/dev/null 2>&1 &&
        kubectl -n jeffi wait --for=condition=complete "job/$job" --timeout=300s >/dev/null 2>&1
      return 0
    fi
    sleep 5
  done
}
if ! $SKIP_PLATFORM; then
  say "2. Platform"
  confirm "Apply the platform to the Azure core ($KUBECONFIG)? It requests a Let's Encrypt wildcard certificate for the platform names (a temporary _acme-challenge TXT record in the Route 53 jeffistores.in zone; no A or CNAME record changes)."
  [ -f certs/ca-cert.pem ] || { echo "certs/ca-cert.pem is missing (secrets.sh needs the platform CA, README step 9)" >&2; exit 1; }
  must secrets bash deploy/k8s/bootstrap/secrets.sh
  # secrets.sh seeds the Google service account JSON (a live Google credential) when the file is in the repo root: no pod has started yet.
  $SAFE && must drop-google-sa kubectl -n jeffi delete secret google-sa --ignore-not-found
  ecr_kick & ECR_PID=$!
  must apply-platform env PATH="$SHIM_DIR:$PATH" bash deploy/k8s/bootstrap/apply-platform.sh "$TAG"
  wait $ECR_PID 2>/dev/null || true
  must rollout-platform env PATH="$SHIM_DIR:$PATH" bash deploy/k8s/bootstrap/rollout.sh "$TAG" platform
  run wildcard-certificate kubectl -n jeffi-edge wait --for=condition=Ready certificate/wildcard-jeffistores --timeout=600s
fi
if $SAFE; then
  say "2. Safe mode: verification"
  must verify-cronjobs verify_cronjobs
  must verify-pods verify_pods
  must verify-secrets verify_secrets
fi

# ---- optional DNS (rewrite mode only: new names under the rehearsal domain)
dns_records() {
  local zone b="$BK_ROOT/route53-rehearsal-rollback-$RSTAMP.json" up="$SHIM_DIR/up.json" n
  [[ $DOMAIN == *.jeffistores.in ]] || { echo "--with-dns only supports a name under jeffistores.in" >&2; return 1; }
  zone=$(aws route53 list-hosted-zones-by-name --dns-name jeffistores.in --max-items 1 --query 'HostedZones[0].Id' --output text)
  zone=${zone##*/}
  for n in "$DOMAIN" "*.$DOMAIN"; do
    aws route53 list-resource-record-sets --hosted-zone-id "$zone" --query "ResourceRecordSets[?Name=='${n//\*/\\052}.'].[Type,Name]" --output text | grep . &&
      { echo "$n already has records; not overwriting" >&2; return 1; }
  done
  rec() { printf '{"Action":"%s","ResourceRecordSet":{"Name":"%s","Type":"A","TTL":60,"ResourceRecords":[{"Value":"%s"}]}}' "$1" "$2" "$AZURE_IP"; }
  printf '{"Changes":[%s,%s]}\n' "$(rec UPSERT "$DOMAIN")" "$(rec UPSERT "*.$DOMAIN")" > "$up"
  printf '{"Changes":[%s,%s]}\n' "$(rec DELETE "$DOMAIN")" "$(rec DELETE "*.$DOMAIN")" > "$b"
  aws route53 change-resource-record-sets --hosted-zone-id "$zone" --change-batch "file://$up" --query ChangeInfo.Status --output text
  echo "Rollback: aws route53 change-resource-record-sets --hosted-zone-id $zone --change-batch file://$b"
}
if $WITH_DNS; then
  say "DNS"
  confirm "Create A records $DOMAIN and *.$DOMAIN -> $AZURE_IP in the jeffistores.in zone (new names only)?"
  run dns dns_records
fi

# ---- 3 smoke, one service at a time (the parked services have no pods)
smoke_all() {
  local s bad=0
  for s in $SMOKE_SERVICES; do
    SMOKE_CONNECT_TO="::$AZURE_IP:" bash "$SMOKE" "$SHA" "$s" flagship || bad=1
  done
  return $bad
}
say "3. Smoke (connecting to $AZURE_IP; DNS is not used)"
run smoke smoke_all

# ---- 4 store round trip
ADMIN_CURL() { curl -sS --connect-to "::$AZURE_IP:" -H @"$COOKIE" "$@"; }
store_create() {
  tid=$(psql_app jeffi_stores -q -At -v slug="$SLUG" -v name="Rehearsal $SLUG" -v plan="$PLAN" <<'SQL'
WITH t AS (
  INSERT INTO tenants (slug, display_name, plan_id, status, billing_interval, daily_payout, own_delhivery, own_razorpay, service_types)
  SELECT :'slug', :'name', p.id, 'provisioning', 'monthly', false, false, false, ARRAY['store']
    FROM plans p WHERE p.slug = :'plan' AND p.is_active RETURNING id),
i AS (INSERT INTO tenant_infra (tenant_id, s3_bucket) SELECT id, 'jeffi-tenant-' || :'slug' FROM t),
w AS (INSERT INTO tenant_wallets (tenant_id, balance) SELECT id, 100 FROM t),
l AS (INSERT INTO wallet_ledger (tenant_id, entry_type, category, amount, external_ref, note)
      SELECT id, 'recharge', 'recharge', 100, 'signup_credit:' || id, 'Welcome wallet credit' FROM t),
j AS (INSERT INTO provisioning_jobs (tenant_id, created_resources, step_started_at) SELECT id, '{}'::jsonb, now() FROM t)
SELECT id FROM t;
SQL
  )
  [[ $tid =~ ^[0-9a-f-]{36}$ ]] || { echo "no tenant created: is plan '$PLAN' active? $(psql_app jeffi_stores -At -c "select string_agg(slug, ', ') from plans where is_active")" >&2; return 1; }
  STORE_LEFT=1; echo "tenant $tid ($SLUG)"
}
store_build() { # the CronJobs (and so the provisioning worker) stay suspended: this loop advances only this tenant's job
  local end=$((SECONDS + STORE_TIMEOUT * 60)) last= row st
  while [ $SECONDS -lt $end ]; do
    in_cluster provisioning_advance /api/internal/provisioning/advance "{\"tenantId\":\"$tid\"}" >/dev/null 2>&1 || true
    row=$(psql_app jeffi_stores -At -F '|' -c "select status, step, coalesce(left(last_error, 300), '') from provisioning_jobs where tenant_id='$tid' order by created_at desc limit 1")
    st=${row%%|*}
    [ "${row%|*}" = "$last" ] || { last=${row%|*}; printf '   %4ss  %s\n' "$((SECONDS - BUILD_T0))" "$last"; }
    case $st in
      done) return 0 ;;
      failed) echo "provisioning failed: ${row##*|}" >&2; return 1 ;;
    esac
    sleep 15
  done
  echo "not done after $STORE_TIMEOUT min ($last)" >&2; return 1
}
store_delete() {
  local code
  code=$(ADMIN_CURL -o "$SHIM_DIR/dep.json" -w '%{http_code}' --max-time 900 -H 'Content-Type: application/json' -X POST \
    -d '{"confirm":true,"keep":{"database":false,"media":false,"config":false}}' \
    "https://ecom.$HOSTBASE/api/admin/ecom/customers/$tid/deprovision" || true)
  echo "deprovision: HTTP $code $(head -c 300 "$SHIM_DIR/dep.json" 2>/dev/null)"
  [ "$code" = 200 ] || return 1
  echo "tenant status now: $(psql_app jeffi_stores -At -c "select status from tenants where id='$tid'")"
  if kubectl get ns "tenant-$SLUG" >/dev/null 2>&1; then echo "namespace tenant-$SLUG still exists" >&2; return 1; fi
  echo "namespace tenant-$SLUG is gone"
}
if ! $SKIP_STORE; then
  say "4. Store round trip"
  [ -n "$SLUG" ] || SLUG=rehearsal-$(date +%m%d%H%M)
  [[ $SLUG =~ ^[a-z0-9][a-z0-9-]{2,40}$ ]] || { echo "bad --slug" >&2; exit 2; }
  code=$(ADMIN_CURL -o /dev/null -w '%{http_code}' "https://ecom.$HOSTBASE/api/admin/ecom/customers/overview" || true)
  case $code in 2??) echo "admin session accepted" ;; *) echo "The admin cookie is not accepted on https://ecom.$HOSTBASE via $AZURE_IP (HTTP $code); no store created." >&2; FAILED+=(admin-auth); SKIP_STORE=true ;; esac
fi
if ! $SKIP_STORE; then
  confirm "Create store $SLUG? This launches an AWS EC2 node and EBS volume and Route 53 records for $SLUG.jeffistores.in (billable, removed by the deprovision step)."
  STORE_LEFT=0; on_exit '[ "${STORE_LEFT:-0}" = 1 ] && echo "Test store $SLUG (tenant ${tid:-?}) may still exist: deprovision it before leaving it." >&2'
  must store-create store_create
  BUILD_T0=$SECONDS
  run store-provision store_build
  run store-smoke env SMOKE_CONNECT_TO="::$AZURE_IP:" bash "$SMOKE" "$SHA" storefront tenants
  if $KEEP_STORE; then echo "Kept: tenant $tid ($SLUG)"
  else must store-delete store_delete; STORE_LEFT=0
    echo "Check for leftovers: aws ec2 describe-instances --filters 'Name=tag:Name,Values=*$SLUG*' --query 'Reservations[].Instances[].[InstanceId,State.Name]' --output text"
  fi
fi

$SAFE && run verify-secrets-final verify_secrets # the store's own namespace copies, if it was kept
say "Result"
print_times
echo "Total $((SECONDS - T0))s"
if [ ${#FAILED[@]} -gt 0 ]; then echo "FAILED: ${FAILED[*]}"; echo "Report: $LOG"; exit 1; fi
echo "All steps passed. Report: $LOG"
