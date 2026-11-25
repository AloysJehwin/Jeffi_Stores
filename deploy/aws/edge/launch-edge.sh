#!/bin/bash
# The AWS tenant edge (plan §6a): one always-on t4g.small in the stores' VPC that runs the edge Traefik for every store
# host. Launches it with edge-node-user-data.sh (joins the Azure core over Tailscale), gives it a security group open
# on 80/443 (and Tailscale's UDP port), and an Elastic IP: the address store DNS points at (route53-plan.sh) and the
# provisioning ConfigMap's CLUSTER_INGRESS_IP (deploy/k8s/overlays/azure/patches/provisioning.yaml).
# Dry run by default: prints the plan and asks EC2 to validate the launch (--dry-run, nothing starts). --apply launches.
#   eip <instance-id> [--apply]   allocate (or reuse the jeffi-tenant-edge one) and associate the Elastic IP only
# Needs K8S_SERVER_URL (https://<core Tailscale IP>:6443), and SUBNET_ID / NODE_SG (the store nodes' subnet and
# security group, from the provisioning ConfigMap's K8S_NODE_SECURITY_GROUP) unless the defaults below fit.
# Usage: K8S_SERVER_URL=https://100.x.y.z:6443 bash deploy/aws/edge/launch-edge.sh [--apply]
#        bash deploy/aws/edge/launch-edge.sh eip i-0123456789abcdef0 [--apply]
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
export AWS_REGION=${AWS_REGION:-us-east-1}
TYPE=${EDGE_INSTANCE_TYPE:-t4g.small}
PROFILE=${EDGE_IAM_PROFILE:-jeffi-tenant-node-profile}
NAME=jeffi-tenant-edge
APPLY=false; for a in "$@"; do [ "$a" = --apply ] && APPLY=true; done

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
ud=$(mktemp); trap 'rm -f "$ud"' EXIT
sed "s#__K8S_SERVER__#$SERVER#" "$DIR/edge-node-user-data.sh" > "$ud"
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
