#!/bin/bash
# Sets the repository settings CI needs to deploy to Azure, from the outputs of the resource-group deployment
# jeffi-foundation: secrets AZURE_CLIENT_ID (githubClientId), AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID and the variable
# AZURE_INGRESS_IP (the core's public IP; the foundation output is publicIpAddress, the subscription-level one ingressIp).
# Values go to `gh` on stdin, never argv. The repo is gh's: run inside the checkout or set GH_REPO=owner/name.
# AZURE_TARGET is the switch that turns the db-azure / deploy-prep-azure / release-azure jobs on: --enable-target sets it
# to true. Do that ONLY after the rehearsal (deploy/azure/README.md) has passed; until then CI stays on AWS.
# Dry run by default: prints the names and where each value comes from, no values. --apply sets them.
# Usage: bash deploy/azure/github-settings.sh [--apply] [--enable-target]
set -euo pipefail
RG=${AZ_RG:-jeffi-prod-cin}
DEPLOYMENT=${AZ_DEPLOYMENT:-jeffi-foundation}
SUBSCRIPTION=${AZ_SUBSCRIPTION:-Azure subscription 1}
APPLY=false TARGET=false
for a in "$@"; do case $a in --apply) APPLY=true ;; --enable-target) TARGET=true ;; *) echo "unknown argument $a" >&2; exit 2 ;; esac; done

az account set --subscription "$SUBSCRIPTION"
out=$(az deployment group show -g "$RG" -n "$DEPLOYMENT" --query properties.outputs -o json)
get() { # <output name>...: the first one that has a value
  OUT="$out" python3 -I -c '
import json, os, sys
o = json.loads(os.environ["OUT"])
for k in sys.argv[1:]:
    v = (o.get(k) or {}).get("value")
    if v:
        print(v, end="")
        break' "$@"
}
client=$(get githubClientId)
ingress=$(get ingressIp publicIpAddress)
tenant=$(az account show --query tenantId -o tsv)
sub=$(az account show --query id -o tsv)
[ -n "$client" ] || { echo "no githubClientId in the $DEPLOYMENT outputs" >&2; exit 1; }
[ -n "$ingress" ] || { echo "no ingressIp or publicIpAddress in the $DEPLOYMENT outputs" >&2; exit 1; }

sec() { # <name> <value> <source>
  if $APPLY; then printf %s "$2" | gh secret set "$1"; echo "secret   $1 set"; else echo "secret   $1 <- $3"; fi
}
var() {
  if $APPLY; then printf %s "$2" | gh variable set "$1"; echo "variable $1 set"; else echo "variable $1 <- $3"; fi
}
sec AZURE_CLIENT_ID "$client" "$DEPLOYMENT output githubClientId"
sec AZURE_TENANT_ID "$tenant" "az account show (tenantId)"
sec AZURE_SUBSCRIPTION_ID "$sub" "az account show (id)"
var AZURE_INGRESS_IP "$ingress" "$DEPLOYMENT output ingressIp or publicIpAddress"
if $TARGET; then
  var AZURE_TARGET true "--enable-target (the CI Azure jobs run from the next push)"
else
  echo "AZURE_TARGET not touched (--enable-target, only after the rehearsal)"
fi
if ! $APPLY; then echo "Dry run: nothing set. Re-run with --apply."; fi
