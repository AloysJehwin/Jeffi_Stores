#!/bin/bash
# One-time: security groups + the core t4g.large, attached to the spare EIP 32.196.38.130.
set -euo pipefail
REGION=us-east-1
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SUBNET=$(aws ec2 describe-instances --instance-ids i-0b2466b2a540d6f23 --query 'Reservations[0].Instances[0].SubnetId' --output text)
AMI=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value --output text)
MYIP=$(curl -s https://checkip.amazonaws.com)

sg() { aws ec2 describe-security-groups --filters Name=group-name,Values="$1" Name=vpc-id,Values=$VPC --query 'SecurityGroups[0].GroupId' --output text; }
mk() { [ "$(sg "$1")" != "None" ] || aws ec2 create-security-group --group-name "$1" --description "$2" --vpc-id $VPC >/dev/null; sg "$1"; }
CORE_SG=$(mk jeffi-k8s-core "k3s core: public 80/443, cluster from nodes")
NODE_SG=$(mk jeffi-k8s-node "k3s agent nodes")
rule() { aws ec2 authorize-security-group-ingress "$@" >/dev/null 2>&1 || true; }
rule --group-id $CORE_SG --protocol tcp --port 80 --cidr 0.0.0.0/0
rule --group-id $CORE_SG --protocol tcp --port 443 --cidr 0.0.0.0/0
rule --group-id $CORE_SG --protocol tcp --port 22 --cidr $MYIP/32
for G in $CORE_SG $NODE_SG; do
  for S in $CORE_SG $NODE_SG; do
    rule --group-id $G --protocol tcp --port 6443 --source-group $S
    rule --group-id $G --protocol tcp --port 10250 --source-group $S
    rule --group-id $G --protocol udp --port 8472 --source-group $S
    rule --group-id $G --protocol tcp --port 2379-2380 --source-group $S
  done
done

# RDS: per-tenant + platform IAM DB auth from the nodes.
RDS_SG=$(aws rds describe-db-instances --db-instance-identifier jeffi-stores-db --query 'DBInstances[0].VpcSecurityGroups[0].VpcSecurityGroupId' --output text)
rule --group-id $RDS_SG --protocol tcp --port 5432 --source-group $CORE_SG
rule --group-id $RDS_SG --protocol tcp --port 5432 --source-group $NODE_SG

ID=$(aws ec2 run-instances --image-id $AMI --instance-type t4g.large --subnet-id $SUBNET \
  --security-group-ids $CORE_SG --key-name jeffi-stores-key \
  --iam-instance-profile Name=jeffi-stores-ec2-profile \
  --metadata-options HttpTokens=required,HttpPutResponseHopLimit=2 \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=40,VolumeType=gp3,Encrypted=true}' \
  --user-data file://"$(dirname "$0")/core-node.sh" \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=jeffi-k8s-core},{Key=app,Value=jeffi-k8s-core}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --instance-ids $ID
aws ec2 associate-address --instance-id $ID --allocation-id eipalloc-025dccb8bfce1b857 >/dev/null
echo "core: $ID  sg: $CORE_SG  node-sg: $NODE_SG  ip: 32.196.38.130"
