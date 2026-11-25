#!/bin/bash
# Release the Razer box's LLM service from the pipeline: SSM RunShellScript on the EC2 core, which SSHes over
# Tailscale to the Razer box with a key that can only run /usr/local/sbin/ai-gateway-release (razer-trust.sh sets
# that up once). That script (ai-platform/deploy/overlays/razer/host/ai-gateway-release.sh) builds PaddleOCR on the
# box, applies the razer overlay, rolls PaddleOCR out and reads a sample through it. The AI gateway is no longer
# released here: it is a platform service (rollout.sh platform ai-gateway). Prints the remote output; fails when the
# remote release fails. `smoke` checks the three backends the gateway uses, the way the gateway reaches them: from the
# core over Tailscale, Ollama :11434, the image server :7860 and PaddleOCR :8866.
# Usage: razer-release.sh <sha> [--dry-run] | razer-release.sh smoke
source "$(dirname "$0")/../db/lib.sh"
SHA=${1:?sha or smoke}
RAZER=${RAZER_HOST:-aloysjehwin@100.82.208.8}
HOST=${RAZER_TAILNET_IP:-100.82.208.8}
KEY=/etc/jeffi/razer-deploy
core=$(aws ec2 describe-addresses --public-ips "$CORE_IP" --query 'Addresses[0].InstanceId' --output text)
if [ "$SHA" = smoke ]; then
  remote="LLM service smoke test"
  cmd="curl -fsS --max-time 15 http://$HOST:11434/api/version && echo && curl -fsS --max-time 15 -o /dev/null http://$HOST:7860/sdapi/v1/options && echo 'image server up' && curl -fsS --max-time 15 'http://$HOST:8866/health?ready=1' && echo"
else
  remote="release $SHA$($DRY_RUN && echo ' --dry-run' || true)"
  cmd="ssh -i $KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 $RAZER '$remote'"
fi

run_remote() {
  id=$(aws ssm send-command --instance-ids "$core" --document-name AWS-RunShellScript \
    --comment "ai-gateway $remote" --parameters "commands=[\"$cmd\"],executionTimeout=[\"1800\"]" \
    --query Command.CommandId --output text)
  while :; do
    sleep 10
    st=$(aws ssm get-command-invocation --command-id "$id" --instance-id "$core" --query Status --output text 2>/dev/null || echo Pending)
    case $st in Pending|InProgress|Delayed) continue ;; esac
    break
  done
  out=$(aws ssm get-command-invocation --command-id "$id" --instance-id "$core" --query StandardOutputContent --output text)
  err=$(aws ssm get-command-invocation --command-id "$id" --instance-id "$core" --query StandardErrorContent --output text)
  echo "$out"
  [ -n "$err" ] && [ "$err" != None ] && echo "$err" >&2
  return 0
}

# Retry only what a network blip explains: the SSH hop or the source fetch (last step marker is
# missing or "== Fetching"), or a failed smoke check. A build or rollout failure is real; no retry.
transient() {
  [ "$SHA" = smoke ] && return 0
  local last
  last=$(grep '^== ' <<<"$out" | tail -1 || true)
  [ -z "$last" ] || [[ $last == "== Fetching"* ]]
}

say "Razer LLM service: $remote (via $core)"
for attempt in 1 2 3; do
  run_remote
  [ "$st" = Success ] && exit 0
  [ $attempt -lt 3 ] && transient || break
  echo "Razer LLM service $remote: $st on attempt $attempt, looks transient; retrying in 30s" >&2
  sleep 30
done
echo "Razer LLM service release $st" >&2
exit 1
