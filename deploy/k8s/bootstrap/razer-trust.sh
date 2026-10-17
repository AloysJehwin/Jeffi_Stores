#!/bin/bash
# One-time: let the pipeline release the AI gateway on the Razer box (razer-release.sh). Run from a machine with
# AWS credentials and the razer-gpu SSH alias.
#   1. The EC2 core gets a deploy key at /etc/jeffi/razer-deploy (root only), over SSM.
#   2. The Razer box installs /usr/local/sbin/ai-gateway-release and authorizes that key for it alone
#      (forced command, no shell, no forwarding).
#   3. A status call over the same path proves it works.
# Idempotent. Also re-run github-oidc.sh so the deploy role may send the SSM command.
# Usage: bash deploy/k8s/bootstrap/razer-trust.sh
source "$(dirname "$0")/../db/lib.sh"
RAZER_SSH=${RAZER_SSH:-razer-gpu}
core=$(aws ec2 describe-addresses --public-ips "$CORE_IP" --query 'Addresses[0].InstanceId' --output text)

ssm() { # run a shell command on the core, print its output
  local id st
  id=$(aws ssm send-command --instance-ids "$core" --document-name AWS-RunShellScript \
    --parameters "commands=[\"$1\"]" --query Command.CommandId --output text)
  while :; do
    sleep 3
    st=$(aws ssm get-command-invocation --command-id "$id" --instance-id "$core" --query Status --output text 2>/dev/null || echo Pending)
    case $st in Pending|InProgress|Delayed) continue ;; esac; break
  done
  aws ssm get-command-invocation --command-id "$id" --instance-id "$core" --query StandardOutputContent --output text
  [ "$st" = Success ]
}

say "Deploy key on the core ($core)"
pub=$(ssm "install -d -m 700 /etc/jeffi && { [ -f /etc/jeffi/razer-deploy ] || ssh-keygen -q -t ed25519 -N '' -C jeffi-core-razer-deploy -f /etc/jeffi/razer-deploy; } && cat /etc/jeffi/razer-deploy.pub")
echo "$pub"

say "Release script and authorized key on the Razer box"
scp -q "$REPO/ai-platform/deploy/overlays/razer/host/ai-gateway-release.sh" "$RAZER_SSH:/tmp/ai-gateway-release"
ssh "$RAZER_SSH" "sudo -n install -m 0755 /tmp/ai-gateway-release /usr/local/sbin/ai-gateway-release && rm /tmp/ai-gateway-release
  mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
  grep -q 'jeffi-core-razer-deploy' ~/.ssh/authorized_keys || \
    echo 'command=\"/usr/local/sbin/ai-gateway-release --ssh\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty $pub' >> ~/.ssh/authorized_keys"

say "Status over the pipeline's path"
ssm "ssh -i /etc/jeffi/razer-deploy -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 ${RAZER_HOST:-aloysjehwin@100.82.208.8} status"
echo "Done. The pipeline's Deploy · AI gateway stage can now release the gateway."
