# 🚀 Quick Start Guide

## Local Development Setup (5 minutes)

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Up Environment Variables
```bash
# Copy example file
cp .env.example .env.local

# Edit .env.local with your Supabase credentials
# You only need these for now:
```

Edit `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_KEY=your-service-role-key-here
```

### 3. Set Up Database (Supabase)

1. Go to https://supabase.com
2. Create new project
3. Go to SQL Editor
4. Run `database/schema.sql` (creates tables)
5. Run `database/seed.sql` (adds sample data)

### 4. Start Development Server
```bash
npm run dev
```

### 5. Access Admin Panel
```
URL: http://localhost:3000/admin/login

Default Credentials:
Username: admin
Password: admin123
```

✅ **You're ready!** No certificate required in development.

---

## What Works Locally

✅ Admin login (no certificate needed)
✅ Session management
✅ All admin routes accessible
✅ Database connection via Supabase

⚠️ Certificate authentication is **disabled** in development
⚠️ AWS S3 upload will need credentials (add later)

---

## Next Steps After Login

Once you login, you can:
1. View admin dashboard
2. Manage products
3. Manage categories
4. View orders
5. Configure settings

---

## Production Deployment (Later)

When ready to deploy:
1. Set up Cloudflare Tunnel for subdomain routing
2. Generate and install client certificates
3. Set `NODE_ENV=production`
4. Certificate authentication will be **enforced**

See [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) for details.

---

## Troubleshooting

**Cannot install dependencies?**
```bash
# Try with legacy peer deps
npm install --legacy-peer-deps
```

**Database connection fails?**
- Check Supabase URL and keys in `.env.local`
- Verify you ran schema.sql and seed.sql
- Check Supabase project is active

**Admin login fails?**
- Username: `admin`
- Password: `admin123`
- Check browser console for errors
- Verify seed.sql created admin user

**Port 3000 already in use?**
```bash
npm run dev -- -p 3001
# Then access: http://localhost:3001/admin/login
```

---

## Support

For issues, check:
1. Browser console (F12)
2. Terminal logs
3. Supabase logs (Dashboard → Logs)
