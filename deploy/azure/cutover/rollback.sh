#!/bin/bash
# Reverses cutover.sh, from the files it saved in ~/Documents/db-backups/cutover-<date>/ (export CUTOVER_DATE=<that date>).
# Steps, in order: azure-quiesce dns cloudfront identity unfreeze. Dry run by default; --apply acts; --step <name>, --from <name>, --list.
#   azure-quiesce  Azure pods to 0 so their CronJobs and workers stop writing to the Azure DB
#   dns            the route53 batch saved before the switch (route53-rollback.json)
#   cloudfront     each distribution's saved before-config (cloudfront-before-<id>.json)
#   identity       nothing to do: the RDS row was never changed (it still has fdrl_015c1KmN69fVRfNYSuA5pZMF);
#                  only the manual console rename needs undoing (README)
#   unfreeze       freeze.sh off on the AWS cluster
# Anything written on Azure after the switch is NOT carried back; the RDS is as it was at the freeze.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
STEPS=(azure-quiesce dns cloudfront identity unfreeze)
ZONE=${HOSTED_ZONE_ID:-Z08094881XKVZ9XSGBKG1}

step_azure_quiesce() {
  if ! $APPLY; then echo "(dry run) would run freeze.sh on against $AZ_KUBECONFIG (state $RUN_DIR/azure-rollback-freeze.txt)"; return 0; fi
  confirm_typed quiesce "scale the Azure platform pods to 0"
  if [ -s "$RUN_DIR/azure-rollback-freeze.txt" ]; then echo "   already quiesced"; return 0; fi
  KUBECONFIG=$AZ_KUBECONFIG FREEZE_STATE=$RUN_DIR/azure-rollback-freeze.txt bash "$BOOT/freeze.sh" on
}

step_dns() {
  local f=$RUN_DIR/route53-rollback.json
  [ -s "$f" ] || die "no $f: cutover.sh never applied DNS in this window (CUTOVER_DATE=$DATE)"
  python3 -I -c 'import json,sys; c=json.load(open(sys.argv[1]))["Changes"]
for x in c: r=x["ResourceRecordSet"]; print("   %-7s %-36s %s %s" % (x["Action"], r["Name"], r["Type"], ", ".join(v["Value"] for v in r.get("ResourceRecords", [])) or "alias"))' "$f"
  $APPLY || { echo "(dry run) --apply would submit it"; return 0; }
  confirm_typed dns "restore the Route 53 records from $f"
  local id; id=$(aws route53 change-resource-record-sets --hosted-zone-id "$ZONE" --change-batch "file://$f" --query ChangeInfo.Id --output text)
  aws route53 wait resource-record-sets-changed --id "$id"
  echo "   applied ($id). Records were at TTL 60, so resolvers follow within a minute or two."
}

step_cloudfront() {
  local f id n=0 etag
  for f in "$RUN_DIR"/cloudfront-before-*.json; do
    [ -s "$f" ] || continue
    n=$((n + 1)); id=$(basename "$f" .json); id=${id#cloudfront-before-}
    python3 -I -c 'import json,sys; c=json.load(open(sys.argv[1]))["DistributionConfig"]
for o in c["Origins"]["Items"]: print("   restore origin %s -> %s" % (o["Id"], o["DomainName"]))' "$f"
    $APPLY || continue
    confirm_typed cloudfront "restore the saved config of distribution $id"
    etag=$(aws cloudfront get-distribution-config --id "$id" --query ETag --output text)
    python3 -I -c 'import json,sys; json.dump(json.load(open(sys.argv[1]))["DistributionConfig"], open(sys.argv[2], "w"))' "$f" "$SCRATCH/restore-$id.json"
    aws cloudfront update-distribution --id "$id" --if-match "$etag" --distribution-config "file://$SCRATCH/restore-$id.json" --query Distribution.Status --output text >/dev/null
    echo "   $id restored; waiting for Deployed"
    aws cloudfront wait distribution-deployed --id "$id"
  done
  [ $n != 0 ] || die "no cloudfront-before-*.json in $RUN_DIR (the cloudfront step never applied, or CUTOVER_DATE is wrong)"
  $APPLY || echo "(dry run) --apply would restore the config(s) above"
}

step_identity() {
  echo "   Nothing to run: the RDS is the rollback target and its platform row was never changed."
  echo "   Manual: if the Anthropic rule was renamed or the Razer rule archived, reverse that in the console (README)."
}

step_unfreeze() {
  [ -s "$AWS_FREEZE_STATE" ] || die "no $AWS_FREEZE_STATE: the AWS cluster is not frozen by this tooling"
  if ! $APPLY; then echo "(dry run) would run freeze.sh off against $AWS_KUBECONFIG ($(wc -l < "$AWS_FREEZE_STATE" | tr -d ' ') recorded workloads)"; return 0; fi
  confirm_typed unfreeze "resume the AWS platform and stores (DNS and CloudFront must already point back at AWS)"
  aws_tunnel
  freeze_aws off
  echo "   Smoke it: JEFFI_CLOUD=aws bash $BOOT/smoke.sh <sha>"
}

main "$@"
