# SSL/TLS Certificate Configuration for Admin Panel

## Certificate-Based Authentication (mTLS)

This folder contains configuration for mutual TLS authentication for the admin panel.

## Setup Instructions

### 1. Generate Self-Signed Certificates (Development)

```bash
# Navigate to certs directory
cd certs

# Generate CA (Certificate Authority)
openssl genrsa -out ca-key.pem 4096
openssl req -new -x509 -days 365 -key ca-key.pem -out ca-cert.pem \
  -subj "/C=IN/ST=Chhattisgarh/L=Raipur/O=Jeffi Stores/CN=Jeffi Stores CA"

# Generate Server Certificate
openssl genrsa -out server-key.pem 4096
openssl req -new -key server-key.pem -out server-csr.pem \
  -subj "/C=IN/ST=Chhattisgarh/L=Raipur/O=Jeffi Stores/CN=admin.jeffistores.com"
openssl x509 -req -days 365 -in server-csr.pem -CA ca-cert.pem -CAkey ca-key.pem \
  -CAcreateserial -out server-cert.pem

# Generate Client Certificate (for admin users)
openssl genrsa -out client-key.pem 4096
openssl req -new -key client-key.pem -out client-csr.pem \
  -subj "/C=IN/ST=Chhattisgarh/L=Raipur/O=Jeffi Stores/CN=Admin User"
openssl x509 -req -days 365 -in client-csr.pem -CA ca-cert.pem -CAkey ca-key.pem \
  -CAcreateserial -out client-cert.pem

# Create PKCS12 file for browser import (admin users install this)
openssl pkcs12 -export -out client-cert.p12 -inkey client-key.pem \
  -in client-cert.pem -certfile ca-cert.pem
```

### 2. Install Client Certificate (Admin Users)

**Windows:**
- Double-click `client-cert.p12`
- Follow the Certificate Import Wizard
- Install to "Current User" → "Personal"

**macOS:**
- Double-click `client-cert.p12`
- Add to Keychain Access
- Set to "Always Trust"

**Linux (Chrome/Firefox):**
- Settings → Privacy & Security → Certificates
- Import `client-cert.p12`

### 3. Production Setup (with Cloudflare/Nginx)

#### Option A: Cloudflare mTLS
1. Upload `ca-cert.pem` to Cloudflare
2. Enable "Client Certificates" in SSL/TLS settings
3. Set hostname rule: `admin.jeffistores.com`

#### Option B: Nginx Configuration
```nginx
server {
    listen 443 ssl;
    server_name admin.jeffistores.com;

    ssl_certificate /path/to/server-cert.pem;
    ssl_certificate_key /path/to/server-key.pem;

    # Client certificate verification
    ssl_client_certificate /path/to/ca-cert.pem;
    ssl_verify_client on;
    ssl_verify_depth 2;

    # Pass certificate info to Next.js
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header X-Client-Cert $ssl_client_cert;
        proxy_set_header X-Client-Cert-Verified $ssl_client_verify;
        proxy_set_header X-Client-DN $ssl_client_s_dn;
    }
}
```

## File Structure

```
certs/
├── ca-key.pem          # CA private key (KEEP SECRET!)
├── ca-cert.pem         # CA certificate (share with server/proxy)
├── server-key.pem      # Server private key (KEEP SECRET!)
├── server-cert.pem     # Server certificate
├── client-key.pem      # Client private key (give to admin)
├── client-cert.pem     # Client certificate (give to admin)
└── client-cert.p12     # Browser-importable cert (give to admin)
```

## Security Notes

⚠️ **IMPORTANT:**
- Never commit `*.pem` or `*.p12` files to git
- Keep `*-key.pem` files extremely secure
- Rotate certificates every 90-365 days
- Use strong passwords for PKCS12 files
- Revoke certificates when admin leaves

## Testing Certificate Authentication

### Test with curl:
```bash
curl --cert client-cert.pem --key client-key.pem \
     --cacert ca-cert.pem \
     https://admin.jeffistores.com
```

### Test without certificate (should fail):
```bash
curl https://admin.jeffistores.com
# Expected: "Client certificate required" (403)
```

## Distribution to Admin Users

1. Generate individual client certificates per admin
2. Password-protect PKCS12 files
3. Send via secure channel (not email)
4. Provide installation instructions
5. Verify certificate is installed correctly

## Revocation

To revoke an admin's access:
1. Remove their certificate from allowed list
2. Update CA certificate on server
3. Force re-authentication

## Additional Resources

- [OpenSSL Documentation](https://www.openssl.org/docs/)
- [mTLS Best Practices](https://www.cloudflare.com/learning/access-management/what-is-mutual-tls/)
- [Certificate Pinning](https://owasp.org/www-community/controls/Certificate_and_Public_Key_Pinning)
