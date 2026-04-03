# AWS RDS Connection Issue - Security Group Fix

## Problem
Connection to RDS timed out: `jeffi-stores.cjmaa6acimgm.us-east-1.rds.amazonaws.com`

## Your Current IP
**165.1.155.42**

## Solution: Update RDS Security Group

### Option 1: AWS Console (Recommended)

1. **Go to RDS Console:**
   - https://console.aws.amazon.com/rds/
   - Select US East 1 (N. Virginia) region

2. **Find Your RDS Instance:**
   - Click on "Databases"
   - Click on "jeffi-stores"

3. **Update Security Group:**
   - Click on the VPC security group under "Connectivity & security"
   - Click on the security group ID (e.g., sg-xxxxx)
   - Click "Edit inbound rules"
   - Click "Add rule"
   - Type: PostgreSQL
   - Port: 5432
   - Source: My IP (will auto-fill to 165.1.155.42/32)
   - Description: "My development machine"
   - Click "Save rules"

### Option 2: AWS CLI

```bash
# Get your security group ID
aws rds describe-db-instances \
  --db-instance-identifier jeffi-stores \
  --query 'DBInstances[0].VpcSecurityGroups[0].VpcSecurityGroupId' \
  --output text \
  --region us-east-1

# Add your IP to the security group (replace sg-xxxxx with actual ID)
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxx \
  --protocol tcp \
  --port 5432 \
  --cidr 165.1.155.42/32 \
  --region us-east-1
```

### Option 3: Allow From Anywhere (NOT Recommended for Production)

```bash
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxx \
  --protocol tcp \
  --port 5432 \
  --cidr 0.0.0.0/0 \
  --region us-east-1
```

## After Updating Security Group

Run the test script again:
```bash
./test-rds-connection.sh
```

## Other Checks

1. **Verify RDS is publicly accessible:**
   - In RDS console → jeffi-stores → Connectivity & security
   - "Publicly accessible" should be "Yes"

2. **Verify RDS is available:**
   - Status should be "Available" (not "Starting" or "Stopped")

3. **Verify subnet group:**
   - Should have public subnets if accessing from internet
