# Jeffi Stores

E-commerce platform powering [jeffistores.in](https://jeffistores.in), an industrial-hardware online store. Built on Next.js 14 (App Router) with TypeScript, served from AWS EC2 (Amazon Linux 2023, ARM `t4g.micro`) via Docker Compose, backed by AWS RDS PostgreSQL, and fronted by CloudFront. Includes a full admin panel, Razorpay payments, GST-compliant invoicing, Google Sheets + Merchant Center sync, and AWS SES email.

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS
- **Backend**: Next.js Route Handlers + Server Actions (Node runtime)
- **Database**: PostgreSQL 15 (AWS RDS in prod, local Postgres in dev)
- **Cache / Realtime**: Redis (in Docker network), AWS API Gateway WebSocket for live admin updates
- **Storage**: AWS S3 + CloudFront for product/gallery images and static assets
- **Email**: AWS SES SMTP via `nodemailer`
- **Payments**: Razorpay (checkout) + RazorpayX (payouts)
- **Shipping**: Delhivery API
- **Hosting**: AWS EC2 (Amazon Linux 2023, ARM `t4g.micro`) running Docker Compose
- **CDN / TLS**: CloudFront in front of EC2 + S3, Let's Encrypt via Certbot on EC2
- **DNS**: Route 53 (`jeffistores.in`, `admin.jeffistores.in`)

## Project Structure

```
src/app/             Next.js App Router (storefront, /admin, /api routes)
src/components/      Reusable React components (admin/, visitor/, shared/)
src/lib/             Server-side helpers (db, auth, jwt, s3, email, gst,
                     invoice-pdf, razorpay, delhivery, google-sheets,
                     google-merchant-helpers, redis, websocket, etc.)
src/contexts/        React contexts (cart, auth)
src/middleware.ts    Auth + rate-limit middleware
src/instrumentation.ts  Next.js instrumentation hook
database/            schema.sql + migrations/*.sql
deploy/              setup.sh, maintenance.sh, nginx.conf,
                     scheduler-setup.sh, aws-infrastructure.yaml, lambda/
scripts/             One-off and scheduled Node scripts (DB sync, image
                     uploads, sheet sync, dimension/weight backfills)
public/              Static assets served by Next
certs/               mTLS certs for nginx <-> app (NOT in repo)
lambda/              AWS Lambda function source
```

## Local Development

### Prerequisites

- Node.js 18+ (per `package.json` `engines.node`; 20 LTS recommended)
- PostgreSQL 15+ running locally on port 5432
- AWS credentials with read access to the `jeffi-stores-bucket` S3 bucket (for product images during dev)

### Setup

1. Clone the repo: `git clone git@github.com:AloysJehwin/Jeffi_Stores.git`
2. `cp .env.example .env.local` and fill in values. Required for the app to start: `DATABASE_URL`, `JWT_SECRET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, `NEXT_PUBLIC_BASE_URL`. Razorpay/SES/GST blocks can be left as placeholders for non-payment dev.
3. Create the local database: `createdb jeffi_production_ready`
4. Apply schema: `psql jeffi_production_ready -f database/schema.sql`
5. Apply migrations in chronological order:
   ```bash
   for f in database/migrations/*.sql; do
       psql jeffi_production_ready -f "$f"
   done
   ```
6. `npm install`
7. `npm run dev`
8. Open the storefront at http://localhost:3000 and the admin panel at http://localhost:3000/admin

### Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Next dev server on port 3000 |
| `npm run dev:https` | Custom HTTPS dev server (`server.js`) for testing TLS-only flows |
| `npm run build` | Production build (`output: 'standalone'`) |
| `npm run start` | Run the standalone build |
| `npm run lint` | ESLint (Next config) |
| `npm run typecheck` | `tsc --noEmit` |

### Database

- **Local**: `jeffi_production_ready` on `localhost:5432`
- **Live**: RDS instance `jeffi-stores-db` (database name `jeffi_stores`), reachable only from EC2's private subnet — use the SSH tunnel via EC2 (see `scripts/tunnel.sh`) to access from local
- **Schema**: `database/schema.sql` (single-file canonical schema; tables include `users`, `admins`, `products`, `product_variants`, `product_images`, `categories`, `brands`, `orders`, `order_items`, `payments`, `invoices`, `cart_items`, `wishlist_items`, `coupons`, `addresses`, `customer_profiles`, `inventory_transactions`, `notifications`, `email_logs`, `gallery_images`, `site_settings`, `shipping_zones`, plus product reviews and search/view analytics)
- **Migrations**: 12 files in `database/migrations/*.sql` — apply in chronological order with `psql -f`. Latest covers cart sub-variant FKs, variant images, view tokens, phone normalization, MRP/ex-GST field renames, and Merchant Center sync logging.
- **DB sync helpers**: `scripts/sync-live-to-local.mjs`, `scripts/sync-local-to-live.mjs`, `scripts/sync-rds-to-local.mjs`, `scripts/backup-live-db.sh`

## Branches & PR Workflow

- `main` — production-ready, deployed to EC2
- `feature-admin` — all admin-panel work
- `feature-user` — all storefront / customer-facing work
- **NEVER commit directly to `main`.** Always go through a PR review.
- PRs are not auto-merged — wait for explicit approval from the repo owner before merging.

## Key Modules

### Admin Panel — `/admin`

Routes under `src/app/admin/`: `products`, `orders`, `quotations`, `invoices`, `customers`, `coupons`, `inventory`, `suppliers`, `categories`, `brands`, `cash-sale`, `purchaseorder` (via storefront), `packing-slips`, `labels`, `gst`, `financial`, `inflation`, `mailer`, `reviews`, `review-forms`, `traffic`, `team`, `settings`, `delhivery`, `scan`.

### Storefront — `/`

Routes under `src/app/`: catalog (`products`, `categories`, `brands`), `cart`, `checkout`, `account`, `wishlist`, `quotation`, `purchaseorder`, `invoice`, `support`, `forms`, `contact`, `about`, `legal`, `return-policy`, plus `auth` / `login` / `signup`.

### Server-side libraries — `src/lib/`

Authentication (`auth.ts`, `auth-guard.ts`, `jwt.ts`, `otp.ts`, `scopes.ts`), DB (`db.ts`, `queries.ts`), payments (`razorpay.ts`), email (`email.ts`, `email-campaigns.ts`), shipping (`shipping.ts`, `delhivery.ts`), GST + invoicing (`gst.ts`, `invoice.ts`, `invoice-pdf.ts`, `quotation-pdf.ts`, `po-pdf.ts`, `receipt-pdf.ts`, `packing-slip-pdf.ts`, `label-pdf.ts`), GST integrations (`einvoice.ts`, `ewaybill.ts` — currently disabled), Google integrations (`google-sheets.ts`, `google-merchant-helpers.ts`), inventory (`inventory.ts`, `sku.ts`), realtime (`websocket.ts`, `redis.ts`), rate limiting (`rate-limit.ts`), S3 (`s3.ts`), search (`search.ts`).

### Integrations

- **Razorpay** — payment processing. Env: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `ENABLE_RAZORPAY`, `NEXT_PUBLIC_ENABLE_RAZORPAY`. Payouts use RazorpayX (`RAZORPAYX_KEY_ID`, `RAZORPAYX_KEY_SECRET`, `RAZORPAYX_ACCOUNT_NUMBER`, `RAZORPAYX_WEBHOOK_SECRET`).
- **Google Sheets** — product sync to Sheet1 of the Google Merchant/Product sheet (38 cols). Service account key file `jeffi-stores-76e9ecaecdd6.json` mounted into the container; key is **not** in the repo.
- **Google Merchant Center** — nightly product feed for Google Shopping ads (merchant ID `5762156822`); same service account.
- **AWS SES** — order/auth/notification emails. Env: `SES_SMTP_USER`, `SES_SMTP_PASSWORD`, `SES_FROM_EMAIL`, `SES_ADMIN_FROM_EMAIL`.
- **Delhivery** — shipping label + tracking. Env: `DELHIVERY_API_KEY`, `DELHIVERY_ORIGIN_PINCODE`, `DELHIVERY_PICKUP_LOCATION`, `DELHIVERY_SELLER_NAME`, `DELHIVERY_SELLER_PHONE`, `DELHIVERY_SELLER_ADDRESS`.
- **OpenAI** — used by admin tooling (`scripts/fix-dimensions-ai.mjs`, `src/lib/iconSuggest.ts`). Env: `OPENAI_API_KEY`.
- **Google OAuth + Maps** — sign-in and address autocomplete. Env: `GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.

## Deployment

Production runs on a single EC2 `t4g.micro` (ARM64) running Docker Compose with three services: `app` (two replicas of the Next standalone image from GHCR), `nginx` (TLS + reverse proxy), and `redis`. The image is pulled from `ghcr.io/aloysjehwin/jeffi_stores:latest`.

`deploy/setup.sh` bootstraps a fresh EC2 instance — installs Docker + Docker Compose plugin + Certbot, clones the repo to `/opt/jeffi-stores`, obtains a Let's Encrypt cert for `jeffistores.in`, generates a starter `.env.production` (you must edit it with real secrets before continuing), expects mTLS certs in `/opt/jeffi-stores/certs/`, builds + starts containers, and applies pending migrations.

```bash
ssh -i ~/.ssh/jeffi-stores-key.pem ec2-user@<EC2_IP>
sudo bash /opt/jeffi-stores/deploy/setup.sh
```

The repo is cloned from `git@github.com:AloysJehwin/Jeffi_Stores.git` (configured in `deploy/setup.sh`).

### Cron Jobs (installed by `setup.sh` on EC2)

- `0 3 * * *` — `certbot renew --quiet --deploy-hook 'docker restart jeffi-nginx'`
- `30 2 * * *` — Nightly Google Merchant Center sync via `GET /api/admin/merchant/sync` with `Authorization: Bearer $CRON_SECRET`

### In-app Schedules (run inside the Next.js process via `src/instrumentation.ts`)

- Every 10 min — Delhivery shipment status sync (`POST /api/admin/delhivery/sync-statuses`)
- Every 1 min — Cancel stale unpaid orders past the 10-minute payment window (`GET /api/cron/cancel-stale-orders`). Sends auto-cancel emails to the customer and to all active admins.

Both are gated by `Authorization: Bearer $CRON_SECRET` and started by the `register()` hook 30–45 s after app boot. With two replicas under Docker Compose, both replicas tick — duplicate work is harmless because each route is idempotent (`UPDATE ... WHERE status='pending'` won't double-cancel).

### Maintenance Mode

`deploy/maintenance.sh` runs from your **local** machine — it SSHs into EC2 and uses the AWS CLI to flip CloudFront over to the S3 maintenance page while RDS / EC2 are stopped.

```bash
./deploy/maintenance.sh stop      # Enter maintenance mode (stops EC2 + RDS)
./deploy/maintenance.sh start     # Exit maintenance mode
./deploy/maintenance.sh status    # Show service state (EC2, RDS, CloudFront, containers)
```

It targets EC2 instance `i-0b2466b2a540d6f23`, RDS `jeffi-stores-db`, and CloudFront distribution `E1M6ZFCWXAMF26` in `us-east-1`.

### Useful prod commands (on EC2, in `/opt/jeffi-stores`)

```bash
docker compose -f docker-compose.prod.yml logs -f
docker compose -f docker-compose.prod.yml restart
docker compose -f docker-compose.prod.yml down
```

## Environment Variables

Grouped by domain. Required-for-prod marked with `*`.

### Database
- `DATABASE_URL`* — Postgres connection string

### AWS
- `AWS_REGION`* — `us-east-1` in prod, `ap-south-1` in `.env.example`
- `AWS_ACCESS_KEY_ID`*, `AWS_SECRET_ACCESS_KEY`*
- `S3_BUCKET_NAME`* — `jeffi-stores-bucket` in prod
- `S3_KEY_PREFIX` — namespacing key prefix (default `dev`)
- `CLOUDFRONT_URL` — CloudFront distribution domain for image URLs
- `WS_API_ID`, `WS_REGION` — API Gateway WebSocket (live admin updates)

### Image Processing
- `MAX_IMAGES_PER_PRODUCT` (default 5)
- `THUMBNAIL_SIZE` (default 300)
- `MAX_IMAGE_SIZE` (default 2 MB)

### App
- `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_APP_URL`, `APP_URL`, `ADMIN_BASE_URL`
- `NODE_ENV`

### Auth / JWT / OAuth
- `JWT_SECRET`*
- `GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`

### Email (AWS SES)
- `SES_SMTP_USER`*, `SES_SMTP_PASSWORD`*, `SES_FROM_EMAIL`*
- `SES_ADMIN_FROM_EMAIL`, `ADMIN_EMAIL`, `SUPPORT_EMAIL`

### Payments
- `RAZORPAY_KEY_ID`*, `RAZORPAY_KEY_SECRET`*, `NEXT_PUBLIC_RAZORPAY_KEY_ID`*
- `RAZORPAY_WEBHOOK_SECRET`, `ENABLE_RAZORPAY`, `NEXT_PUBLIC_ENABLE_RAZORPAY`
- `RAZORPAYX_KEY_ID`, `RAZORPAYX_KEY_SECRET`, `RAZORPAYX_ACCOUNT_NUMBER`, `RAZORPAYX_WEBHOOK_SECRET`

### GST / Invoicing
- `ENABLE_GST`, `NEXT_PUBLIC_ENABLE_GST`
- `BUSINESS_STATE_CODE` (default `22`)
- E-Invoice (currently inactive — IRP credentials pending): `EINVOICE_BASE_URL`, `EINVOICE_CLIENT_ID`, `EINVOICE_CLIENT_SECRET`, `EINVOICE_USERNAME`, `EINVOICE_PASSWORD`, `EINVOICE_GSTIN`
- E-Way Bill (on hold): `EWAYBILL_BASE_URL`, `EWAYBILL_CLIENT_ID`, `EWAYBILL_CLIENT_SECRET`, `EWAYBILL_USERNAME`, `EWAYBILL_PASSWORD`, `EWAYBILL_GSTIN`

### Shipping
- `DELHIVERY_API_KEY`, `DELHIVERY_ORIGIN_PINCODE`, `DELHIVERY_PICKUP_LOCATION`, `DELHIVERY_SELLER_NAME`, `DELHIVERY_SELLER_PHONE`, `DELHIVERY_SELLER_ADDRESS`

### Realtime / Cache
- `REDIS_URL`* (set to `redis://redis:6379` inside Docker network)
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `UPSTASH_REDIS_URL` (optional alternative to local Redis)

### Cron
- `CRON_SECRET` — bearer token for the nightly Merchant sync endpoint

### Misc
- `OPENAI_API_KEY` — used by admin AI helpers
- `NODE_TLS_REJECT_UNAUTHORIZED` — only set when explicitly debugging TLS

## Secrets Not in Repo

- `jeffi-stores-76e9ecaecdd6.json` — Google service-account key (Sheets + Merchant Center). Place at repo root; mounted read-only into the container.
- `certs/` — mTLS certs for the nginx ↔ app channel (`ca-cert.pem`, `ca-key.pem`, `server-cert.pem`, `server-key.pem`).
- `.env.production` — populated on EC2 only; never committed.
- `~/.ssh/jeffi-stores-key.pem` — EC2 SSH key (operator-only).

## License

Proprietary — © Jeffi Stores. All rights reserved.
