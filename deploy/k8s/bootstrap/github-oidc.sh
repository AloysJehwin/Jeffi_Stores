#!/bin/bash
# One-time: let this repo's GitHub Actions assume IAM roles over OIDC (no long-lived keys), each with only what
# its ci.yml job needs:
#   jeffi-github-build   any branch's images job: push the four images to ECR, read jeffi/production for the
#                        NEXT_PUBLIC_* build args. It cannot reach the cluster or the database.
#   jeffi-github-deploy  only a job in the approved `production` environment: read jeffi/production (the RDS
#                        master password for 05-table-owner.sh), SSM tunnels to the core and through it to RDS,
#                        log in to RDS as app_user (schema diff, migrations), invalidate CloudFront.
# Idempotent; --dry-run prints the policies. Then set the secrets it prints.
# Usage: bash deploy/k8s/bootstrap/github-oidc.sh [--dry-run]
source "$(dirname "$0")/../db/lib.sh"
GH_REPO=${GH_REPO:-AloysJehwin/Jeffi_Stores}
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
PROVIDER=arn:aws:iam::$ACCOUNT:oidc-provider/token.actions.githubusercontent.com
CORE_ID=$(aws ec2 describe-addresses --public-ips "$CORE_IP" --query 'Addresses[0].InstanceId' --output text)
DB_RESOURCE=$(aws rds describe-db-instances --db-instance-identifier "$RDS_INSTANCE" --query 'DBInstances[0].DbiResourceId' --output text)

trust() { # <subject suffix>, e.g. environment:production
  cat <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Federated":"$PROVIDER"},
 "Action":"sts:AssumeRoleWithWebIdentity",
 "Condition":{"StringEquals":{"token.actions.githubusercontent.com:aud":"sts.amazonaws.com"},
  "StringLike":{"token.actions.githubusercontent.com:sub":"repo:$GH_REPO:$1"}}}]}
JSON
}
repos() { for r in controller messaging document public-api; do printf '"arn:aws:ecr:%s:%s:repository/jeffi-stores-%s-service",' "$AWS_REGION" "$ACCOUNT" "$r"; done; }
SECRET="{\"Sid\":\"ReadProductionSecret\",\"Effect\":\"Allow\",\"Action\":\"secretsmanager:GetSecretValue\",\"Resource\":\"arn:aws:secretsmanager:$AWS_REGION:$ACCOUNT:secret:jeffi/production*\"}"

BUILD_TRUST=$(trust "ref:refs/heads/*")
BUILD_POLICY=$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 {"Sid":"EcrLogin","Effect":"Allow","Action":"ecr:GetAuthorizationToken","Resource":"*"},
 {"Sid":"EcrPush","Effect":"Allow","Action":["ecr:DescribeRepositories","ecr:CreateRepository","ecr:DescribeImages","ecr:BatchGetImage",
   "ecr:BatchCheckLayerAvailability","ecr:InitiateLayerUpload","ecr:UploadLayerPart","ecr:CompleteLayerUpload","ecr:PutImage"],
  "Resource":[$(repos)"arn:aws:ecr:$AWS_REGION:$ACCOUNT:repository/jeffi-stores-*"]},
 $SECRET
]}
JSON
)
DEPLOY_TRUST=$(trust "environment:production")
DEPLOY_POLICY=$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 $SECRET,
 {"Sid":"FindCore","Effect":"Allow","Action":"ec2:DescribeAddresses","Resource":"*"},
 {"Sid":"DbLogin","Effect":"Allow","Action":"rds-db:connect","Resource":"arn:aws:rds-db:$AWS_REGION:$ACCOUNT:dbuser:$DB_RESOURCE/app_user"},
 {"Sid":"TunnelToCore","Effect":"Allow","Action":"ssm:StartSession",
  "Resource":["arn:aws:ec2:$AWS_REGION:$ACCOUNT:instance/$CORE_ID","arn:aws:ssm:$AWS_REGION::document/AWS-StartPortForwardingSession",
   "arn:aws:ssm:$AWS_REGION::document/AWS-StartPortForwardingSessionToRemoteHost"]},
 {"Sid":"OwnSessions","Effect":"Allow","Action":["ssm:TerminateSession","ssm:ResumeSession"],"Resource":"arn:aws:ssm:*:*:session/\${aws:userid}-*"},
 {"Sid":"Cdn","Effect":"Allow","Action":["cloudfront:CreateInvalidation","cloudfront:GetInvalidation"],"Resource":"arn:aws:cloudfront::$ACCOUNT:distribution/*"}
]}
JSON
)

say "GitHub OIDC roles in account $ACCOUNT (core $CORE_ID, database $DB_RESOURCE)"
if $DRY_RUN; then
  for r in BUILD DEPLOY; do t=${r}_TRUST p=${r}_POLICY; echo "$r trust policy:"; echo "${!t}"; echo "$r permissions:"; echo "${!p}"; done
  exit 0
fi
aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER" >/dev/null 2>&1 ||
  aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 1c58a3a8518e8759bf075b76b750d4f2df264fcd >/dev/null
role() { # <name> <trust> <policy>; prints the ARN
  if aws iam get-role --role-name "$1" >/dev/null 2>&1; then
    aws iam update-assume-role-policy --role-name "$1" --policy-document "$2"
  else
    aws iam create-role --role-name "$1" --assume-role-policy-document "$2" --max-session-duration 7200 \
      --description "GitHub Actions ($GH_REPO ci.yml)" >/dev/null
  fi
  aws iam put-role-policy --role-name "$1" --policy-name JeffiRelease --policy-document "$3"
  aws iam get-role --role-name "$1" --query Role.Arn --output text
}
BUILD_ARN=$(role jeffi-github-build "$BUILD_TRUST" "$BUILD_POLICY")
DEPLOY_ARN=$(role jeffi-github-deploy "$DEPLOY_TRUST" "$DEPLOY_POLICY")
echo "build role:  $BUILD_ARN"
echo "deploy role: $DEPLOY_ARN"
echo "next: gh secret set AWS_BUILD_ROLE_ARN --body '$BUILD_ARN'"
echo "      gh secret set AWS_ROLE_ARN --body '$DEPLOY_ARN'"
echo "      base64 < ~/.kube/jeffi-k3s.yaml | gh secret set KUBECONFIG_B64"
