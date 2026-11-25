#!/bin/bash
# Deploy main.bicep at subscription scope. Without --apply: preflight (subscription, providers, Epsv6 quota, SKU
# restrictions) and `what-if` only, nothing created. --core adds the k3s core VM (second pass, after kv-sync.sh).
# The Postgres admin password is generated on the first pass and read back from Key Vault afterwards; it goes
# through a 0600 parameters file, never argv or the terminal.
# Usage: bash deploy/azure/apply.sh [--core] [--apply]
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
SUBSCRIPTION=${AZ_SUBSCRIPTION:-Azure subscription 1}
LOCATION=${AZ_LOCATION:-centralindia}
KV=${AZ_KEY_VAULT:-jeffi-prod-kv}
RG=${AZ_RG:-jeffi-prod-cin}
SIZE=${AZ_CORE_SIZE:-Standard_E4ps_v6}
SSH_PUB=${SSH_PUBLIC_KEY_FILE:-$HOME/.ssh/id_ed25519.pub}
CORE=false APPLY=false
for a in "$@"; do case $a in --core) CORE=true ;; --apply) APPLY=true ;; *) echo "unknown argument $a" >&2; exit 2 ;; esac; done

say() { printf '\n== %s\n' "$*"; }
az account set --subscription "$SUBSCRIPTION"
say "Subscription: $(az account show --query '{name:name,id:id,user:user.name}' -o tsv)"

say "Resource providers"
for p in Microsoft.Compute Microsoft.Network Microsoft.DBforPostgreSQL Microsoft.KeyVault Microsoft.ManagedIdentity Microsoft.Storage; do
  st=$(az provider show -n "$p" --query registrationState -o tsv 2>/dev/null || echo NotRegistered)
  echo "  $p: $st"
  if [ "$st" != Registered ] && $APPLY; then az provider register -n "$p" --wait; fi
done

say "Quota and SKU in $LOCATION"
az vm list-usage --location "$LOCATION" \
  --query "[?contains(name.value, 'EPSv6') || name.value=='cores'].{family:name.value,used:currentValue,limit:limit}" -o table
restr=$(az vm list-skus --location "$LOCATION" --size "$SIZE" --resource-type virtualMachines --query '[0].restrictions' -o tsv)
[ -z "$restr" ] && echo "  $SIZE: available" || echo "  $SIZE restricted: $restr (request access or pick another size)"

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT; chmod 700 "$tmp"
pw=$(az keyvault secret show --vault-name "$KV" --name pg-admin-password --query value -o tsv 2>/dev/null || true)
if [ -z "$pw" ]; then
  echo "pg-admin-password not in $KV yet: a new one is generated (stored in the vault by this deployment)"
  pw=$(openssl rand -base64 36 | tr -d '/+=\n' | cut -c1-32)
fi
ssh_key=
if $CORE; then
  [ -s "$SSH_PUB" ] || { echo "--core needs an SSH public key (SSH_PUBLIC_KEY_FILE, default $SSH_PUB)" >&2; exit 1; }
  ssh_key=$(cat "$SSH_PUB")
fi
operator=$(az ad signed-in-user show --query id -o tsv 2>/dev/null || true)
PW="$pw" SSH_KEY="$ssh_key" OPERATOR="$operator" CORE=$CORE python3 -I -c '
import json, os
p = {"pgAdminPassword": os.environ["PW"], "deployCore": os.environ["CORE"] == "true",
     "sshPublicKey": os.environ["SSH_KEY"], "operatorPrincipalId": os.environ["OPERATOR"]}
print(json.dumps({"$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  "contentVersion": "1.0.0.0", "parameters": {k: {"value": v} for k, v in p.items()}}))' > "$tmp/params.json"
unset pw

args=(--location "$LOCATION" --template-file "$DIR/main.bicep" --parameters "@$tmp/params.json")
say "What-if (deployCore=$CORE)"
az deployment sub what-if --name "jeffi-landing-zone" "${args[@]}"
if ! $APPLY; then echo "Dry run: nothing created. Re-run with --apply to deploy."; exit 0; fi
read -r -p "Deploy the changes above to $RG? Type yes to continue: " ok
[ "$ok" = yes ] || { echo "Stopped."; exit 1; }
az deployment sub create --name "jeffi-landing-zone-$(date +%Y%m%d-%H%M)" "${args[@]}" \
  --query 'properties.outputs' -o json
