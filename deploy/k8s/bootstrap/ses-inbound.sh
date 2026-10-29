#!/bin/bash
# SES receiving for customer replies: mail to *@reply.jeffistores.in is stored in S3 (30 days) and
# announced over SNS to POST /api/webhooks/ses-inbound, which files it into the customer's support
# chat and the record it answers. Shows the current setup; --apply creates or updates:
#   S3 bucket + lifecycle + SES write policy, SNS topic + HTTPS subscription, receipt rule (in the
#   active rule set, or a new one made active), read access for the node role, MX record.
# Usage: bash deploy/k8s/bootstrap/ses-inbound.sh [--apply]
set -euo pipefail
DOMAIN=${DOMAIN:-jeffistores.in}
SUB=${REPLY_MAIL_DOMAIN:-reply.$DOMAIN}
REGION=${SES_INBOUND_REGION:-us-east-1}
ENDPOINT=${ENDPOINT:-https://$DOMAIN/api/webhooks/ses-inbound}
ROLE=${NODE_ROLE:-jeffi-stores-ec2-role}
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET=${BUCKET:-jeffi-mail-inbound-$ACCOUNT}
TOPIC=jeffi-ses-inbound
RULE_SET=jeffi-inbound
RULE=customer-replies
ZONE=$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" --query 'HostedZones[0].Id' --output text | sed 's#/hostedzone/##')

echo "Receiving domain: $SUB  (region $REGION, account $ACCOUNT)"
echo "Bucket:   $BUCKET $(aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null && echo '(exists)' || echo '(missing)')"
ACTIVE=$(aws ses describe-active-receipt-rule-set --region "$REGION" --query Metadata.Name --output text 2>/dev/null || true)
[ "$ACTIVE" = "None" ] && ACTIVE=
echo "Active receipt rule set: ${ACTIVE:-none}"
echo "MX now:   $(aws route53 list-resource-record-sets --hosted-zone-id "$ZONE" --query "ResourceRecordSets[?Name=='$SUB.' && Type=='MX'].ResourceRecords[].Value" --output text)"
echo "Webhook:  $ENDPOINT"

if [ "${1:-}" != "--apply" ]; then
  echo
  echo "Dry run. Re-run with --apply to create the bucket, topic, receipt rule, node-role read access and"
  echo "  MX $SUB -> 10 inbound-smtp.$REGION.amazonaws.com"
  exit 0
fi

if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  if [ "$REGION" = us-east-1 ]; then aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
  else aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null; fi
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{"Rules":[{"ID":"expire-30d","Status":"Enabled","Filter":{"Prefix":"inbound/"},"Expiration":{"Days":30}}]}'
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "$(cat <<JSON
{"Version":"2012-10-17","Statement":[{"Sid":"SesPut","Effect":"Allow","Principal":{"Service":"ses.amazonaws.com"},
 "Action":"s3:PutObject","Resource":"arn:aws:s3:::$BUCKET/inbound/*",
 "Condition":{"StringEquals":{"aws:SourceAccount":"$ACCOUNT"}}}]}
JSON
)"

TOPIC_ARN=$(aws sns create-topic --name "$TOPIC" --region "$REGION" --query TopicArn --output text)
aws sns set-topic-attributes --region "$REGION" --topic-arn "$TOPIC_ARN" --attribute-name Policy --attribute-value "$(cat <<JSON
{"Version":"2012-10-17","Statement":[{"Sid":"SesPublish","Effect":"Allow","Principal":{"Service":"ses.amazonaws.com"},
 "Action":"sns:Publish","Resource":"$TOPIC_ARN","Condition":{"StringEquals":{"aws:SourceAccount":"$ACCOUNT"}}}]}
JSON
)"
if ! aws sns list-subscriptions-by-topic --region "$REGION" --topic-arn "$TOPIC_ARN" --query "Subscriptions[?Endpoint=='$ENDPOINT']" --output text | grep -q .; then
  aws sns subscribe --region "$REGION" --topic-arn "$TOPIC_ARN" --protocol https --notification-endpoint "$ENDPOINT" >/dev/null
  echo "Subscribed $ENDPOINT (the webhook confirms it on the first request)"
fi

SET=${ACTIVE:-$RULE_SET}
if [ -z "$ACTIVE" ]; then
  aws ses describe-receipt-rule-set --region "$REGION" --rule-set-name "$SET" >/dev/null 2>&1 || aws ses create-receipt-rule-set --region "$REGION" --rule-set-name "$SET"
  aws ses set-active-receipt-rule-set --region "$REGION" --rule-set-name "$SET"
fi
RULE_JSON=$(cat <<JSON
{"Name":"$RULE","Enabled":true,"TlsPolicy":"Optional","ScanEnabled":true,"Recipients":["$SUB"],
 "Actions":[{"S3Action":{"BucketName":"$BUCKET","ObjectKeyPrefix":"inbound/","TopicArn":"$TOPIC_ARN"}}]}
JSON
)
if aws ses describe-receipt-rule --region "$REGION" --rule-set-name "$SET" --rule-name "$RULE" >/dev/null 2>&1; then
  aws ses update-receipt-rule --region "$REGION" --rule-set-name "$SET" --rule "$RULE_JSON"
else
  aws ses create-receipt-rule --region "$REGION" --rule-set-name "$SET" --rule "$RULE_JSON"
fi

aws iam put-role-policy --role-name "$ROLE" --policy-name JeffiMailInboundRead --policy-document "$(cat <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"s3:GetObject","Resource":"arn:aws:s3:::$BUCKET/inbound/*"}]}
JSON
)"

aws route53 change-resource-record-sets --hosted-zone-id "$ZONE" --change-batch "$(cat <<JSON
{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"$SUB.","Type":"MX","TTL":300,
 "ResourceRecords":[{"Value":"10 inbound-smtp.$REGION.amazonaws.com"}]}}]}
JSON
)" >/dev/null

echo "Done. Rule '$RULE' in set '$SET' -> s3://$BUCKET/inbound/ -> $TOPIC_ARN -> $ENDPOINT"
echo "Set REPLY_MAIL_DOMAIN=$SUB on the controller only if it differs from reply.\$PLATFORM_DOMAIN."
