#!/bin/bash
# Seed cluster Secrets from Secrets Manager + the local certs/ dir. Prints no secret values.
# Run from the repo root with KUBECONFIG pointing at the cluster.
set -euo pipefail
REGION=us-east-1
sm() { aws secretsmanager get-secret-value --region $REGION --secret-id "$1" --query SecretString --output text; }
apply() { kubectl apply -f - >/dev/null; }

PROD=$(sm jeffi/production)
val() { jq -r --arg k "$1" '.[$k] // empty' <<<"$PROD"; }

kubectl -n jeffi create secret generic cron-secret --from-literal=CRON_SECRET="$(val CRON_SECRET)" --dry-run=client -o yaml | apply
kubectl -n jeffi get secret redis >/dev/null 2>&1 ||
  kubectl -n jeffi create secret generic redis --from-literal=password="$(openssl rand -hex 24)"

# GHCR pull secret (package is private). GH_DEPLOY_TOKEN needs read:packages; skipped when unset.
if [ -n "${GH_DEPLOY_TOKEN:-}" ]; then
  kubectl -n jeffi create secret docker-registry ghcr --docker-server=ghcr.io --docker-username=aloysjehwin \
    --docker-password="$GH_DEPLOY_TOKEN" --dry-run=client -o yaml | apply
else
  echo "GH_DEPLOY_TOKEN unset — ghcr pull secret skipped" >&2
fi

# Platform CA: public cert for Traefik verification; key only into the flagship pods.
kubectl -n jeffi-edge create secret generic platform-ca --from-file=ca.crt=certs/ca-cert.pem --dry-run=client -o yaml | apply
kubectl -n jeffi create secret generic platform-ca-key --from-file=ca-cert.pem=certs/ca-cert.pem \
  --from-file=ca-key.pem=certs/ca-key.pem --dry-run=client -o yaml | apply
kubectl -n jeffi create configmap rds-ca --from-file=global-bundle.pem=certs/global-bundle.pem --dry-run=client -o yaml | apply

# Tenant admin CA bundle starts as the platform CA; the app patches it as tenant CAs are issued.
kubectl -n jeffi-edge get secret client-ca-bundle >/dev/null 2>&1 ||
  kubectl -n jeffi-edge create secret generic client-ca-bundle --from-file=ca.crt=certs/ca-cert.pem

if [ -f jeffi-stores-76e9ecaecdd6.json ]; then
  kubectl -n jeffi create secret generic google-sa --from-file=json=jeffi-stores-76e9ecaecdd6.json --dry-run=client -o yaml | apply
fi
echo "secrets seeded"
