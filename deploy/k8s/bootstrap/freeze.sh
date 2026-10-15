#!/bin/bash
# Write freeze for a release window, in the jeffi namespace and every store namespace (Redis keeps running).
#   on   records replicas and CronJob state, suspends the CronJobs, scales the app Deployments to 0
#   off  resumes the CronJobs that were running and scales back each recorded Deployment that still exists
#        (after a release the pre-release ones are gone and the new ones are already up)
# Usage: bash deploy/k8s/bootstrap/freeze.sh on|off
set -euo pipefail
export KUBECONFIG=${KUBECONFIG:-$HOME/.kube/jeffi-k3s.yaml}
STATE=${FREEZE_STATE:-$HOME/Documents/db-backups/freeze-state.txt}
NSS="jeffi $(kubectl get ns -l jeffi.io/tier=tenant -o jsonpath='{.items[*].metadata.name}')"

case ${1:?on|off} in
on)
  [ ! -s "$STATE" ] || { echo "$STATE exists: already frozen? Run off first, or remove it." >&2; exit 1; }
  mkdir -p "$(dirname "$STATE")"
  kubectl -n jeffi get cronjob -o jsonpath='{range .items[*]}cronjob jeffi {.metadata.name} {.spec.suspend}{"\n"}{end}' > "$STATE"
  for ns in $NSS; do
    kubectl -n "$ns" get deploy -l 'app!=redis' -o jsonpath='{range .items[*]}deploy '"$ns"' {.metadata.name} {.spec.replicas}{"\n"}{end}' >> "$STATE"
  done
  kubectl -n jeffi get cronjob -o name | xargs -n1 kubectl -n jeffi patch --type merge -p '{"spec":{"suspend":true}}' >/dev/null
  grep '^deploy ' "$STATE" | while read -r _ ns name _; do kubectl -n "$ns" scale "deploy/$name" --replicas=0; done
  echo "Frozen; state in $STATE"
  ;;
off)
  [ -s "$STATE" ] || { echo "No $STATE" >&2; exit 1; }
  while read -r kind ns name val; do
    if [ "$kind" = cronjob ] && [ "$val" != true ]; then
      kubectl -n "$ns" patch cronjob "$name" --type merge -p '{"spec":{"suspend":false}}' >/dev/null 2>&1 || true
    elif [ "$kind" = deploy ] && kubectl -n "$ns" get deploy "$name" >/dev/null 2>&1; then
      kubectl -n "$ns" scale "deploy/$name" --replicas="${val:-1}"
    fi
  done < "$STATE"
  mv "$STATE" "$STATE.done-$(date +%Y%m%d-%H%M)"
  echo "Unfrozen; CronJobs: $(kubectl -n jeffi get cronjob -o jsonpath='{range .items[*]}{.spec.suspend}{"\n"}{end}' | sort | uniq -c | tr '\n' ' ')"
  ;;
esac
