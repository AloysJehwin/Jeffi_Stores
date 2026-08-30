#!/usr/bin/env bash
# Build the client-CA bundle nginx advertises on admin-{slug}.jeffistores.in.
#
# Why this exists: nginx only prompts a browser for a client certificate when the
# CertificateRequest carries acceptable CA names, and a browser then offers ONLY the
# certificates issued by one of them. The tenant admin block cannot name a CA per
# request — ssl_client_certificate takes no variables, so it cannot follow $tslug — so
# without a bundle the request goes out with an empty CA list and Chrome shows no picker
# at all. The panel then reports a missing certificate that the user was never able to
# send.
#
# ssl_verify_client stays optional_no_ca: this bundle exists to ADVERTISE issuers, not to
# validate. The chain is still verified per-tenant in the app (src/lib/tenant-mtls.ts),
# against that tenant's own CA.
#
# The platform CA is always included so the file is never empty — nginx refuses to start
# on an empty ssl_client_certificate.
set -euo pipefail

OUT="${1:-/opt/jeffi-stores/certs/client-ca-bundle.pem}"
PLATFORM_CA="${PLATFORM_CA:-/opt/jeffi-stores/certs/ca-cert.pem}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

[ -f "$PLATFORM_CA" ] || { echo "platform CA missing: $PLATFORM_CA" >&2; exit 1; }
cat "$PLATFORM_CA" > "$TMP"

HOST="${CONTROL_PLANE_RDS_HOST:-jeffi-stores-db.cjmaa6acimgm.us-east-1.rds.amazonaws.com}"
USER="${CONTROL_PLANE_RDS_USER:-app_user}"
DB="${CONTROL_PLANE_RDS_DB:-jeffi_control_plane}"
REGION="${AWS_REGION:-us-east-1}"

PGPASSWORD="$(aws rds generate-db-auth-token --hostname "$HOST" --port 5432 --region "$REGION" --username "$USER")" \
PGSSLMODE=require \
  psql -h "$HOST" -U "$USER" -d "$DB" -tAc "SELECT ca_cert_pem FROM tenant_ca WHERE ca_cert_pem IS NOT NULL" >> "$TMP"

# A truncated or malformed bundle would break every tenant admin host, so only publish
# a file openssl can actually parse.
if ! openssl crl2pkcs7 -nocrl -certfile "$TMP" >/dev/null 2>&1; then
  echo "refusing to publish an unparseable CA bundle" >&2
  exit 1
fi

COUNT="$(grep -c 'BEGIN CERTIFICATE' "$TMP" || true)"
install -m 0644 "$TMP" "$OUT"
echo "wrote $OUT with $COUNT CA certificate(s)"
