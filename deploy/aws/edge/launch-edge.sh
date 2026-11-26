#!/bin/bash
# The AWS tenant edge (plan §6a): one always-on t4g.small in the stores' VPC that runs the edge Traefik for every store
# host. Launches it with edge-node-user-data.sh (joins the Azure core over Tailscale), gives it a security group open
# on 80/443 (and Tailscale's UDP port), and an Elastic IP: the address store DNS points at (route53-plan.sh) and the
# provisioning ConfigMap's CLUSTER_INGRESS_IP (deploy/k8s/overlays/azure/patches/provisioning.yaml).
# Dry run by default: prints the plan and asks EC2 to validate the launch (--dry-run, nothing starts). --apply launches.
#   eip <instance-id> [--apply]   allocate (or reuse the jeffi-tenant-edge one) and associate the Elastic IP only
# Needs K8S_SERVER_URL (https://<core Tailscale IP>:6443), and SUBNET_ID / NODE_SG (the store nodes' subnet and
# security group, from the provisioning ConfigMap's K8S_NODE_SECURITY_GROUP) unless the defaults below fit.
# The k3s token and Tailscale key are read here at launch (SECRETS_BACKEND=aws|keyvault, like the controller) and written
# into the user-data, which unsets them after use and never traces; the instance profile needs no secrets access. They
# stay readable to the instance (IMDS user-data) and to ec2:DescribeInstanceAttribute, as on controller-launched store
# nodes. --instance-secrets keeps the old behaviour: the node reads jeffi/production/k3s from Secrets Manager itself.
# Usage: K8S_SERVER_URL=https://100.x.y.z:6443 bash deploy/aws/edge/launch-edge.sh [--apply] [--instance-secrets]
#        bash deploy/aws/edge/launch-edge.sh eip i-0123456789abcdef0 [--apply]
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
export AWS_REGION=${AWS_REGION:-us-east-1}
TYPE=${EDGE_INSTANCE_TYPE:-t4g.small}
PROFILE=${EDGE_IAM_PROFILE:-jeffi-tenant-node-profile}
NAME=jeffi-tenant-edge
APPLY=false INSTANCE_SECRETS=false
for a in "$@"; do case $a in --apply) APPLY=true ;; --instance-secrets) INSTANCE_SECRETS=true ;; esac; done

# The k3s token and Tailscale key (one JSON secret: K3S_TOKEN, TS_AUTHKEY), from the store SECRETS_BACKEND picks, as in
# packages/store-core/src/lib/secrets: `aws` (default, Secrets Manager) or `keyvault` (name jeffi/production/k3s is
# jeffi-production-k3s there; vault AZURE_KEY_VAULT_NAME, default jeffi-prod-kv, or AZURE_KEY_VAULT_URL).
JOIN_SECRET_ID=${K8S_JOIN_SECRET_ID:-jeffi/production/k3s}
secrets_backend() {
  case $(printf %s "${SECRETS_BACKEND:-aws}" | tr A-Z a-z) in
    aws|secretsmanager) echo aws ;; keyvault|key-vault|azure) echo keyvault ;;
    *) echo "SECRETS_BACKEND must be aws or keyvault (got \"${SECRETS_BACKEND:-}\")" >&2; return 1 ;;
  esac
}
join_secret() { # prints the secret's JSON; callers keep it in a variable only
  local backend name; backend=$(secrets_backend)
  if [ "$backend" = aws ]; then
    aws secretsmanager get-secret-value --region "${SECRETS_REGION:-us-east-1}" --secret-id "$JOIN_SECRET_ID" --query SecretString --output text
  else
    name=${JOIN_SECRET_ID//[^0-9A-Za-z-]/-}
    if [ -n "${AZURE_KEY_VAULT_URL:-}" ]; then az keyvault secret show --id "${AZURE_KEY_VAULT_URL%/}/secrets/$name" --query value -o tsv
    else az keyvault secret show --vault-name "${AZURE_KEY_VAULT_NAME:-jeffi-prod-kv}" --name "$name" --query value -o tsv; fi
  fi
}

eip() { # <instance-id>
  local alloc ip
  alloc=$(aws ec2 describe-addresses --filters "Name=tag:Name,Values=$NAME" --query 'Addresses[0].AllocationId' --output text)
  if [ "$alloc" = None ] || [ -z "$alloc" ]; then
    $APPLY || { echo "would allocate an Elastic IP tagged $NAME and associate it with $1"; return 0; }
    alloc=$(aws ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" --query AllocationId --output text)
  fi
  ip=$(aws ec2 describe-addresses --allocation-ids "$alloc" --query 'Addresses[0].PublicIp' --output text)
  $APPLY || { echo "would associate $ip ($alloc) with $1"; return 0; }
  aws ec2 associate-address --allocation-id "$alloc" --instance-id "$1" --allow-reassociation >/dev/null
  echo "Elastic IP $ip -> $1. Next: CLUSTER_INGRESS_IP in overlays/azure/patches/provisioning.yaml, then route53-plan.sh"
}
if [ "${1:-}" = eip ]; then eip "${2:?instance id}"; exit 0; fi

SERVER=${K8S_SERVER_URL:?K8S_SERVER_URL=https://<core Tailscale IP>:6443}
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SUBNET=${SUBNET_ID:-$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC" "Name=default-for-az,Values=true" --query 'Subnets[0].SubnetId' --output text)}
NODE_SG=${NODE_SG:?NODE_SG=<the store nodes security group (K8S_NODE_SECURITY_GROUP)>}
AMI=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value --output text)
EDGE_SG=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=$NAME" "Name=vpc-id,Values=$VPC" --query 'SecurityGroups[0].GroupId' --output text)
echo "== $NAME: $TYPE, $AMI, subnet $SUBNET, groups $NODE_SG + ${EDGE_SG/None/(new) $NAME}, profile $PROFILE, server $SERVER"

if [ "$EDGE_SG" = None ]; then
  if $APPLY; then
    EDGE_SG=$(aws ec2 create-security-group --group-name "$NAME" --vpc-id "$VPC" --description "Tenant edge: public 80/443, Tailscale" --query GroupId --output text)
    aws ec2 authorize-security-group-ingress --group-id "$EDGE_SG" --ip-permissions \
      'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]' \
      'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]' \
      'IpProtocol=udp,FromPort=41641,ToPort=41641,IpRanges=[{CidrIp=0.0.0.0/0}]' >/dev/null
  else
    echo "would create security group $NAME (tcp 80, 443 and udp 41641 from anywhere)"; EDGE_SG=$NODE_SG
  fi
fi
ud=$(mktemp); trap 'rm -f "$ud"' EXIT # mktemp is 0600; the secrets reach it and EC2 only, never argv or the terminal
if $INSTANCE_SECRETS; then
  echo "secrets: the node reads jeffi/production/k3s itself (--instance-secrets)"
else
  join=$(join_secret)
  echo "secrets: k3s token and Tailscale key read at launch from $(secrets_backend)"
fi
SERVER="$SERVER" JOIN="${join:-}" python3 -I -c '
import json, os, shlex, sys
s = open(sys.argv[1]).read().replace("__K8S_SERVER__", os.environ["SERVER"])
j = json.loads(os.environ["JOIN"]) if os.environ["JOIN"] else {}
for ph, k in (("__TS_AUTHKEY__", "TS_AUTHKEY"), ("__K3S_TOKEN__", "K3S_TOKEN")):
    v = j.get(k, "")
    if j and (not isinstance(v, str) or not v): sys.exit(k + " missing from the join secret")
    s = s.replace(ph, shlex.quote(v) if v else "\"\"")
open(sys.argv[2], "w").write(s)' "$DIR/edge-node-user-data.sh" "$ud"
unset join
run=(aws ec2 run-instances --image-id "$AMI" --instance-type "$TYPE" --subnet-id "$SUBNET"
  --security-group-ids "$NODE_SG" "$EDGE_SG" --iam-instance-profile "Name=$PROFILE" --user-data "file://$ud"
  --metadata-options 'HttpTokens=required,HttpEndpoint=enabled'
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=20,VolumeType=gp3,Encrypted=true}'
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME},{Key=jeffi:role,Value=edge}]"
  --query 'Instances[0].InstanceId' --output text)
if ! $APPLY; then
  out=$("${run[@]}" --dry-run 2>&1 || true)
  case $out in *DryRunOperation*) echo "EC2 validated the launch (nothing started)." ;; *) echo "EC2 refused the launch: $out" >&2 ;; esac
  echo "Dry run: re-run with --apply to launch."; exit 0
fi
id=$("${run[@]}")
echo "launched $id"
aws ec2 wait instance-running --instance-ids "$id"
eip "$id"
echo "Then: kubectl get node tenant-edge (it joins in a few minutes) and kubectl -n kube-system get ds traefik-edge"
