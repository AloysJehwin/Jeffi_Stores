# Local Development Setup

## Testing Admin Panel Locally (Without Subdomain)

Since the app is not deployed yet and you're using Cloudflare Tunnel, here's how to test locally:

## Option 1: Use Local Path (Recommended for Development)

Instead of subdomain routing, temporarily access admin via:
```
http://localhost:3000/admin/login
```

The middleware will be bypassed in development mode, so no certificate is required.

## Option 2: Simulate Subdomain Locally (Advanced)

### Step 1: Edit hosts file

**Windows:** `C:\Windows\System32\drivers\etc\hosts`
**Mac/Linux:** `/etc/hosts`

Add this line:
```
127.0.0.1   admin.localhost
```

### Step 2: Access admin panel
```
http://admin.localhost:3000/login
```

## Current Development Configuration

✅ **Certificate checking is DISABLED in development**
✅ **Session management works locally**
✅ **All admin features available**

## Testing Steps

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create `.env.local` file:**
   ```bash
   cp .env.example .env.local
   ```

3. **Fill in your Supabase credentials in `.env.local`:**
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_KEY=your-service-key

   # AWS S3 (optional for now)
   AWS_REGION=ap-south-1
   AWS_ACCESS_KEY_ID=your-key
   AWS_SECRET_ACCESS_KEY=your-secret
   S3_BUCKET_NAME=jeffi-stores
   ```

4. **Run development server:**
   ```bash
   npm run dev
   ```

5. **Access admin panel:**
   ```
   http://localhost:3000/admin/login
   ```

6. **Default login credentials:**
   ```
   Username: admin
   Password: admin123
   ```
   ⚠️ **CHANGE THIS after first login!**

## When Ready for Production

### With Cloudflare Tunnel:

1. **Add tunnel configuration:**
   ```yaml
   tunnel: your-tunnel-id
   credentials-file: /path/to/credentials.json

   ingress:
     # Admin subdomain with certificate authentication
     - hostname: admin.jeffistores.com
       service: https://localhost:3000
       originRequest:
         noTLSVerify: false

     # Main site
     - hostname: jeffistores.com
       service: https://localhost:3000

     - service: http_status:404
   ```

2. **Enable Cloudflare mTLS:**
   - Go to SSL/TLS → Client Certificates
   - Upload your CA certificate (from `certs/ca-cert.pem`)
   - Create hostname rule for `admin.jeffistores.com`

3. **Deploy and test:**
   ```bash
   cloudflared tunnel run your-tunnel-name
   ```

## Troubleshooting

### Cannot access admin panel
- Make sure you're using `/admin/login` path
- Check if Next.js dev server is running
- Clear browser cache/cookies

### Authentication fails
- Verify Supabase credentials in `.env.local`
- Check if seed data was loaded (admin user exists)
- Check console for errors

### Images not loading
- AWS S3 credentials not required for testing admin panel
- Can be configured later when testing product uploads

## Security Note

🔒 In development:
- Certificate check is **bypassed** (shows warning)
- HTTP is acceptable
- Use localhost or local domains

🔐 In production:
- Certificate check is **enforced**
- HTTPS is **required**
- Subdomain routing is **active**
