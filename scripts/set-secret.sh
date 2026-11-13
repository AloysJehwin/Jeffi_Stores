#!/usr/bin/env bash
# Set one key in every Secrets Manager secret that needs it, then (optionally) restart the pods that read it.
# Values are never printed: you're prompted for them hidden, or point at a file (multi-line JSON such as a
# Firebase service account is read from the file and stored compacted).
#
#   scripts/set-secret.sh                                  # asks for the key name and value
#   scripts/set-secret.sh FCM_SERVICE_ACCOUNT_JSON         # asks for the value
#   scripts/set-secret.sh FCM_SERVICE_ACCOUNT_JSON --file ~/Downloads/jeffi-stores-215e5-firebase-adminsdk.json
#   flags: --also messaging,documents   extra service secrets   --only production,local   skip the defaults
#          --dry-run   show the plan, write nothing           --yes   no confirmation   --no-restart
#
# Where keys live (pods read their secret at startup, so a change needs a restart):
#   jeffi/production            controller; the source of jeffi/store
#   jeffi/store                 storefront, admin, business (flagship + every tenant), rebuilt from production by
#                               deploy/k8s/bootstrap/store-secret.sh (control-plane-only keys left out)
#   jeffi/<svc>/production      messaging, documents, public-api, mobile services
#   jeffi/local                 local dev (deploy/load-secrets.mjs)
set -euo pipefail
cd "$(dirname "$0")/.."
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
umask 077
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

SERVICES=(messaging documents public-api mobile)
# Service secrets a key belongs in even before it is there (messaging-service sends push when MESSAGING_INLINE=false).
key_services() { case $1 in FCM_SERVICE_ACCOUNT_JSON) echo messaging ;; esac; }
# Per-secret state, without bash 4 associative arrays (macOS ships bash 3.2).
svar() { echo "STATE_$(echo "$1" | tr '/.-' '___')"; }
set_state() { printf -v "$(svar "$1")" '%s' "$2"; }
get_state() { local v; v=$(svar "$1"); echo "${!v:-}"; }

KEY="" FILE="" ALSO="" ONLY="" DRY=false YES=false RESTART=ask
while [ $# -gt 0 ]; do
  case $1 in
    --file) FILE=$2; shift ;;
    --file=*) FILE=${1#*=} ;;
    --also) ALSO=$2; shift ;;
    --also=*) ALSO=${1#*=} ;;
    --only) ONLY=$2; shift ;;
    --only=*) ONLY=${1#*=} ;;
    --dry-run) DRY=true ;;
    --yes) YES=true ;;
    --no-restart) RESTART=no ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    -*) echo "Unknown flag: $1" >&2; exit 1 ;;
    *) KEY=$1 ;;
  esac
  shift
done

ask() { local p=$1 v; printf '%s' "$p" > /dev/tty; IFS= read -r v < /dev/tty; printf '%s' "$v"; }

[ -n "$KEY" ] || KEY=$(ask 'Key name (e.g. FCM_SERVICE_ACCOUNT_JSON): ')
[[ "$KEY" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "Bad key name: '$KEY' (UPPER_SNAKE_CASE)" >&2; exit 1; }

aws sts get-caller-identity --query Arn --output text > "$TMP/who" 2>/dev/null || { echo "AWS CLI isn't signed in: run 'aws login' (or aws sso login) first." >&2; exit 1; }
echo "AWS: $(cat "$TMP/who")  region $REGION"

# ── the value ──
if [ -z "$FILE" ]; then
  printf 'Value for %s (hidden; or a path to a file, e.g. ~/Downloads/key.json): ' "$KEY" > /dev/tty
  IFS= read -r -s VAL < /dev/tty; echo > /dev/tty
  cand="${VAL/#\~/$HOME}"
  if [ -n "$VAL" ] && [ -f "$cand" ]; then FILE=$cand; VAL=""; fi
fi
if [ -n "$FILE" ]; then
  FILE="${FILE/#\~/$HOME}"
  [ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 1; }
  VAL=$(cat "$FILE")
fi
[ -n "${VAL:-}" ] || { echo "Empty value: nothing to set." >&2; exit 1; }
# JSON (a service account file) is checked and stored on one line; anything else is trimmed.
VAL=$(V="$VAL" K="$KEY" python3 -I -c '
import json, os, sys
v = os.environ["V"].strip()
if v.startswith("{") or v.startswith("["):
    try: d = json.loads(v)
    except Exception as e: sys.exit(f"The value looks like JSON but does not parse: {e}")
    if os.environ["K"] == "FCM_SERVICE_ACCOUNT_JSON":
        miss = [k for k in ("project_id", "client_email", "private_key") if not d.get(k)]
        if d.get("type") != "service_account" or miss:
            sys.exit("This is not a Firebase service account key (Project settings > Service accounts > Generate new private key).")
        print("  Firebase project: %s  account: %s" % (d["project_id"], d["client_email"]), file=sys.stderr)
    v = json.dumps(d, separators=(",", ":"))
print(v, end="")') || exit 1
if [ "$KEY" = FCM_SERVICE_ACCOUNT_JSON ]; then
  app=$(python3 -I -c 'import json; print(json.load(open("mobile-service/client/google-services.json"))["project_info"]["project_id"])' 2>/dev/null || true)
  got=$(V="$VAL" python3 -I -c 'import json,os; print(json.loads(os.environ["V"])["project_id"])')
  [ -z "$app" ] || [ "$app" = "$got" ] || { echo "The key is for Firebase project '$got' but the app is built with '$app': push would fail (SENDER_ID_MISMATCH)." >&2; exit 1; }
fi
FP=$(V="$VAL" python3 -I -c 'import hashlib,os; print(hashlib.sha256(os.environ["V"].encode()).hexdigest()[:8])')
echo "  value: ${#VAL} chars, sha256 ${FP}…"

# ── targets ──
svc_id() { echo "jeffi/$1/production"; }
read_secret() { aws secretsmanager get-secret-value --region "$REGION" --secret-id "$1" --query SecretString --output text 2>/dev/null; }
# has-key / same-value checks without printing anything
state_of() { # <secret id> → unset | same | differs | missing-secret
  local raw; raw=$(read_secret "$1") || { echo missing-secret; return; }
  RAW="$raw" K="$KEY" V="$VAL" python3 -I -c '
import json, os
try: d = json.loads(os.environ["RAW"] or "{}")
except Exception: d = {}
k = os.environ["K"]
print("unset" if k not in d or d[k] in (None, "") else ("same" if d[k] == os.environ["V"] else "differs"))'
}

TARGETS=()
if [ -n "$ONLY" ]; then
  IFS=, read -ra pick <<< "$ONLY"
  for t in "${pick[@]}"; do case $t in production|local|store) TARGETS+=("jeffi/$t") ;; *) TARGETS+=("$(svc_id "$t")") ;; esac; done
else
  TARGETS=(jeffi/production jeffi/store jeffi/local)
  extra=" $(key_services "$KEY") ${ALSO//,/ } "
  for s in "${SERVICES[@]}"; do
    st=$(state_of "$(svc_id "$s")")
    # a service secret that already holds the key, or one this key is known to belong in
    if [ "$st" != missing-secret ] && { [[ "$extra" == *" $s "* ]] || [ "$st" != unset ]; }; then
      TARGETS+=("$(svc_id "$s")")
    fi
  done
fi
# keys only the control plane reads stay out of jeffi/store
EXCLUDED=$(K="$KEY" python3 -I -c '
import os
k = os.environ["K"]
pats = [l.strip() for l in open("deploy/k8s/bootstrap/store-secret-exclude.txt") if l.strip() and not l.startswith("#")]
print("yes" if any(k.startswith(p[:-1]) if p.endswith("*") else k == p for p in pats) else "no")')

echo
echo "Plan for $KEY:"
for id in "${TARGETS[@]}"; do
  if [ "$id" = jeffi/store ]; then
    [ "$EXCLUDED" = yes ] && { echo "  jeffi/store                  skipped: $KEY is a control-plane-only key (store-secret-exclude.txt)"; continue; }
    set_state "$id" "$(state_of "$id")"
    echo "  jeffi/store                  $(get_state "$id") → rebuilt from jeffi/production (store-secret.sh)"
    continue
  fi
  set_state "$id" "$(state_of "$id")"
  case $(get_state "$id") in
    missing-secret) note="secret does not exist (or no access): skipped" ;;
    same) note="already set to this value" ;;
    unset) note="add" ;;
    differs) note="replace the current value" ;;
  esac
  printf '  %-28s %s\n' "$id" "$note"
done
echo
if $DRY; then echo "(dry run) nothing written."; exit 0; fi
if ! $YES; then a=$(ask 'Write these? Type yes: '); [ "$a" = yes ] || { echo "Stopped."; exit 1; }; fi

# ── write ──
STAMP=$(date +%Y%m%d-%H%M%S)
ROLLBACK="$HOME/Documents/db-backups/secret-rollback-$KEY-$STAMP.sh"
mkdir -p "$(dirname "$ROLLBACK")"; echo "#!/bin/bash  # restore the previous versions ($KEY, $STAMP)" > "$ROLLBACK"
CHANGED=()
put() { # <secret id>: merge KEY into it
  local id=$1 raw old new
  raw=$(read_secret "$id")
  old=$(aws secretsmanager describe-secret --region "$REGION" --secret-id "$id" --query 'VersionIdsToStages' --output json |
    python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(next(k for k,v in d.items() if "AWSCURRENT" in v))')
  RAW="$raw" K="$KEY" V="$VAL" python3 -I -c '
import json, os, sys
d = json.loads(os.environ["RAW"] or "{}")
d[os.environ["K"]] = os.environ["V"]
json.dump(d, open(sys.argv[1], "w"))' "$TMP/new.json"
  new=$(aws secretsmanager put-secret-value --region "$REGION" --secret-id "$id" --secret-string "file://$TMP/new.json" --query VersionId --output text)
  rm -f "$TMP/new.json"
  echo "aws secretsmanager update-secret-version-stage --region $REGION --secret-id $id --version-stage AWSCURRENT --move-to-version-id $old --remove-from-version-id $new" >> "$ROLLBACK"
  CHANGED+=("$id")
  echo "  $id written"
}
for id in "${TARGETS[@]}"; do
  [ "$id" = jeffi/store ] && continue
  case $(get_state "$id") in unset|differs) put "$id" ;; esac
done
if [[ " ${TARGETS[*]} " == *" jeffi/store "* ]] && [ "$EXCLUDED" = no ]; then
  out=$(bash deploy/k8s/bootstrap/store-secret.sh 2>&1) || { echo "$out" >&2; exit 1; }
  echo "  $(echo "$out" | tail -1)"
  [[ "$out" == *unchanged* ]] || CHANGED+=(jeffi/store)
fi
[ ${#CHANGED[@]} -gt 0 ] || { echo "Nothing changed."; rm -f "$ROLLBACK"; exit 0; }
echo "Rollback commands: $ROLLBACK"

# ── restart the pods that read a changed secret ──
SEL=()
for id in "${CHANGED[@]}"; do
  case $id in
    jeffi/production) SEL+=(controller) ;;
    jeffi/store) SEL+=(storefront admin business) ;;
    jeffi/local) ;;
    jeffi/*/production) s=${id#jeffi/}; SEL+=("${s%/production}") ;;
  esac
done
[ ${#SEL[@]} -gt 0 ] || { echo "Only jeffi/local changed: restart your dev server (npm run dev) to pick it up."; exit 0; }
LIST=$(IFS=,; echo "${SEL[*]}")
echo
echo "Pods to restart (every namespace): jeffi.io/service in ($LIST)"
[ "$RESTART" = no ] && { echo "Skipped (--no-restart). Later: kubectl rollout restart deploy -A -l 'jeffi.io/service in ($LIST)'"; exit 0; }
if ! $YES; then a=$(ask 'Restart them now? (needs the cluster tunnel) [y/N]: '); [[ "$a" =~ ^[Yy] ]] || { echo "Not restarted. The new value applies on the next release or restart."; exit 0; }; fi
# shellcheck source=/dev/null
( source deploy/k8s/db/lib.sh --yes
  k8s_tunnel
  kubectl get deploy -A -l "jeffi.io/service in ($LIST)" -o jsonpath='{range .items[*]}{.metadata.namespace} {.metadata.name}{"\n"}{end}' |
    while read -r ns name; do
      [ -n "$name" ] || continue
      kubectl -n "$ns" rollout restart deploy/"$name" >/dev/null && echo "  restarting $ns/$name"
    done
  kubectl get deploy -A -l "jeffi.io/service in ($LIST)" -o jsonpath='{range .items[*]}{.metadata.namespace} {.metadata.name}{"\n"}{end}' |
    while read -r ns name; do
      [ -n "$name" ] || continue
      kubectl -n "$ns" rollout status deploy/"$name" --timeout=300s >/dev/null && echo "  ready     $ns/$name" || echo "  NOT READY $ns/$name (check: kubectl -n $ns get pods)"
    done )
echo "Done."
