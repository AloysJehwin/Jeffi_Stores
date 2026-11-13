#!/bin/bash
# After a rollout, prove it is serving, per service (ci.yml runs one per service job). Scope (default both):
#   flagship  the platform's deployment of the service: its pod answers its own health check (Host: localhost,
#             as the probes do), the Next apps' /api/health reporting <sha>, and its public host answers
#   tenants   (store services) the same in every store that runs it; the storefront also through each store's
#             own host, reporting <sha>. Suspended stores (scaled to 0) are skipped.
# No service: every one. A host that does not answer (000) or answers 5xx fails it. --dry-run reports what is
# live and never fails.
# Usage: smoke.sh <sha> [controller|storefront|admin|business|messaging|documents|public-api|mobile] [flagship|tenants] [--dry-run]
source "$(dirname "$0")/../db/lib.sh"
SHA=${1:?image sha}
SCOPE=all SERVICES="controller storefront admin business messaging documents public-api mobile"
for a in "${@:2}"; do case $a in
  flagship|tenants) SCOPE=$a ;;
  controller|storefront|admin|business|messaging|documents|public-api|mobile) SERVICES=$a ;;
esac; done
k8s_tunnel
bad=0
fail() { echo "   FAIL $*" >&2; bad=1; }

check() { # check <url> [require-commit]
  local body code
  body=$(curl -s --max-time 15 -w '\n%{http_code}' "$1" || true)
  code=${body##*$'\n'}; body=${body%$'\n'*}
  printf '   %s %s\n' "$code" "$1"
  case $code in 000|5??) fail "$1 answered $code" ;; esac
  if [ -n "${2:-}" ] && ! echo "$body" | grep -q "\"commit\":\"$SHA\""; then fail "$1 is not at $SHA"; fi
}

# The service's own health check, from inside one of its pods: <port> <path> [require-commit].
health() {
  case $1 in
    controller|storefront|admin|business) echo "3000 /api/health commit" ;;
    messaging) echo "3101 /healthz" ;; documents) echo "3102 /healthz" ;;
    public-api) echo "3100 /healthz" ;; mobile) echo "3103 /api/health" ;;
  esac
}
in_pod() { # in_pod <namespace> <deployment> <service>
  local port path commit out
  read -r port path commit <<<"$(health "$3")"
  out=$(kubectl -n "$1" exec "deploy/$2" -- node -e '
    const [port, path, sha] = process.argv.slice(1)
    fetch(`http://127.0.0.1:${port}${path}`, { headers: { host: "localhost" }, signal: AbortSignal.timeout(10000) })
      .then(async r => { const b = await r.text(); const at = !sha || b.includes(`"commit":"${sha}"`)
        console.log(`${r.status}${at ? "" : " not at " + sha}`); process.exit(r.ok && at ? 0 : 1) })
      .catch(e => { console.log(`000 ${e.message}`); process.exit(1) })' "$port" "$path" "${commit:+$SHA}" 2>&1 | tail -1) ||
    { printf '   %s %s/%s %s\n' "${out%% *}" "$1" "$2" "$path"; fail "$1/$2 $path: $out"; return 0; }
  printf '   %s %s/%s %s\n' "$out" "$1" "$2" "$path"
}

flagship() { # flagship <service>
  local d; [ "$1" = documents ] && d=jeffi-stores-document-service || d=jeffi-stores-$1-service
  in_pod jeffi "$d" "$1"
  case $1 in
    controller) check https://ecom.jeffistores.in/ ;;
    storefront) check https://jeffistores.in/api/health commit; check https://jeffistores.in/ ;;
    business) check https://business.jeffistores.in/ ;;
    public-api) check https://public.jeffistores.in/healthz ;;
    mobile) check https://mobile.jeffistores.in/healthz ;;
  esac
}

stores() { # stores <service>
  local n=0 ns slug d host
  for ns in $(kubectl get ns -l jeffi.io/tier=tenant -o jsonpath='{.items[*].metadata.name}'); do
    slug=${ns#tenant-}; [ "$1" = documents ] && d=$slug-document-service || d=$slug-$1-service
    kubectl -n "$ns" get deploy "$d" >/dev/null 2>&1 || continue
    [ "$(kubectl -n "$ns" get deploy "$d" -o jsonpath='{.spec.replicas}')" = 0 ] && { echo "   skip $slug (suspended)"; continue; }
    n=$((n + 1))
    in_pod "$ns" "$d" "$1"
    if [ "$1" = storefront ]; then
      host=$(kubectl -n "$ns" get ingressroute store -o jsonpath='{.spec.routes[0].match}' 2>/dev/null | grep -oE 'Host\(`[^`]+`\)' | head -1 | sed -E 's/^Host\(`([^`]+)`\)$/\1/')
      [ -n "$host" ] && check "https://$host/api/health" commit
    fi
  done
  echo "   $n store(s) checked"
}

for s in $SERVICES; do
  if [ "$SCOPE" != tenants ]; then say "Flagship $s"; flagship "$s"; fi
  case $s in storefront|admin|business|messaging|documents)
    if [ "$SCOPE" != flagship ]; then say "Stores' $s"; stores "$s"; fi ;;
  esac
done

if [ "$bad" = 1 ]; then
  if $DRY_RUN; then echo "   (dry run: not failing)"; else exit 1; fi
fi
echo "   OK"
