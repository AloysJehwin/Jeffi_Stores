#!/bin/bash
# One-time: let this repo's GitHub Actions assume an IAM role (OIDC, no long-lived keys) with only what ci.yml
# needs: push the four images to ECR, read NEXT_PUBLIC_* from jeffi/production, open the SSM tunnel to the
# core, invalidate CloudFront. Idempotent; --dry-run prints the policies. Then: gh secret set AWS_ROLE_ARN.
# Usage: bash deploy/k8s/bootstrap/github-oidc.sh [--dry-run]
source "$(dirname "$0")/../db/lib.sh"
GH_REPO=${GH_REPO:-AloysJehwin/Jeffi_Stores}
ROLE=${ROLE:-jeffi-github-deploy}
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
PROVIDER=arn:aws:iam::$ACCOUNT:oidc-provider/token.actions.githubusercontent.com
CORE_ID=$(aws ec2 describe-addresses --public-ips "$CORE_IP" --query 'Addresses[0].InstanceId' --output text)

TRUST=$(cat <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Federated":"$PROVIDER"},
 "Action":"sts:AssumeRoleWithWebIdentity",
 "Condition":{"StringEquals":{"token.actions.githubusercontent.com:aud":"sts.amazonaws.com"},
  "StringLike":{"token.actions.githubusercontent.com:sub":["repo:$GH_REPO:ref:refs/heads/*","repo:$GH_REPO:environment:production"]}}}]}
EOF
)
repos() { for r in controller messaging document public-api; do printf '"arn:aws:ecr:%s:%s:repository/jeffi-stores-%s-service",' "$AWS_REGION" "$ACCOUNT" "$r"; done; }
POLICY=$(cat <<EOF
{"Version":"2012-10-17","Statement":[
 {"Sid":"EcrLogin","Effect":"Allow","Action":"ecr:GetAuthorizationToken","Resource":"*"},
 {"Sid":"EcrPush","Effect":"Allow","Action":["ecr:DescribeRepositories","ecr:CreateRepository","ecr:DescribeImages","ecr:BatchGetImage",
   "ecr:BatchCheckLayerAvailability","ecr:InitiateLayerUpload","ecr:UploadLayerPart","ecr:CompleteLayerUpload","ecr:PutImage"],
  "Resource":[$(repos)"arn:aws:ecr:$AWS_REGION:$ACCOUNT:repository/jeffi-stores-*"]},
 {"Sid":"PublicBuildArgs","Effect":"Allow","Action":"secretsmanager:GetSecretValue","Resource":"arn:aws:secretsmanager:$AWS_REGION:$ACCOUNT:secret:jeffi/production*"},
 {"Sid":"FindCore","Effect":"Allow","Action":"ec2:DescribeAddresses","Resource":"*"},
 {"Sid":"TunnelToCore","Effect":"Allow","Action":"ssm:StartSession",
  "Resource":["arn:aws:ec2:$AWS_REGION:$ACCOUNT:instance/$CORE_ID","arn:aws:ssm:$AWS_REGION::document/AWS-StartPortForwardingSession",
   "arn:aws:ssm:$AWS_REGION::document/AWS-StartPortForwardingSessionToRemoteHost"]},
 {"Sid":"OwnSessions","Effect":"Allow","Action":["ssm:TerminateSession","ssm:ResumeSession"],"Resource":"arn:aws:ssm:*:*:session/\${aws:userid}-*"},
 {"Sid":"Cdn","Effect":"Allow","Action":["cloudfront:CreateInvalidation","cloudfront:GetInvalidation"],"Resource":"arn:aws:cloudfront::$ACCOUNT:distribution/*"}
]}
EOF
)

say "GitHub OIDC role $ROLE in account $ACCOUNT (core $CORE_ID)"
if $DRY_RUN; then echo "trust policy:"; echo "$TRUST"; echo "permissions:"; echo "$POLICY"; exit 0; fi
aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER" >/dev/null 2>&1 ||
  aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 1c58a3a8518e8759bf075b76b750d4f2df264fcd >/dev/null
if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$ROLE" --policy-document "$TRUST"
else
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document "$TRUST" --max-session-duration 7200 \
    --description "GitHub Actions release for $GH_REPO (ci.yml)" >/dev/null
fi
aws iam put-role-policy --role-name "$ROLE" --policy-name JeffiRelease --policy-document "$POLICY"
ARN=$(aws iam get-role --role-name "$ROLE" --query Role.Arn --output text)
echo "role: $ARN"
echo "next: gh secret set AWS_ROLE_ARN --body '$ARN'"
echo "      base64 < ~/.kube/jeffi-k3s.yaml | gh secret set KUBECONFIG_B64"
