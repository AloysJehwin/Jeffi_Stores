#!/bin/bash
# After a rollout: the live /api/health must report <sha>, then every platform and store host's status code.
# --dry-run reports what is live without failing on the commit.
# Usage: smoke.sh <sha> [--dry-run]
source "$(dirname "$0")/../db/lib.sh"
SHA=${1:?image sha}
k8s_tunnel
health=$(curl -s --max-time 15 https://jeffistores.in/api/health)
echo "   $health"
if ! echo "$health" | grep -q "\"commit\":\"$SHA\""; then
  $DRY_RUN && echo "   live commit is not $SHA yet (dry run)" || { echo "   live commit is not $SHA" >&2; exit 1; }
fi
URLS="https://jeffistores.in/ https://business.jeffistores.in/ https://ecom.jeffistores.in/ https://public.jeffistores.in/healthz"
for ns in $(kubectl get ns -l jeffi.io/tier=tenant -o jsonpath='{.items[*].metadata.name}'); do
  host=$(kubectl -n "$ns" get ingressroute controller -o jsonpath='{.spec.routes[0].match}' 2>/dev/null | sed -E 's/^Host\(`([^`]+)`.*/\1/')
  [ -n "$host" ] && URLS="$URLS https://$host/api/health"
done
for u in $URLS; do printf '   %s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$u")" "$u"; done
