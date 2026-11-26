# Shared by restore-dump.sh and rehearse.sh (sourced). Pulls in the release scripts' helpers (deploy/k8s/db/lib.sh):
# JEFFI_CLOUD handling, Key Vault, the Azure Postgres address, on_exit, confirm, say. The caller sets JEFFI_CLOUD first.
# Dry run by default: APPLY is true only with --apply. --yes skips the prompts (lib.sh).
APPLY=false; for a in "$@"; do [ "$a" = --apply ] && APPLY=true; done
source "$(dirname "${BASH_SOURCE[0]}")/../../k8s/db/lib.sh"
umask 077
RSTAMP=${RSTAMP:-$(date +%Y%m%d-%H%M)}
BK_ROOT=${BK_ROOT:-$HOME/Documents/db-backups}

# Per-step timings: timed <name> <command...> runs it in this shell, records seconds and its status, returns its status.
TIMES=()
timed() {
  local n=$1 t0=$SECONDS rc=0; shift
  "$@" || rc=$?
  TIMES+=("$n|$((SECONDS - t0))|$rc")
  printf '   [%s: %ss%s]\n' "$n" "$((SECONDS - t0))" "$([ "$rc" = 0 ] || echo ", exit $rc")"
  return $rc
}
print_times() {
  say "Timings"
  local t n s rc
  for t in ${TIMES[@]+"${TIMES[@]}"}; do
    IFS='|' read -r n s rc <<<"$t"
    printf '   %-28s %6ss  %s\n' "$n" "$s" "$([ "$rc" = 0 ] && echo ok || echo "FAILED ($rc)")"
  done
}
need() { local c; for c in "$@"; do command -v "$c" >/dev/null || { echo "missing tool: $c" >&2; exit 1; }; done; }
major_of() { sed -E 's/^[^0-9]*([0-9]+).*/\1/'; }
