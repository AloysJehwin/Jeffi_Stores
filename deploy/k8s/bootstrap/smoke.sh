#!/bin/bash
# After a rollout, prove it is serving. Scope (default both):
#   flagship  /api/health reports <sha>, and the platform hosts answer without a 5xx
#   tenants   every running store's /api/health answers and reports <sha> (suspended stores are skipped)
# Any host that does not answer (000) or answers 5xx fails the stage. --dry-run reports what is live and
# never fails.
# Usage: smoke.sh <sha> [flagship|tenants] [--dry-run]
source "$(dirname "$0")/../db/lib.sh"
SHA=${1:?image sha}
SCOPE=all
for a in "${@:2}"; do case $a in flagship|tenants) SCOPE=$a ;; esac; done
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

if [ "$SCOPE" != tenants ]; then
  say "Flagship"
  check https://jeffistores.in/api/health commit
  for u in https://jeffistores.in/ https://business.jeffistores.in/ https://ecom.jeffistores.in/ https://public.jeffistores.in/healthz https://mobile.jeffistores.in/healthz; do check "$u"; done
fi

if [ "$SCOPE" != flagship ]; then
  say "Tenants"
  n=0
  for ns in $(kubectl get ns -l jeffi.io/tier=tenant -o jsonpath='{.items[*].metadata.name}'); do
    # The store's route: `store` (its own services) or `controller` (the old all-in-one app).
    host=$(kubectl -n "$ns" get ingressroute store controller -o jsonpath='{.items[0].spec.routes[0].match}' 2>/dev/null | grep -oE 'Host\(`[^`]+`\)' | head -1 | sed -E 's/^Host\(`([^`]+)`\)$/\1/')
    [ -n "$host" ] || continue
    # A suspended store has its storefront (or old app) scaled to 0 and is expected not to answer.
    [ "$(kubectl -n "$ns" get deploy -l 'jeffi.io/service in (storefront,controller)' -o jsonpath='{.items[0].spec.replicas}' 2>/dev/null)" = 0 ] && { echo "   skip $host (suspended)"; continue; }
    n=$((n + 1))
    check "https://$host/api/health" commit
  done
  echo "   $n store(s) checked"
fi

if [ "$bad" = 1 ]; then
  if $DRY_RUN; then echo "   (dry run: not failing)"; else exit 1; fi
fi
echo "   OK"
