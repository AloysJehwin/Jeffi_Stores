#!/bin/bash

# Test AWS RDS Connection
# Quick script to verify RDS connectivity before migration

echo "🔍 Testing AWS RDS Connection"
echo "=============================="
echo ""

# AWS RDS Configuration
RDSHOST="jeffi-stores.cjmaa6acimgm.us-east-1.rds.amazonaws.com"
RDS_PORT="5432"
RDS_DB="postgres"
RDS_USER="postgres"
SSL_CERT="./certs/global-bundle.pem"

# Check if SSL certificate exists
if [ ! -f "$SSL_CERT" ]; then
    echo "⚠️  SSL certificate not found. Downloading..."
    mkdir -p certs
    curl -o "$SSL_CERT" https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
    echo "✅ SSL certificate downloaded"
    echo ""
fi

# Get RDS password
echo "Enter your AWS RDS password:"
read -s RDS_PASSWORD
echo ""
echo ""

# Test connection
echo "Testing connection to:"
echo "  Host: $RDSHOST"
echo "  Port: $RDS_PORT"
echo "  Database: $RDS_DB"
echo "  User: $RDS_USER"
echo ""

if PGPASSWORD="$RDS_PASSWORD" psql \
    "host=$RDSHOST port=$RDS_PORT dbname=$RDS_DB user=$RDS_USER sslmode=verify-full sslrootcert=$SSL_CERT" \
    -c "SELECT version();" 2>&1; then
    
    echo ""
    echo "✅ Connection successful!"
    echo ""
    
    # Show existing tables
    echo "Checking existing tables..."
    PGPASSWORD="$RDS_PASSWORD" psql \
        "host=$RDSHOST port=$RDS_PORT dbname=$RDS_DB user=$RDS_USER sslmode=verify-full sslrootcert=$SSL_CERT" \
        -c "SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;" 2>&1
    
    echo ""
    echo "✅ AWS RDS is ready for migration!"
else
    echo ""
    echo "❌ Connection failed!"
    echo ""
    echo "Common issues:"
    echo "1. Incorrect password"
    echo "2. RDS security group not allowing your IP"
    echo "3. RDS instance not publicly accessible"
    echo "4. SSL certificate issue"
    exit 1
fi
