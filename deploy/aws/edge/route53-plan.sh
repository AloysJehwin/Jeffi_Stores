#!/bin/bash
# DNS for the split (plan §6a, Phase E step 4): store hosts to the AWS tenant edge, flagship and platform hosts to the
# Azure core. Prints the current records and the change batch; --apply submits it and waits. Before anything changes
# the current records are saved as a ready-to-submit rollback batch (printed path). --lower-ttl (the day before the
# window) only re-sets the records it would touch to TTL 60, values unchanged.
#   *.jeffistores.in, *.business.jeffistores.in          -> EDGE_IP (stores, their admin-*/public-*/site-* hosts)
#   ecom admin business certificate invoice k8s purchaseorder quotation vault public mobile voice origin
#                                                        -> AZURE_IP (platform; `origin` is CloudFront's new origin)
#   jeffistores.in (CloudFront alias), www, forms         unchanged
# Stores' custom domains point at CLUSTER_INGRESS_IP (the edge) when their owners re-verify; the controller writes
# that from the provisioning ConfigMap.
# STORES_IP overrides where the store wildcards go: while every store is served by the platform's shared services
# (no store nodes of its own), they live on the Azure core, so STORES_IP=$AZURE_IP.
# Usage: EDGE_IP=<edge EIP> AZURE_IP=<core public IP> bash deploy/aws/edge/route53-plan.sh [--lower-ttl] [--apply]
set -euo pipefail
ZONE=${HOSTED_ZONE_ID:-Z08094881XKVZ9XSGBKG1}
DOMAIN=jeffistores.in
PLATFORM_HOSTS=${PLATFORM_HOSTS:-"ecom admin business certificate invoice k8s purchaseorder quotation vault public mobile voice origin"}
APPLY=false LOWER=false
for a in "$@"; do case $a in --apply) APPLY=true ;; --lower-ttl) LOWER=true ;; esac; done
$LOWER || { : "${EDGE_IP:?EDGE_IP=<edge Elastic IP>}"; : "${AZURE_IP:?AZURE_IP=<Azure core public IP>}"; }
OUT=${OUT_DIR:-$HOME/Documents/db-backups}; mkdir -p "$OUT"
STAMP=$(date +%Y%m%d-%H%M)

current=$(aws route53 list-resource-record-sets --hosted-zone-id "$ZONE" --output json)
batch=$(CURRENT="$current" EDGE_IP="${EDGE_IP:-}" AZURE_IP="${AZURE_IP:-}" STORES_IP="${STORES_IP:-}" LOWER=$LOWER HOSTS="$PLATFORM_HOSTS" DOMAIN=$DOMAIN \
  ROLLBACK="$OUT/route53-rollback-$STAMP.json" python3 -I - <<'PY'
import json, os
d = os.environ["DOMAIN"] + "."
recs = {(r["Name"].replace("\\052", "*"), r["Type"]): r for r in json.loads(os.environ["CURRENT"])["ResourceRecordSets"]}
stores = os.environ.get("STORES_IP") or os.environ["EDGE_IP"]
want = {f"*.{d}": stores, f"*.business.{d}": stores}
want.update({f"{h}.{d}": os.environ["AZURE_IP"] for h in os.environ["HOSTS"].split()})
changes, rollback = [], []
for name, ip in want.items():
    old = recs.get((name, "A")) or recs.get((name, "CNAME"))
    if old and "AliasTarget" in old:
        print(f"  {name:38} alias {old['AliasTarget']['DNSName']}: left alone")
        continue
    now = ", ".join(v["Value"] for v in old["ResourceRecords"]) if old else "(none)"
    if os.environ["LOWER"] == "true":
        if not old or old.get("TTL", 0) <= 60:
            continue
        new = dict(old, TTL=60)
        print(f"  {name:38} {old['Type']} {now}  TTL {old['TTL']} -> 60")
    else:
        new = {"Name": name, "Type": "A", "TTL": 60, "ResourceRecords": [{"Value": ip}]}
        print(f"  {name:38} {now:28} -> A {ip}")
        if old and old["Type"] != "A":  # a CNAME can't sit beside an A of the same name
            changes.append({"Action": "DELETE", "ResourceRecordSet": old})
    changes.append({"Action": "UPSERT", "ResourceRecordSet": new})
    if old:
        rollback.append({"Action": "UPSERT", "ResourceRecordSet": old})
        if old["Type"] != new["Type"]:
            rollback.insert(0, {"Action": "DELETE", "ResourceRecordSet": new})
    else:
        rollback.append({"Action": "DELETE", "ResourceRecordSet": new})
json.dump({"Comment": "rollback of route53-plan.sh", "Changes": rollback}, open(os.environ["ROLLBACK"], "w"), indent=1)
print(json.dumps({"Comment": "Azure move: stores to the AWS edge, platform to Azure", "Changes": changes}))
PY
)
plan=$(tail -1 <<<"$batch"); sed '$d' <<<"$batch"
n=$(python3 -I -c 'import json, sys; print(len(json.loads(sys.argv[1])["Changes"]))' "$plan")
echo "$n change(s). Rollback batch: $OUT/route53-rollback-$STAMP.json"
[ "$n" -gt 0 ] || exit 0
if ! $APPLY; then echo "Dry run: nothing changed (--apply)."; exit 0; fi
id=$(aws route53 change-resource-record-sets --hosted-zone-id "$ZONE" --change-batch "$plan" --query ChangeInfo.Id --output text)
aws route53 wait resource-record-sets-changed --id "$id"
echo "Applied ($id). Undo: aws route53 change-resource-record-sets --hosted-zone-id $ZONE --change-batch file://$OUT/route53-rollback-$STAMP.json"
