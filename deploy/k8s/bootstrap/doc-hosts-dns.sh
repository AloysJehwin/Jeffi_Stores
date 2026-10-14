#!/bin/bash
# Point invoice., quotation. and purchaseorder.jeffistores.in at the cluster (Traefik routes them to
# jeffi-stores-document-service). Shows the current records; --apply replaces them with an A record and
# writes a rollback change batch. Usage: bash deploy/k8s/bootstrap/doc-hosts-dns.sh [--apply]
set -euo pipefail
DOMAIN=jeffistores.in
IP=${CLUSTER_IP:-32.196.38.130}
OUT=${OUT_DIR:-$HOME/Documents/db-backups/dns-$(date +%Y%m%d-%H%M)}
ZONE=$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" --query 'HostedZones[0].Id' --output text | sed 's#/hostedzone/##')
mkdir -p "$OUT"
for h in invoice quotation purchaseorder; do
  aws route53 list-resource-record-sets --hosted-zone-id "$ZONE" --query "ResourceRecordSets[?Name=='$h.$DOMAIN.']" --output json
done | python3 -I -c '
import json, sys
dec = json.JSONDecoder(); s = sys.stdin.read(); i = 0; sets = []
while i < len(s):
    if s[i].isspace(): i += 1; continue
    v, i = dec.raw_decode(s, i); sets += v
json.dump(sets, open(sys.argv[1], "w"), indent=1)
for r in sets:
    print("  now:", r["Name"], r["Type"], r.get("AliasTarget", {}).get("DNSName") or [x["Value"] for x in r.get("ResourceRecords", [])])
' "$OUT/before.json"

python3 -I - "$OUT" "$IP" "$DOMAIN" <<'PY'
import json, sys
out, ip, domain = sys.argv[1:]
before = json.load(open(f'{out}/before.json'))
new = [{'Name': f'{h}.{domain}.', 'Type': 'A', 'TTL': 300, 'ResourceRecords': [{'Value': ip}]} for h in ('invoice', 'quotation', 'purchaseorder')]
batch = lambda dels, adds: {'Changes': [{'Action': 'DELETE', 'ResourceRecordSet': r} for r in dels] + [{'Action': 'CREATE', 'ResourceRecordSet': r} for r in adds]}
json.dump(batch(before, new), open(f'{out}/apply.json', 'w'), indent=1)
json.dump(batch(new, before), open(f'{out}/rollback.json', 'w'), indent=1)
PY
echo "  planned: A $IP for invoice., quotation., purchaseorder.$DOMAIN"
if [ "${1:-}" != --apply ]; then echo "Dry run. Apply with --apply."; exit 0; fi
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE" --change-batch "file://$OUT/apply.json" --query ChangeInfo.Status --output text
echo "Rollback: aws route53 change-resource-record-sets --hosted-zone-id $ZONE --change-batch file://$OUT/rollback.json"
