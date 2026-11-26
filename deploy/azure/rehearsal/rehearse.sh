#!/bin/bash
# Phase D: bring the whole platform up on the Azure core under a test hostname, prove it, and time it.
#   1  (--restore) restore-dump.sh --apply, then release-db.sh --cloud=azure on the restored database
#   2  secrets.sh, apply-platform.sh and rollout.sh platform with JEFFI_CLOUD=azure. A kubectl shim (first on PATH,
#      this script only) rewrites every *jeffistores.in host in what `kubectl kustomize` and `kubectl apply -f
#      <file>` see, so the routes, the wildcard certificate and the PUBLIC_*_URL settings use <domain> and
#      <app>.<domain>. Production hostnames in DNS are never touched; oidc., wif-voice., origin. and
#      @jeffistores.in addresses are left alone.
#   3  smoke.sh against the rehearsal hosts: a copy of it with the hosts rewritten, connecting straight to the
#      Azure IP (no DNS needed)
#   4  (--with-dns) A records for <domain> and *.<domain>, with a saved rollback batch
#   5  a throwaway store: tenant rows like createTenant()'s, the provisioning worker builds it, smoke, then the
#      admin deprovision route tears it down (needs --admin-cookie-file)
# Dry run unless --apply: the checks and the host rewrite preview are read-only. Every step that creates billable
# resources or touches DNS asks first (--yes skips). Output also goes to ~/Documents/db-backups/rehearsal-<date>.log.
# Usage: bash deploy/azure/rehearsal/rehearse.sh [--apply] [--yes] [--domain az-rehearsal.jeffistores.in]
#          [--tag local-xxxxxxxx] [--azure-ip IP] [--ingress-ip IP] [--restore] [--with-dns] [--skip-platform]
#          [--skip-store] [--admin-cookie-file FILE] [--plan basic] [--slug NAME] [--keep-store]
#          [--store-timeout-min 45]
# Needs: README.md in this folder (Postgres created and restored, kubeconfig at ~/.kube/jeffi-azure.yaml, az and aws
# logins, Tailscale up, overlay values filled, certs/ for secrets.sh).
export JEFFI_CLOUD=azure
source "$(dirname "$0")/common.sh"
DOMAIN=az-rehearsal.jeffistores.in; TAG=; AZURE_IP=${AZURE_INGRESS_IP:-}; INGRESS_IP=; RESTORE=false; WITH_DNS=false
SKIP_PLATFORM=false; SKIP_STORE=false; COOKIE=; PLAN=basic; SLUG=; KEEP_STORE=false; STORE_TIMEOUT=45
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
    --skip-store) SKIP_STORE=true ;; --keep-store) KEEP_STORE=true ;;
  esac
  i=$((i+1))
done
[[ $DOMAIN =~ ^([a-z0-9-]+\.)+[a-z]+$ ]] || { echo "bad --domain: $DOMAIN" >&2; exit 2; }
case ${DOMAIN%%.*} in
  www|ecom|admin|business|public|mobile|voice|k8s|forms|vault|certificate|oidc|origin|invoice|quotation|purchaseorder|jeffistores)
    echo "--domain $DOMAIN is a production host" >&2; exit 2 ;;
esac
[ "$DOMAIN" != jeffistores.in ] || { echo "--domain is the production apex" >&2; exit 2; }
[[ $STORE_TIMEOUT =~ ^[0-9]+$ ]] || { echo "bad --store-timeout-min" >&2; exit 2; }
need kubectl az aws psql curl python3 sed
cd "$REPO"
SHA=$(image_sha); [ -n "$TAG" ] || TAG=local-$SHA; SHA=${TAG#local-}
LOG=$BK_ROOT/rehearsal-$(date +%Y-%m-%d).log
SHIM_DIR=$(mktemp -d); chmod 700 "$SHIM_DIR"; on_exit "rm -rf '$SHIM_DIR'"
FAILED=()
run() { timed "$@" || FAILED+=("$1"); }
must() { timed "$@" || { FAILED+=("$1"); print_times; echo "Stopped: $1 failed." >&2; exit 1; }; }

# ---- the host rewrite: a kubectl shim, first on PATH for the platform scripts only
REAL_KUBECTL=$(command -v kubectl)
cat > "$SHIM_DIR/kubectl" <<EOF
#!/bin/bash
set -o pipefail
REAL='$REAL_KUBECTL'
rw() {
  local extra=()
  [ -z "\${REH_INGRESS_IP:-}" ] || extra=(-e "s#REPLACE_ME_edge_elastic_ip#\$REH_INGRESS_IP#g")
  sed -E -e 's#(wif-voice|oidc|origin)\.jeffistores\.in#\1.KEEPJEFFI#g' -e 's#@jeffistores\.in#@KEEPJEFFI#g' \\
    -e "s#jeffistores\.in#\$REH_DOMAIN#g" -e 's#KEEPJEFFI#jeffistores.in#g' \${extra[@]+"\${extra[@]}"}
}
case "\${1:-}" in
  kustomize) "\$REAL" "\$@" | rw ;;
  apply) if [ \$# -eq 3 ] && [ "\$2" = -f ] && [ -f "\$3" ]; then rw < "\$3" | "\$REAL" apply -f -; else exec "\$REAL" "\$@"; fi ;;
  *) exec "\$REAL" "\$@" ;;
esac
EOF
chmod 700 "$SHIM_DIR/kubectl"
export REH_DOMAIN=$DOMAIN REH_INGRESS_IP=$INGRESS_IP
# smoke.sh with its hosts rewritten the same way (it sources lib.sh by a relative path, so that path is pinned).
sed -E -e "s#jeffistores\.in#$DOMAIN#g" -e "s#^source .*#source '$REPO/deploy/k8s/db/lib.sh'#" \
  deploy/k8s/bootstrap/smoke.sh > "$SHIM_DIR/smoke.sh"

hosts_of() { grep -oE '[A-Za-z0-9*._-]*jeffistores\.in' | sort -u; }

# ---- preflight (read-only)
say "Preflight"
echo "domain $DOMAIN (apps at <app>.$DOMAIN), image tag $TAG, cloud azure"
[ -f "$KUBECONFIG" ] || { echo "no kubeconfig at $KUBECONFIG (README step 5)" >&2; exit 1; }
az account show --query '{subscription:name}' -o tsv >/dev/null || { echo "az is not logged in" >&2; exit 1; }
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
say "Host rewrite preview (overlay as rendered)"
before=$("$REAL_KUBECTL" kustomize "$REPO/deploy/k8s/overlays/azure" | sed -E "s#REPLACE_ME_edge_elastic_ip#x#g" | hosts_of)
after=$(PATH=$SHIM_DIR:$PATH kubectl kustomize "$REPO/deploy/k8s/overlays/azure" | hosts_of)
echo "production hosts in the manifests: $(echo "$before" | wc -l | tr -d ' '); rewritten set:"
echo "$after" | sed 's/^/   /'
[ -z "$COOKIE" ] || [ -s "$COOKIE" ] || { echo "no such cookie file: $COOKIE" >&2; exit 1; }
if ! $SKIP_STORE && [ -z "$COOKIE" ]; then
  echo "The store round trip needs --admin-cookie-file (an administrator's 'Cookie: ...' header line) so the test store can be deleted; or pass --skip-store." >&2
  $APPLY && exit 1
fi

say "Plan"
$RESTORE && echo "  1  restore the prod dump into Azure Postgres (restore-dump.sh), then release-db.sh --cloud=azure"
$SKIP_PLATFORM || echo "  2  secrets.sh, apply-platform.sh $TAG, rollout.sh $TAG platform, wait for the wildcard certificate"
echo "  3  smoke.sh $SHA against $DOMAIN hosts via $AZURE_IP"
$WITH_DNS && echo "  4  Route 53: A $DOMAIN and *.$DOMAIN -> $AZURE_IP (rollback batch saved)"
$SKIP_STORE || echo "  5  throwaway store ${SLUG:-rehearsal-<mmddhhmm>} on plan $PLAN: provision, smoke, deprovision$($KEEP_STORE && echo ' (kept: --keep-store)')"
if ! $APPLY; then echo; echo "Dry run: nothing changed (--apply)."; exit 0; fi

mkdir -p "$BK_ROOT"
exec > >(tee -a "$LOG") 2>&1
echo "=== rehearsal $(date '+%Y-%m-%d %H:%M:%S') tag $TAG domain $DOMAIN azure-ip $AZURE_IP (log $LOG)"
T0=$SECONDS

# ---- 1 database
if $RESTORE; then
  say "1. Database"
  must restore-dump bash "$REPO/deploy/azure/rehearsal/restore-dump.sh" --apply $($YES && echo --yes) --target-db jeffi_stores
  must release-db bash "$REPO/deploy/k8s/db/release-db.sh" --cloud=azure $($YES && echo --yes)
fi

# ---- 2 platform
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
  confirm "Apply the platform to the Azure core ($KUBECONFIG) as <app>.$DOMAIN? It also requests a Let's Encrypt wildcard certificate (a temporary _acme-challenge TXT record in Route 53)."
  [ -f certs/ca-cert.pem ] || { echo "certs/ca-cert.pem is missing (secrets.sh needs the platform CA, README step 9)" >&2; exit 1; }
  must secrets bash deploy/k8s/bootstrap/secrets.sh
  ecr_kick & ECR_PID=$!
  must apply-platform env PATH="$SHIM_DIR:$PATH" bash deploy/k8s/bootstrap/apply-platform.sh "$TAG"
  wait $ECR_PID 2>/dev/null || true
  must rollout-platform env PATH="$SHIM_DIR:$PATH" bash deploy/k8s/bootstrap/rollout.sh "$TAG" platform
  run wildcard-certificate kubectl -n jeffi-edge wait --for=condition=Ready certificate/wildcard-jeffistores --timeout=600s
fi

# ---- 4 dns (before smoke: the browser checks are easier with it, smoke itself connects by IP)
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
  say "4. DNS"
  confirm "Create A records $DOMAIN and *.$DOMAIN -> $AZURE_IP in the jeffistores.in zone (new names only)?"
  run dns dns_records
fi

# ---- 3 smoke
say "3. Smoke"
run smoke env SMOKE_CONNECT_TO="::$AZURE_IP:" bash "$SHIM_DIR/smoke.sh" "$SHA"

# ---- 5 store round trip
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
store_build() {
  local end=$((SECONDS + STORE_TIMEOUT * 60)) last= row st kick=0
  while [ $SECONDS -lt $end ]; do
    if [ $((SECONDS - kick)) -ge 60 ]; then
      in_cluster provisioning_advance /api/internal/provisioning/advance "{\"tenantId\":\"$tid\"}" >/dev/null 2>&1 || true; kick=$SECONDS
    fi
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
    "https://ecom.$DOMAIN/api/admin/ecom/customers/$tid/deprovision" || true)
  echo "deprovision: HTTP $code $(head -c 300 "$SHIM_DIR/dep.json" 2>/dev/null)"
  [ "$code" = 200 ] || return 1
  echo "tenant status now: $(psql_app jeffi_stores -At -c "select status from tenants where id='$tid'")"
  if kubectl get ns "tenant-$SLUG" >/dev/null 2>&1; then echo "namespace tenant-$SLUG still exists" >&2; return 1; fi
  echo "namespace tenant-$SLUG is gone"
}
if ! $SKIP_STORE; then
  say "5. Store round trip"
  [ -n "$SLUG" ] || SLUG=rehearsal-$(date +%m%d%H%M)
  [[ $SLUG =~ ^[a-z0-9][a-z0-9-]{2,40}$ ]] || { echo "bad --slug" >&2; exit 2; }
  code=$(ADMIN_CURL -o /dev/null -w '%{http_code}' "https://ecom.$DOMAIN/api/admin/ecom/customers/overview" || true)
  case $code in 2??) echo "admin session accepted" ;; *) echo "The admin cookie is not accepted on https://ecom.$DOMAIN (HTTP $code); no store created." >&2; FAILED+=(admin-auth); SKIP_STORE=true ;; esac
fi
if ! $SKIP_STORE; then
  confirm "Create store $SLUG? This launches an AWS EC2 node and EBS volume and Route 53 records for $SLUG.jeffistores.in (billable, removed by the deprovision step)."
  STORE_LEFT=0; on_exit '[ "${STORE_LEFT:-0}" = 1 ] && echo "Test store $SLUG (tenant ${tid:-?}) may still exist: deprovision it before leaving it." >&2'
  must store-create store_create
  BUILD_T0=$SECONDS
  run store-provision store_build
  run store-smoke env SMOKE_CONNECT_TO="::$AZURE_IP:" bash "$SHIM_DIR/smoke.sh" "$SHA" storefront tenants
  if $KEEP_STORE; then echo "Kept: tenant $tid ($SLUG)"
  else must store-delete store_delete; STORE_LEFT=0
    echo "Check for leftovers: aws ec2 describe-instances --filters 'Name=tag:Name,Values=*$SLUG*' --query 'Reservations[].Instances[].[InstanceId,State.Name]' --output text"
  fi
fi

say "Result"
print_times
echo "Total $((SECONDS - T0))s"
if [ ${#FAILED[@]} -gt 0 ]; then echo "FAILED: ${FAILED[*]}"; echo "Report: $LOG"; exit 1; fi
echo "All steps passed. Report: $LOG"
