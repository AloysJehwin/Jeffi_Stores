#!/bin/bash
# Self-hosted IRSA, AWS side: the IAM OIDC provider for the k3s issuer and one role per service account, assumed
# with AssumeRoleWithWebIdentity from a projected token (audience sts.amazonaws.com). The pods get AWS_ROLE_ARN and
# AWS_WEB_IDENTITY_TOKEN_FILE from deploy/k8s/overlays/azure, and every SDK's default chain picks them up.
#   jeffi-irsa-app          jeffi:jeffi-app (storefront, admin, business, messaging, documents, public-api, mobile,
#                           showcase): S3, End User Messaging (policies/app.json)
#   jeffi-irsa-controller   jeffi:jeffi-stores-controller-service: the same, the fleet config, WhatsApp templates
#                           (policies/controller.json), domain purchase (deploy/aws/domain-purchase-iam-policy.json)
#                           and store provisioning on EC2/RDS, the managed policy jeffi-tenant-provisioning
#                           (= deploy/aws/tenant-provisioner-iam-policy.json)
#   jeffi-irsa-cert-manager cert-manager:cert-manager: Route 53 DNS-01 in the jeffistores.in zone
#   jeffi-irsa-ecr-pull     jeffi:ecr-refresh: the regcred pull secret
# Run after publish-oidc.sh (the provider fetches the discovery document). Dry run by default (prints the trust
# and permission policies); --apply creates or updates. Idempotent.
# Usage: bash deploy/azure/irsa/aws-roles.sh [--apply]
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
ISSUER=${OIDC_ISSUER:-https://oidc.jeffistores.in}
ZONE=${HOSTED_ZONE_ID:-Z08094881XKVZ9XSGBKG1}
export AWS_REGION=${AWS_REGION:-us-east-1}
APPLY=false; for a in "$@"; do [ "$a" = --apply ] && APPLY=true; done
HOST=${ISSUER#https://}
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
PROVIDER=arn:aws:iam::$ACCOUNT:oidc-provider/$HOST

trust() { # <namespace> <service account>
  cat <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Federated":"$PROVIDER"},
 "Action":"sts:AssumeRoleWithWebIdentity",
 "Condition":{"StringEquals":{"$HOST:aud":"sts.amazonaws.com","$HOST:sub":"system:serviceaccount:$1:$2"}}}]}
JSON
}
# policies/<name>.json, else the AWS-side file deploy/aws/<name>-iam-policy.json (one copy, shared with the IAM user).
policy() {
  local f=$DIR/policies/$1.json; [ -f "$f" ] || f=$DIR/../../aws/$1-iam-policy.json
  sed -e "s/__ACCOUNT__/$ACCOUNT/g" -e "s/__ZONE__/$ZONE/g" "$f"
}

# name | namespace | service account | inline policies | managed policies
ROLES=(
  "jeffi-irsa-app|jeffi|jeffi-app|app|"
  "jeffi-irsa-controller|jeffi|jeffi-stores-controller-service|app controller domain-purchase|jeffi-tenant-provisioning"
  "jeffi-irsa-cert-manager|cert-manager|cert-manager|cert-manager|"
  "jeffi-irsa-ecr-pull|jeffi|ecr-refresh|ecr-pull|"
)

echo "== IRSA in account $ACCOUNT, issuer $ISSUER"
curl -fsS "$ISSUER/.well-known/openid-configuration" >/dev/null || echo "warning: $ISSUER is not serving its discovery document yet (publish-oidc.sh --apply)" >&2
for r in "${ROLES[@]}"; do
  IFS='|' read -r name ns sa inline managed <<<"$r"
  echo "-- $name  <-  system:serviceaccount:$ns:$sa  (inline: $inline${managed:+; managed: $managed})"
  $APPLY || { trust "$ns" "$sa"; for p in $inline; do echo "   $p:"; policy "$p"; done; }
done
if ! $APPLY; then echo "Dry run: nothing created (--apply)."; exit 0; fi

if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER" >/dev/null 2>&1; then
  # IAM trusts the issuer's public CA itself; the thumbprint (top of the served chain) is kept for older checks.
  thumb=$(openssl s_client -servername "$HOST" -connect "$HOST:443" -showcerts </dev/null 2>/dev/null |
    awk '/BEGIN CERT/{c=""} {c=c $0 "\n"} /END CERT/{last=c} END{printf "%s", last}' |
    openssl x509 -noout -fingerprint -sha1 2>/dev/null | cut -d= -f2 | tr -d ':' | tr 'A-F' 'a-f' || true)
  aws iam create-open-id-connect-provider --url "$ISSUER" --client-id-list sts.amazonaws.com \
    ${thumb:+--thumbprint-list "$thumb"} --tags Key=project,Value=jeffi-stores >/dev/null
  echo "created $PROVIDER"
fi
for r in "${ROLES[@]}"; do
  IFS='|' read -r name ns sa inline managed <<<"$r"
  if aws iam get-role --role-name "$name" >/dev/null 2>&1; then
    aws iam update-assume-role-policy --role-name "$name" --policy-document "$(trust "$ns" "$sa")"
  else
    aws iam create-role --role-name "$name" --assume-role-policy-document "$(trust "$ns" "$sa")" \
      --description "k3s service account $ns/$sa (self-hosted IRSA)" --max-session-duration 3600 >/dev/null
  fi
  for p in $inline; do aws iam put-role-policy --role-name "$name" --policy-name "jeffi-$p" --policy-document "$(policy "$p")"; done
  for m in $managed; do aws iam attach-role-policy --role-name "$name" --policy-arn "arn:aws:iam::$ACCOUNT:policy/$m"; done
  echo "$name: $(aws iam get-role --role-name "$name" --query Role.Arn --output text)"
done
