#!/bin/bash
# Makes sure jeffi/production holds ADMIN_GATEWAY_SECRET and CRON_SECRET: a missing one is generated, an existing
# one is never replaced. Then copies ADMIN_GATEWAY_SECRET to jeffi/public-api/production (the release does not),
# and checks the copies the store apps and CronJobs read. Warns (only) when the Meta app keys are missing.
# Prints no values; rollback commands go to $OUT_DIR/ensure-secrets-rollback.sh.
# Usage: bash deploy/k8s/bootstrap/ensure-release-secrets.sh [--dry-run] [--yes] [--sync-store] [--cluster]
#   --sync-store  refresh jeffi/store now (store-secret.sh); each release does it anyway
#   --cluster     also check the k8s cron-secret the CronJobs use (not refreshed by the release) and fix it
source "$(dirname "$0")/../db/lib.sh"
SYNC_STORE=false; CLUSTER=false
for a in "$@"; do case $a in
  --sync-store) SYNC_STORE=true ;; --cluster) CLUSTER=true ;; --dry-run|--yes) ;;
  *) echo "Unknown option $a" >&2; exit 2 ;;
esac; done
umask 077
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
get() { aws secretsmanager get-secret-value --secret-id "$1" --query SecretString --output text; }
ver() { aws secretsmanager get-secret-value --secret-id "$1" --query VersionId --output text; }

# <src.json> <dst.json> <out.json|-> <key>...: copies keys whose value differs; exit 3 when nothing changes.
cat > "$TMP/copy.py" <<'PY'
import json, sys
src_f, dst_f, out_f, *keys = sys.argv[1:]
src, dst = json.load(open(src_f)), json.load(open(dst_f))
new, n = dict(dst), 0
for k in keys:
    if dst.get(k) == src.get(k): print(f'  {k}: matches jeffi/production'); continue
    print(f'  {k}: {"different" if dst.get(k) else "missing"}, will be copied from jeffi/production')
    new[k] = src[k]; n += 1
if out_f != '-': json.dump(new, open(out_f, 'w'))
sys.exit(0 if n else 3)
PY
run() { local rc=0; "$@" || rc=$?; [ $rc = 0 ] || [ $rc = 3 ] || exit 1; return $rc; }
TODO=""

say "jeffi/production"
get jeffi/production > "$TMP/prod.json"
if run python3 -I - "$TMP/prod.json" "$TMP/prod.new" <<'PY'
import json, secrets, sys
cur = json.load(open(sys.argv[1])); new, n = dict(cur), 0
for k in ('ADMIN_GATEWAY_SECRET', 'CRON_SECRET'):
    v = cur.get(k)
    if isinstance(v, str) and v.strip(): print(f'  {k}: present ({len(v)} characters), kept'); continue
    new[k] = secrets.token_hex(32); n += 1
    print(f'  {k}: missing, a new 64-character value will be generated')
json.dump(new, open(sys.argv[2], 'w'))
sys.exit(0 if n else 3)
PY
then TODO="$TODO prod"; fi

say "Meta app keys in jeffi/production (warning only; never written)"
python3 -I - "$TMP/prod.json" <<'PY'
import json, sys
cur = json.load(open(sys.argv[1]))
for k in ('META_APP_ID', 'META_APP_SECRET'):
    v = cur.get(k)
    if isinstance(v, str) and v.strip(): print(f'  {k}: present')
    else: print(f'  {k}: WARNING, missing. Facebook sign-in for Social Posts and Meta Ads stays off for stores without their own Meta app.')
PY

say "jeffi/public-api/production (the gateway signs with it)"
get jeffi/public-api/production > "$TMP/pub.json"
if run python3 -I "$TMP/copy.py" "$TMP/prod.new" "$TMP/pub.json" "$TMP/pub.new" ADMIN_GATEWAY_SECRET; then TODO="$TODO pub"; fi

say "jeffi/store (store apps; store-secret.sh copies it from jeffi/production on every release)"
if get jeffi/store > "$TMP/store.json" 2>/dev/null; then
  if run python3 -I "$TMP/copy.py" "$TMP/prod.new" "$TMP/store.json" - ADMIN_GATEWAY_SECRET CRON_SECRET; then
    if $SYNC_STORE; then TODO="$TODO store"; else echo "  The next release copies it; --sync-store does it now."; fi
  fi
else
  echo "  not created yet; the release creates it"
fi

say "Secrets that must NOT hold ADMIN_GATEWAY_SECRET"
for id in jeffi/messaging/production jeffi/documents/production; do
  if get "$id" | python3 -I -c 'import json, sys; sys.exit("ADMIN_GATEWAY_SECRET" in json.load(sys.stdin))'; then
    echo "  $id: not present (good)"
  else
    echo "  $id: WARNING, holds ADMIN_GATEWAY_SECRET. Remove it there by hand; those pods must not sign gateway calls."
  fi
done

if $CLUSTER; then
  say "k8s cron-secret, namespace jeffi (the CronJobs' bearer)"
  k8s_tunnel
  python3 -I -c 'import json, sys; open(sys.argv[2], "w").write(json.load(open(sys.argv[1]))["CRON_SECRET"])' "$TMP/prod.new" "$TMP/cron.prod"
  { kubectl -n jeffi get secret cron-secret -o jsonpath='{.data.CRON_SECRET}' | base64 -d; } > "$TMP/cron.k8s" 2>/dev/null || true
  if cmp -s "$TMP/cron.k8s" "$TMP/cron.prod"; then echo "  CRON_SECRET: matches jeffi/production"
  else echo "  CRON_SECRET: $([ -s "$TMP/cron.k8s" ] && echo different || echo missing), will be set from jeffi/production"; TODO="$TODO cron"; fi
else
  echo; echo "(k8s cron-secret not checked; add --cluster to compare it with jeffi/production)"
fi

if $DRY_RUN; then echo; echo "Dry run: nothing written."; exit 0; fi
[ -n "$TODO" ] || { echo; echo "Nothing to do."; exit 0; }
echo; confirm "Write the changes above?"

mkdir -p "$OUT_DIR"; RB=$OUT_DIR/ensure-secrets-rollback.sh
echo "# Restores the Secrets Manager versions from before ensure-release-secrets.sh ($STAMP)." > "$RB"
put() {
  local id=$1 file=$2 old new
  old=$(ver "$id")
  new=$(aws secretsmanager put-secret-value --secret-id "$id" --secret-string "file://$file" --query VersionId --output text)
  echo "aws secretsmanager update-secret-version-stage --secret-id $id --version-stage AWSCURRENT --move-to-version-id $old --remove-from-version-id $new" >> "$RB"
  echo "  $id updated"
}
say "Writing"
case " $TODO " in *" prod "*) put jeffi/production "$TMP/prod.new" ;; esac
case " $TODO " in *" pub "*) put jeffi/public-api/production "$TMP/pub.new" ;; esac
case " $TODO " in *" store "*) bash "$(dirname "$0")/store-secret.sh" ;; esac
case " $TODO " in *" cron "*)
  kubectl -n jeffi create secret generic cron-secret --from-file=CRON_SECRET="$TMP/cron.prod" --dry-run=client -o yaml |
    kubectl apply -f - >/dev/null
  echo "  k8s cron-secret updated" ;;
esac
echo
echo "Done. Rollback for Secrets Manager: bash $RB"
echo "Pods read secrets when they start, so the next release's rollout picks the values up; CronJobs read cron-secret on every run."
