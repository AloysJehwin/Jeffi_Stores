#!/bin/bash
# mobile.jeffistores.in behind its own CloudFront distribution (no caching), so the app's TLS handshake ends at the
# nearest edge instead of crossing to us-east-1. The origin is the core node the website distribution uses.
#
#   stage     EDGE_ORIGIN_SECRET in jeffi/mobile/production (kept if present) + the distribution, which sends it as
#             X-Jeffi-Edge so mobile-service trusts CloudFront-Viewer-Address. Inert: DNS is unchanged.
#   switch    mobile.jeffistores.in → the distribution (CNAME, overrides the *.jeffistores.in wildcard). Run only
#             after a release with the mobile-service viewer-IP change is live, or rate limits key on edge IPs.
#   rollback  delete that CNAME: the wildcard points the host straight at the core again.
#
# Usage: bash deploy/k8s/bootstrap/mobile-cloudfront.sh stage|switch|rollback [--dry-run]
# After a core cutover (new origin), re-run `stage` to repoint the distribution's origin.
set -euo pipefail
CMD=${1:-}; DRY=${2:-}
HOST=mobile.jeffistores.in
SITE_DIST=E1M6ZFCWXAMF26
SECRET_ID=jeffi/mobile/production
CACHING_DISABLED=4135ea2d-6df8-44a3-9df3-4b5a84be39ad
ALL_VIEWER_AND_CF_HEADERS=33f36d7e-f396-46d9-90e0-52428a34d9dc
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT; chmod 700 "$TMP"

dist_id() {
  aws cloudfront list-distributions --output json \
    | python3 -I -c 'import json,sys; h=sys.argv[1]; d=json.load(sys.stdin)["DistributionList"].get("Items") or []
print(next((x["Id"] for x in d if h in ((x.get("Aliases") or {}).get("Items") or [])), ""))' "$HOST"
}
zone_id() { aws route53 list-hosted-zones-by-name --dns-name jeffistores.in --query 'HostedZones[0].Id' --output text | sed 's|/hostedzone/||'; }

case "$CMD" in
stage)
  aws cloudfront get-distribution-config --id $SITE_DIST --output json > "$TMP/site.json"
  ORIGIN=$(python3 -I -c 'import json,sys; c=json.load(open(sys.argv[1]))["DistributionConfig"]
print(next(o["DomainName"] for o in c["Origins"]["Items"] if "CustomOriginConfig" in o))' "$TMP/site.json")
  CERT=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["DistributionConfig"]["ViewerCertificate"]["ACMCertificateArn"])' "$TMP/site.json")
  ID=$(dist_id)
  echo "origin $ORIGIN · cert ${CERT##*/} · existing distribution: ${ID:-none}"
  if [ "$DRY" = --dry-run ]; then echo "(dry run) would ensure EDGE_ORIGIN_SECRET in $SECRET_ID and create or repoint the distribution for $HOST"; exit 0; fi

  # The secret: reuse the stored one so a re-run never breaks a live distribution.
  aws secretsmanager get-secret-value --secret-id $SECRET_ID --query SecretString --output text > "$TMP/secret.json"
  python3 -I -c 'import json,sys,secrets; p=sys.argv[1]; d=json.load(open(p)); new="EDGE_ORIGIN_SECRET" not in d
d.setdefault("EDGE_ORIGIN_SECRET", secrets.token_hex(32)); json.dump(d, open(p,"w")); print("new" if new else "kept")' "$TMP/secret.json" > "$TMP/state"
  if [ "$(cat "$TMP/state")" = new ]; then
    aws secretsmanager put-secret-value --secret-id $SECRET_ID --secret-string "file://$TMP/secret.json" --query VersionId --output text >/dev/null
    echo "EDGE_ORIGIN_SECRET added to $SECRET_ID (pods read it on their next start)"
  else
    echo "EDGE_ORIGIN_SECRET already in $SECRET_ID"
  fi

  python3 -I - "$TMP" "$HOST" "$ORIGIN" "$CERT" "$CACHING_DISABLED" "$ALL_VIEWER_AND_CF_HEADERS" <<'PY'
import json, sys, time
tmp, host, origin, cert, cache, orp = sys.argv[1:]
secret = json.load(open(f"{tmp}/secret.json"))["EDGE_ORIGIN_SECRET"]
cfg = {
  "CallerReference": f"mobile-api-{int(time.time())}",
  "Aliases": {"Quantity": 1, "Items": [host]},
  "Comment": f"{host} API (no cache)",
  "Enabled": True, "PriceClass": "PriceClass_200", "HttpVersion": "http2and3", "IsIPV6Enabled": True,
  "Origins": {"Quantity": 1, "Items": [{
    "Id": "jeffi-core", "DomainName": origin, "OriginPath": "",
    "CustomHeaders": {"Quantity": 1, "Items": [{"HeaderName": "X-Jeffi-Edge", "HeaderValue": secret}]},
    "CustomOriginConfig": {"HTTPPort": 80, "HTTPSPort": 443, "OriginProtocolPolicy": "https-only",
      "OriginSslProtocols": {"Quantity": 1, "Items": ["TLSv1.2"]}, "OriginReadTimeout": 60, "OriginKeepaliveTimeout": 60},
  }]},
  "DefaultCacheBehavior": {
    "TargetOriginId": "jeffi-core", "ViewerProtocolPolicy": "redirect-to-https", "Compress": True,
    "AllowedMethods": {"Quantity": 7, "Items": ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
      "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]}},
    "CachePolicyId": cache, "OriginRequestPolicyId": orp,
  },
  "ViewerCertificate": {"ACMCertificateArn": cert, "SSLSupportMethod": "sni-only", "MinimumProtocolVersion": "TLSv1.2_2021"},
}
json.dump(cfg, open(f"{tmp}/new.json", "w"))
PY

  if [ -z "$ID" ]; then
    aws cloudfront create-distribution --distribution-config "file://$TMP/new.json" --query 'Distribution.{id:Id,domain:DomainName,status:Status}' --output table
  else
    # Repoint origin and secret on the existing one; everything else stays as created.
    aws cloudfront get-distribution-config --id "$ID" --output json > "$TMP/cur.json"
    python3 -I -c 'import json,sys; cur=json.load(open(sys.argv[1])); new=json.load(open(sys.argv[2]))
c=cur["DistributionConfig"]; c["Origins"]=new["Origins"]; json.dump(c, open(sys.argv[3],"w")); print(cur["ETag"])' "$TMP/cur.json" "$TMP/new.json" "$TMP/upd.json" > "$TMP/etag"
    aws cloudfront update-distribution --id "$ID" --if-match "$(cat "$TMP/etag")" --distribution-config "file://$TMP/upd.json" --query 'Distribution.{id:Id,domain:DomainName,status:Status}' --output table
  fi
  echo "Wait for Status=Deployed (aws cloudfront get-distribution --id <id> --query Distribution.Status), then test:"
  echo "  curl -s --connect-to $HOST:443:<domain>:443 https://$HOST/healthz"
  ;;
switch|rollback)
  ID=$(dist_id); [ -n "$ID" ] || { echo "no distribution for $HOST: run stage first"; exit 1; }
  DOMAIN=$(aws cloudfront get-distribution --id "$ID" --query Distribution.DomainName --output text)
  ACTION=$([ "$CMD" = switch ] && echo UPSERT || echo DELETE)
  if [ "$CMD" = rollback ] && ! aws route53 list-resource-record-sets --hosted-zone-id "$(zone_id)" --query "ResourceRecordSets[?Name=='$HOST.' && Type=='CNAME']" --output text | grep -q .; then
    echo "no CNAME for $HOST: already on the wildcard"; exit 0
  fi
  echo "$ACTION CNAME $HOST → $DOMAIN"
  [ "$DRY" = --dry-run ] && { echo "(dry run)"; exit 0; }
  printf '{"Changes":[{"Action":"%s","ResourceRecordSet":{"Name":"%s","Type":"CNAME","TTL":300,"ResourceRecords":[{"Value":"%s"}]}}]}' \
    "$ACTION" "$HOST" "$DOMAIN" > "$TMP/dns.json"
  aws route53 change-resource-record-sets --hosted-zone-id "$(zone_id)" --change-batch "file://$TMP/dns.json" --query ChangeInfo.Status --output text
  ;;
*) echo "usage: $0 stage|switch|rollback [--dry-run]"; exit 2 ;;
esac
