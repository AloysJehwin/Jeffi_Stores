#!/bin/bash
# Reads current AWS on-demand prices (us-east-1, Linux, PostgreSQL) for every compute_prices row and prints
# UPDATE statements for the control plane. Read-only against AWS; it changes nothing itself. Review the
# output, then run it through the release DB scripts or edit the prices at /admin/settings/compute-pricing.
# Usage: bash deploy/k8s/db/refresh-compute-prices.sh > /tmp/compute-prices.sql
set -euo pipefail

price() { # <service> <filters...> -> USD per unit of the first OnDemand term
  aws pricing get-products --region us-east-1 --service-code "$1" --max-results 1 --filters "${@:2}" \
    --query 'PriceList[0]' --output text |
    python3 -c 'import json,sys
d=json.loads(sys.stdin.read())
t=next(iter(d["terms"]["OnDemand"].values()))
print(next(iter(t["priceDimensions"].values()))["pricePerUnit"]["USD"])'
}
f() { echo "Type=TERM_MATCH,Field=$1,Value=$2"; }

ec2() {
  price AmazonEC2 "$(f instanceType "$1")" "$(f location 'US East (N. Virginia)')" "$(f operatingSystem Linux)" \
    "$(f tenancy Shared)" "$(f preInstalledSw NA)" "$(f capacitystatus Used)"
}
rds() { # <class> <Single-AZ|Multi-AZ>
  price AmazonRDS "$(f instanceType "$1")" "$(f location 'US East (N. Virginia)')" "$(f databaseEngine PostgreSQL)" \
    "$(f deploymentOption "$2")"
}

echo "BEGIN;"
for t in t4g.small t4g.medium t4g.large t4g.xlarge m7g.large c7g.large; do
  echo "UPDATE compute_prices SET usd_hourly = $(ec2 "$t"), updated_at = now() WHERE code = 'ec2:$t';"
done
for c in db.t4g.micro db.t4g.small db.t4g.medium db.t4g.large; do
  echo "UPDATE compute_prices SET usd_hourly = $(rds "$c" Single-AZ), usd_hourly_multi_az = $(rds "$c" Multi-AZ), updated_at = now() WHERE code = 'rds:$c';"
done
echo "COMMIT;"
