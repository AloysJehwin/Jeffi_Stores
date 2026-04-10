#!/bin/bash
set -euo pipefail

# =============================================================================
# Jeffi Stores — EC2 Setup Script
# Target: Amazon Linux 2023 or Ubuntu 22.04 on EC2 t4g.micro (ARM64)
# Domain: jeffistores.in
# =============================================================================

DOMAIN="jeffistores.in"
APP_DIR="/opt/jeffi-stores"
REPO_URL="git@github.com:AloysDev/Jeffi_Storess_Site.git"  # UPDATE THIS

echo "========================================="
echo "  Jeffi Stores EC2 Setup"
echo "  Domain: $DOMAIN"
echo "========================================="

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo "Cannot detect OS"
    exit 1
fi

# ---- Step 1: Install Docker ----
echo ">> Installing Docker..."
if [ "$OS" = "amzn" ]; then
    sudo yum update -y
    sudo yum install -y docker git
    sudo systemctl enable docker
    sudo systemctl start docker
    sudo usermod -aG docker ec2-user

    # Docker Compose plugin
    sudo mkdir -p /usr/local/lib/docker/cli-plugins
    sudo curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
        -o /usr/local/lib/docker/cli-plugins/docker-compose
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
elif [ "$OS" = "ubuntu" ]; then
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl gnupg git
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
        sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    sudo usermod -aG docker ubuntu
fi

echo "Docker version: $(docker --version)"
echo "Docker Compose version: $(docker compose version)"

# ---- Step 2: Install Certbot ----
echo ">> Installing Certbot..."
if [ "$OS" = "amzn" ]; then
    sudo yum install -y python3 python3-pip
    sudo pip3 install certbot
elif [ "$OS" = "ubuntu" ]; then
    sudo apt-get install -y certbot
fi

# ---- Step 3: Clone repository ----
echo ">> Cloning repository..."
sudo mkdir -p "$APP_DIR"
sudo chown "$(whoami):$(whoami)" "$APP_DIR"

if [ -d "$APP_DIR/.git" ]; then
    echo "Repository already exists, pulling latest..."
    cd "$APP_DIR"
    git pull
else
    git clone "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
fi

# ---- Step 4: Create certbot webroot ----
mkdir -p "$APP_DIR/certbot-webroot"

# ---- Step 5: Obtain SSL certificate ----
echo ">> Obtaining SSL certificate for $DOMAIN..."
echo ">> Make sure DNS is pointing to this server's IP before continuing!"
read -p "Press Enter when DNS is configured..."

sudo certbot certonly --standalone \
    -d "$DOMAIN" \
    --non-interactive \
    --agree-tos \
    --email aloysjehwin@gmail.com \
    --preferred-challenges http

echo "SSL certificate obtained!"

# ---- Step 6: Create .env.production ----
echo ">> Setting up environment..."
if [ ! -f "$APP_DIR/.env.production" ]; then
    cat > "$APP_DIR/.env.production" << 'ENVEOF'
# PostgreSQL (AWS RDS)
DATABASE_URL=postgresql://postgres:JeffiStores2026Rds@jeffi-stores-db.cjmaa6acimgm.us-east-1.rds.amazonaws.com:5432/jeffi_stores

# AWS S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=CHANGE_ME
AWS_SECRET_ACCESS_KEY=CHANGE_ME
S3_BUCKET_NAME=jeffi-stores-bucket

# JWT Secret
JWT_SECRET=CHANGE_ME_TO_A_STRONG_SECRET

# Email (AWS SES)
SES_SMTP_USER=CHANGE_ME
SES_SMTP_PASSWORD=CHANGE_ME
SES_FROM_EMAIL=noreply@jeffistores.in
NEXT_PUBLIC_BASE_URL=https://jeffistores.in

# Redis (internal Docker network)
REDIS_URL=redis://redis:6379
ADMIN_EMAIL=aloysjehwin@gmail.com

# Razorpay
RAZORPAY_KEY_ID=CHANGE_ME
RAZORPAY_KEY_SECRET=CHANGE_ME
NEXT_PUBLIC_RAZORPAY_KEY_ID=CHANGE_ME
RAZORPAY_WEBHOOK_SECRET=
ENABLE_RAZORPAY=true
NEXT_PUBLIC_ENABLE_RAZORPAY=true

# GST
ENABLE_GST=true
NEXT_PUBLIC_ENABLE_GST=true
BUSINESS_STATE_CODE=22
ENVEOF

    echo ""
    echo "!! IMPORTANT: Edit $APP_DIR/.env.production with your actual secrets !!"
    echo "   nano $APP_DIR/.env.production"
    echo ""
    read -p "Press Enter after editing .env.production..."
fi

# ---- Step 7: Copy certificates ----
echo ">> Setting up mTLS certificates..."
if [ ! -d "$APP_DIR/certs" ]; then
    echo "!! Copy your mTLS certs to $APP_DIR/certs/"
    echo "   Required files: ca-cert.pem, ca-key.pem, server-cert.pem, server-key.pem"
    mkdir -p "$APP_DIR/certs"
    read -p "Press Enter after copying certs..."
fi

# ---- Step 8: Build and start ----
echo ">> Building and starting containers..."
cd "$APP_DIR"
docker compose -f docker-compose.prod.yml up -d --build

echo ""
echo ">> Waiting for containers to start..."
sleep 5
docker compose -f docker-compose.prod.yml ps

# ---- Step 9: Setup cert auto-renewal ----
echo ">> Setting up SSL auto-renewal..."
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --deploy-hook 'docker restart jeffi-nginx'") | crontab -

echo ""
echo "========================================="
echo "  Setup Complete!"
echo "========================================="
echo ""
echo "  Public:  https://$DOMAIN"
echo "  Admin:   https://$DOMAIN:3443/admin"
echo ""
echo "  Useful commands:"
echo "    docker compose -f docker-compose.prod.yml logs -f"
echo "    docker compose -f docker-compose.prod.yml restart"
echo "    docker compose -f docker-compose.prod.yml down"
echo ""
