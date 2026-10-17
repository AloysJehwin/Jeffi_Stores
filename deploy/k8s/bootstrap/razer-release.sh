#!/bin/bash
# Release the AI gateway on the Razer box from the pipeline: SSM RunShellScript on the EC2 core, which SSHes over
# Tailscale to the Razer box with a key that can only run /usr/local/sbin/ai-gateway-release (razer-trust.sh sets
# that up once). Prints the remote output; fails when the remote release fails.
# Usage: razer-release.sh <sha> [--dry-run]
source "$(dirname "$0")/../db/lib.sh"
SHA=${1:?sha}
RAZER=${RAZER_HOST:-aloysjehwin@100.82.208.8}
KEY=/etc/jeffi/razer-deploy
core=$(aws ec2 describe-addresses --public-ips "$CORE_IP" --query 'Addresses[0].InstanceId' --output text)
remote="release $SHA$($DRY_RUN && echo ' --dry-run' || true)"
cmd="ssh -i $KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 $RAZER '$remote'"

say "AI gateway on the Razer box: $remote (via $core)"
id=$(aws ssm send-command --instance-ids "$core" --document-name AWS-RunShellScript \
  --comment "ai-gateway $remote" --parameters "commands=[\"$cmd\"],executionTimeout=[\"1800\"]" \
  --query Command.CommandId --output text)
while :; do
  sleep 10
  st=$(aws ssm get-command-invocation --command-id "$id" --instance-id "$core" --query Status --output text 2>/dev/null || echo Pending)
  case $st in Pending|InProgress|Delayed) continue ;; esac
  break
done
aws ssm get-command-invocation --command-id "$id" --instance-id "$core" --query StandardOutputContent --output text
err=$(aws ssm get-command-invocation --command-id "$id" --instance-id "$core" --query StandardErrorContent --output text)
[ -n "$err" ] && [ "$err" != None ] && echo "$err" >&2
[ "$st" = Success ] || { echo "AI gateway release $st" >&2; exit 1; }
