#!/bin/bash
# Idempotent EBS Data Lifecycle Manager (DLM) policy that snapshots every store's database volume
# (tag jeffi:role=db, set only on the data volume the provisioner creates) once a day and keeps 7.
# Pairs with the node_db_backup cron (daily logical dump to S3 tenant-backups/by-slug/{slug}/daily/):
# snapshots are the fast rollback, the S3 dumps the copy off the volume.
# Run once, by hand (not by a release).
# Usage: bash deploy/k8s/bootstrap/tenant-db-snapshots.sh [--dry-run]
set -euo pipefail
DRY=${1:-}
REGION=${REGION:-us-east-1}
ROLE_NAME=jeffi-dlm-tenant-db
POLICY_DESC='Jeffi: daily snapshots of tenant Postgres EBS volumes (jeffi:role=db)'

# 1. Service role DLM assumes (AWS owns the managed policy for its default permissions).
ASSUME='{
  "Version": "2012-10-17",
  "Statement": [{ "Effect": "Allow", "Principal": { "Service": "dlm.amazonaws.com" }, "Action": "sts:AssumeRole" }]
}'
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "+ create role $ROLE_NAME"
  [ "$DRY" = '--dry-run' ] || aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document "$ASSUME" >/dev/null
fi
[ "$DRY" = '--dry-run' ] || aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole >/dev/null

ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null || echo "arn:aws:iam::<acct>:role/$ROLE_NAME")

# 2. DLM policy. Lookup by Description so the second run patches in place.
POLICY_JSON=$(cat <<JSON
{
  "ResourceTypes": ["VOLUME"],
  "TargetTags": [{ "Key": "jeffi:role", "Value": "db" }],
  "Schedules": [{
    "Name": "DailyKeep7",
    "CopyTags": true,
    "TagsToAdd": [{ "Key": "jeffi:snapshot", "Value": "daily" }],
    "CreateRule": { "Interval": 24, "IntervalUnit": "HOURS", "Times": ["03:00"] },
    "RetainRule": { "Count": 7 }
  }]
}
JSON
)

EXISTING=$(aws dlm get-lifecycle-policies --region "$REGION" \
  --query "Policies[?Description=='$POLICY_DESC'].PolicyId | [0]" --output text 2>/dev/null || echo None)

if [ "$EXISTING" = 'None' ] || [ -z "$EXISTING" ]; then
  echo "+ create DLM policy"
  [ "$DRY" = '--dry-run' ] || aws dlm create-lifecycle-policy --region "$REGION" \
    --execution-role-arn "$ROLE_ARN" \
    --description "$POLICY_DESC" \
    --state ENABLED \
    --policy-details "$POLICY_JSON" >/dev/null
else
  echo "~ update DLM policy $EXISTING"
  [ "$DRY" = '--dry-run' ] || aws dlm update-lifecycle-policy --region "$REGION" \
    --policy-id "$EXISTING" \
    --state ENABLED \
    --policy-details "$POLICY_JSON" >/dev/null
fi
echo "done. Snapshots run at 03:00 UTC daily, retain 7."
