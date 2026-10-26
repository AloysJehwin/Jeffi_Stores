#!/bin/bash
# Live content, run by hand after a release that ships the bundle (not part of release-db.sh):
#   1. the flagship homepage mirrored from the local export (deploy/k8s/db/content/export-homepage.sh): both
#      surfaces' sections and hero slides replaced, offers and their products upserted by slug, offers not in the
#      bundle switched off, the gallery rows the content shows added;
#   2. blurhashes for every stored image without one, on the flagship DB and every active tenant's.
# Both run inside the controller pod (its secrets and DB), through the internal routes under /api/internal/content.
# Without --apply nothing is written: it prints the homepage plan and how many images lack a blurhash.
# Usage: bash deploy/k8s/db/60-live-content.sh [--apply] [--yes]
source "$(dirname "$0")/lib.sh"
APPLY=false
for a in "$@"; do [ "$a" = --apply ] && APPLY=true; done
k8s_tunnel

# in_cluster prints the JSON response, then "<job> <status>"; keep the JSON, and show it when the call fails.
call() {
  local out
  out=$(in_cluster "$1" "$2" "$3") || {
    if [ "${out##* }" = 404 ]; then
      echo "The live controller has no $2 yet: it ships with the release that adds this script. Release first, then re-run." >&2
    else
      echo "$out" >&2
    fi
    return 1
  }
  sed '$d' <<<"$out"
}
step() { # <response json>: one line per blurhash batch; prints `next` (JSON) on the last line
  python3 -I - "$1" <<'PY'
import json, sys
r = json.loads(sys.argv[1])
n, failed = r.get("next"), r.get("failed") or []
where = f"resume at {n['target']} column {n['col']}" if n else "done"
print(f"updated {r.get('updated', 0)}, could not hash {len(failed)} ({where})", file=sys.stderr)
for f in failed[:20]:
    print("  ", f, file=sys.stderr)
print(json.dumps(n))
PY
}

say "Homepage: plan"
call content_homepage /api/internal/content/homepage '{}'
say "Blurhash: images without one"
call content_blurhash /api/internal/content/blurhash '{}'

$APPLY || { echo; echo "Dry run: nothing was written. Re-run with --apply to mirror the homepage and fill the blurhashes."; exit 0; }

confirm "This REPLACES the live homepage (both surfaces) with the bundle above and switches off offers not in it."
say "Homepage: apply"
call content_homepage /api/internal/content/homepage '{"apply":true}'

say "Blurhash: fill"
NEXT=null
while :; do
  NEXT=$(step "$(call content_blurhash /api/internal/content/blurhash "{\"apply\":true,\"next\":$NEXT}")")
  [ "$NEXT" = null ] && break
done
say "Blurhash: still missing (images that could not be fetched)"
call content_blurhash /api/internal/content/blurhash '{}'
