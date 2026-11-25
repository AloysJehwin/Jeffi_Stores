#!/bin/bash
# Publish the k3s service-account issuer (the Azure core's API server) as OIDC: its discovery document and JWKS,
# read from the cluster, into the oidc-issuer stack's bucket (deploy/aws/oidc-issuer.yaml), then a CloudFront
# invalidation. Re-run after a service-account signing key rotation. Checks that the cluster's issuer is the one
# STS and Entra trust. Dry run by default (fetches and validates, uploads nothing); --apply uploads.
# Needs: KUBECONFIG for the Azure core (default ~/.kube/jeffi-azure.yaml), AWS credentials that may write the bucket.
# Usage: bash deploy/azure/irsa/publish-oidc.sh [--apply]
set -euo pipefail
ISSUER=${OIDC_ISSUER:-https://oidc.jeffistores.in}
STACK=${OIDC_STACK:-jeffi-oidc-issuer}
export AWS_REGION=${AWS_REGION:-us-east-1}
export KUBECONFIG=${KUBECONFIG:-$HOME/.kube/jeffi-azure.yaml}
APPLY=false; for a in "$@"; do [ "$a" = --apply ] && APPLY=true; done
d=$(mktemp -d); trap 'rm -rf "$d"' EXIT

kubectl get --raw /.well-known/openid-configuration > "$d/openid-configuration"
kubectl get --raw /openid/v1/jwks > "$d/jwks"
python3 -I - "$d/openid-configuration" "$d/jwks" "$ISSUER" <<'PY'
import json, sys
conf, jwks, issuer = json.load(open(sys.argv[1])), json.load(open(sys.argv[2])), sys.argv[3]
problems = []
if conf.get("issuer") != issuer:
    problems.append(f"cluster issuer is {conf.get('issuer')!r}, expected {issuer!r} (k3s --kube-apiserver-arg service-account-issuer)")
if conf.get("jwks_uri") != issuer + "/openid/v1/jwks":
    problems.append(f"jwks_uri is {conf.get('jwks_uri')!r} (k3s --kube-apiserver-arg service-account-jwks-uri)")
keys = jwks.get("keys") or []
if not keys or any(k.get("kty") != "RSA" or k.get("use") != "sig" for k in keys):
    problems.append("JWKS has no RSA signing keys")
print(f"issuer {conf.get('issuer')}, {len(keys)} key(s): " + ", ".join(k.get("kid", "?") for k in keys))
if problems:
    sys.exit("\n".join(problems))
PY

bucket=$(aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text)
dist=$(aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)
echo "bucket $bucket, distribution $dist"
if ! $APPLY; then echo "Dry run: nothing uploaded (--apply)."; exit 0; fi
aws s3 cp "$d/openid-configuration" "s3://$bucket/.well-known/openid-configuration" --content-type application/json --cache-control max-age=300
aws s3 cp "$d/jwks" "s3://$bucket/openid/v1/jwks" --content-type application/json --cache-control max-age=300
id=$(aws cloudfront create-invalidation --distribution-id "$dist" --paths '/.well-known/openid-configuration' '/openid/v1/jwks' --query Invalidation.Id --output text)
aws cloudfront wait invalidation-completed --distribution-id "$dist" --id "$id"
curl -fsS "$ISSUER/.well-known/openid-configuration" | python3 -I -c 'import json, sys; print("live:", json.load(sys.stdin)["issuer"])'
