#!/bin/bash

# Database Migration Script: Supabase to AWS RDS
# This script exports your Supabase database and imports it into AWS RDS

set -e  # Exit on error

echo "🚀 Jeffi Stores - Database Migration to AWS RDS"
echo "================================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# AWS RDS Configuration
RDSHOST="jeffi-stores.cjmaa6acimgm.us-east-1.rds.amazonaws.com"
RDS_PORT="5432"
RDS_DB="postgres"
RDS_USER="postgres"
SSL_CERT="./certs/global-bundle.pem"

# Backup filename
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="database/backup_supabase_${TIMESTAMP}.sql"
SCHEMA_FILE="database/backup_schema_${TIMESTAMP}.sql"
DATA_FILE="database/backup_data_${TIMESTAMP}.sql"

# Check if SSL certificate exists
if [ ! -f "$SSL_CERT" ]; then
    echo -e "${YELLOW}⚠️  SSL certificate not found at $SSL_CERT${NC}"
    echo "Downloading AWS RDS CA bundle..."
    mkdir -p certs
    curl -o "$SSL_CERT" https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
    echo -e "${GREEN}✅ SSL certificate downloaded${NC}"
fi

# Get Supabase connection details
echo ""
echo "📋 Step 1: Getting Supabase connection details..."
echo "------------------------------------------------"

# Extract project ref from Supabase URL
SUPABASE_URL=$(grep "NEXT_PUBLIC_SUPABASE_URL" .env.local | cut -d'=' -f2)
SUPABASE_PROJECT=$(echo "$SUPABASE_URL" | sed -n 's/.*\/\/\([^.]*\).*/\1/p')

echo "Supabase Project: $SUPABASE_PROJECT"
echo ""
echo "To get your Supabase database password:"
echo "1. Go to: https://supabase.com/dashboard/project/$SUPABASE_PROJECT/settings/database"
echo "2. Copy the 'Connection String' under 'Connection string' section"
echo "3. Or use 'Database password' if you have it"
echo ""

# Prompt for Supabase credentials
read -p "Enter Supabase database password: " -s SUPABASE_PASSWORD
echo ""

# Supabase connection string
SUPABASE_HOST="db.${SUPABASE_PROJECT}.supabase.co"
SUPABASE_PORT="5432"
SUPABASE_DB="postgres"
SUPABASE_USER="postgres"

echo ""
echo -e "${GREEN}✅ Supabase connection configured${NC}"

# Step 2: Test Supabase connection
echo ""
echo "📋 Step 2: Testing Supabase connection..."
echo "------------------------------------------------"

if PGPASSWORD="$SUPABASE_PASSWORD" psql "host=$SUPABASE_HOST port=$SUPABASE_PORT dbname=$SUPABASE_DB user=$SUPABASE_USER sslmode=require" -c "SELECT version();" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Successfully connected to Supabase${NC}"
else
    echo -e "${RED}❌ Failed to connect to Supabase. Please check your credentials.${NC}"
    exit 1
fi

# Step 3: Export database from Supabase
echo ""
echo "📋 Step 3: Exporting database from Supabase..."
echo "------------------------------------------------"

echo "Creating backup directory..."
mkdir -p database

echo "Exporting schema and data..."
PGPASSWORD="$SUPABASE_PASSWORD" pg_dump \
    "host=$SUPABASE_HOST port=$SUPABASE_PORT dbname=$SUPABASE_DB user=$SUPABASE_USER sslmode=require" \
    --verbose \
    --no-owner \
    --no-privileges \
    --clean \
    --if-exists \
    --file="$BACKUP_FILE" 2>&1 | grep -v "^pg_dump: " || true

if [ -f "$BACKUP_FILE" ]; then
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "${GREEN}✅ Database exported successfully ($BACKUP_SIZE)${NC}"
    echo "Backup saved to: $BACKUP_FILE"
else
    echo -e "${RED}❌ Export failed${NC}"
    exit 1
fi

# Step 4: Get RDS password
echo ""
echo "📋 Step 4: Preparing RDS connection..."
echo "------------------------------------------------"

read -p "Enter AWS RDS database password: " -s RDS_PASSWORD
echo ""

# Step 5: Test RDS connection
echo ""
echo "📋 Step 5: Testing AWS RDS connection..."
echo "------------------------------------------------"

if PGPASSWORD="$RDS_PASSWORD" psql "host=$RDSHOST port=$RDS_PORT dbname=$RDS_DB user=$RDS_USER sslmode=verify-full sslrootcert=$SSL_CERT" -c "SELECT version();" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Successfully connected to AWS RDS${NC}"
else
    echo -e "${RED}❌ Failed to connect to AWS RDS. Please check your credentials.${NC}"
    exit 1
fi

# Step 6: Import to RDS
echo ""
echo "📋 Step 6: Importing database to AWS RDS..."
echo "------------------------------------------------"
echo -e "${YELLOW}⚠️  This will drop and recreate all tables in the RDS database!${NC}"
read -p "Continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Migration cancelled."
    exit 0
fi

echo "Importing data to AWS RDS..."
PGPASSWORD="$RDS_PASSWORD" psql \
    "host=$RDSHOST port=$RDS_PORT dbname=$RDS_DB user=$RDS_USER sslmode=verify-full sslrootcert=$SSL_CERT" \
    --file="$BACKUP_FILE" \
    --echo-errors \
    2>&1 | grep -E "ERROR|CREATE|ALTER|NOTICE" || true

echo -e "${GREEN}✅ Database import completed${NC}"

# Step 7: Verify migration
echo ""
echo "📋 Step 7: Verifying migration..."
echo "------------------------------------------------"

echo "Checking table counts..."
SUPABASE_COUNT=$(PGPASSWORD="$SUPABASE_PASSWORD" psql -t "host=$SUPABASE_HOST port=$SUPABASE_PORT dbname=$SUPABASE_DB user=$SUPABASE_USER sslmode=require" -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';" | tr -d ' ')

RDS_COUNT=$(PGPASSWORD="$RDS_PASSWORD" psql -t "host=$RDSHOST port=$RDS_PORT dbname=$RDS_DB user=$RDS_USER sslmode=verify-full sslrootcert=$SSL_CERT" -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';" | tr -d ' ')

echo "Supabase tables: $SUPABASE_COUNT"
echo "AWS RDS tables: $RDS_COUNT"

if [ "$SUPABASE_COUNT" = "$RDS_COUNT" ]; then
    echo -e "${GREEN}✅ Table count matches!${NC}"
else
    echo -e "${YELLOW}⚠️  Table counts differ. Please verify manually.${NC}"
fi

# Step 8: Generate new connection string
echo ""
echo "📋 Step 8: Generating new environment variables..."
echo "------------------------------------------------"

cat > database/rds-env-config.txt << EOF
# AWS RDS PostgreSQL Configuration
# Replace these values in your .env.local file

# Direct PostgreSQL connection (for migrations, pg_dump, etc.)
DATABASE_URL=postgresql://$RDS_USER:[PASSWORD]@$RDSHOST:$RDS_PORT/$RDS_DB?sslmode=verify-full&sslrootcert=$SSL_CERT

# For application use (you'll need to update the connection method)
RDS_HOST=$RDSHOST
RDS_PORT=$RDS_PORT
RDS_DATABASE=$RDS_DB
RDS_USER=$RDS_USER
RDS_PASSWORD=[YOUR_RDS_PASSWORD]
RDS_SSL_CERT=$SSL_CERT

# Keep these for backwards compatibility during transition
NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=(keep existing value)
SUPABASE_SERVICE_KEY=(keep existing value)
EOF

echo -e "${GREEN}✅ Environment configuration saved to: database/rds-env-config.txt${NC}"

# Summary
echo ""
echo "================================================"
echo "🎉 Migration Complete!"
echo "================================================"
echo ""
echo "📁 Backup file: $BACKUP_FILE"
echo "⚙️  Config file: database/rds-env-config.txt"
echo ""
echo "Next steps:"
echo "1. Review the backup file if needed"
echo "2. Update your .env.local with RDS connection details"
echo "3. Update src/lib/supabase.ts to use PostgreSQL client (pg package)"
echo "4. Test your application with the new database"
echo "5. Keep the Supabase backup for safety"
echo ""
echo -e "${YELLOW}⚠️  Remember to keep your RDS password secure!${NC}"
