# Digital Products, Subscriptions & Vault — implementation plan

Status: **design approved for build** · Repo: multi-tenant SaaS, one RDS DB per tenant + a control-plane DB.
Produced by a design workflow (5 area designers → integrator → 7 adversarial review lenses → 29 confirmed critical/high corrections folded in).

---

## 1. The three features

- **A — Subscriptions** (physical *and* digital). Bought from the product page via a dedicated `/subscribe` checkout (never the cart), on **Razorpay Subscriptions**. Razorpay owns the schedule and auto-debits each cycle; we mint one normal order per paid cycle. Digital cycles keep vault access alive.
- **B — Digital products** (movie, book, audio, any format). A **Digital** toggle blocks every physical field + variants, grants access instead of shipping (order status **`granted`**, label "Access granted"), and delivers through a new authenticated host **`vault.jeffistores.in`** / **`vault-{slug}.jeffistores.in`**. Vault is on **every plan incl. Basic**.
- **C — Controllable download + content protection.** `downloadable` is per-product **and** a store-wide master switch (effective = master && product). The vault site blocks text selection / copy / cut / paste / context-menu / drag / print, blurs content on blur & tab-hide, reacts to PrintScreen, overlays a tiled buyer-identity watermark, renders PDFs to canvas (no text layer), and streams media with no download control — **with an honest statement that a browser cannot stop OS screenshots, phone cameras or external recorders. DRM (Widevine/FairPlay) is a documented future path.**

---

## 2. Decisions already made (yours)

1. Mixed carts allowed → one order; digital granted at payment, physical ships; shipping on physical lines only; status follows the shipment unless **all lines are digital** → `granted`.
2. Vault files: in-browser player/reader + admin-controlled download; non-browser formats (ZIP, EPUB, apps) are download-only.
3. Storage quotas per plan: Basic 10 GB · Growth 50 GB · Pro 200 GB · Enterprise 1 TB; 5 GB/file; editable from platform admin; access logged for later bandwidth billing.
4. Subscriptions on **all** plans; admin Subscriptions page everywhere; `subscription_renewal` reminder campaign stays Pro+ (needs the campaigns scope).
5. A product may be **both** digital and subscription (recurring access).
6. India-only in v1. No coupons on subscriptions. ₹0 digital out of scope.
7. **Two-level switches (master && product), consistent across features:**
   - **Subscriptions:** Site Controls `subscriptionsEnabled` is the master; each product has its own `is_subscription` flag. The Subscribe option is offered only when **both** are on. Turning the master off hides Subscribe everywhere without touching per-product flags.
   - **Downloads:** Site Controls `vaultDownloadsEnabled` is the master; each product/file has its own `downloadable` flag. A file is downloadable only when **both** are on (non-browser formats like ZIP/EPUB still require downloads on).

---

## 3. Non-obvious ground truth the plan relies on (verified in code)

- `orders.status` is `varchar(50)` with **no CHECK** — adding `'granted'` is schema-free.
- Dormant product columns already exist (`is_digital, download_url, license_type, file_format, platform_compatibility, is_subscription, subscription_interval, subscription_price`). **Correction from review:** `is_subscription`/`subscription_interval` ARE already read today by the replenishment campaign — not inert.
- `public.subscriptions` is a crons-era stub with a live reader: the **`subscription_renewal` campaign** selects `status='active' AND next_renewal_at` window. Widening this table for Razorpay subs will make that campaign spam every new subscriber **unless we add a discriminator** (see P1).
- The schema pipeline (`src/lib/tenant-migrations-schema.ts`) is **add-only**: strips NOT NULL but keeps DEFAULT, rewrites `CREATE INDEX`→`IF NOT EXISTS`, DROP+re-adds CHECKs each run, applies only `database/*.sql` (NOT control-plane). So: can't drop `interval_minutes`/`download_url` ever; new index names must not collide; **control-plane DDL is applied by a different mechanism** (`deploy/schema-diff.sh`), not this pipeline.
- The Razorpay customer webhook already resolves tenant from order notes, but handlers run **without `runWithTenantContext`** and the top handler **always returns 200**. Both must change — carefully (see P2).
- `STATIC_ASSET_RE` in middleware serves any `.mp4/.webm/.pdf/.{img}` path as `next()` **before auth, on every host** — vault stream routes must never carry those extensions and the vault host must be guarded explicitly.

---

## 4. Data model

New tenant tables (no `tenant_id` column — per-tenant DB gives isolation):
- **`product_files`** (`catalog.sql`, private): `kind video|audio|pdf|image|other`, `status uploading|processing|ready|failed`, `downloadable`, `storage_driver s3|local`, `storage_key`, checksum, duration/pages, `display_order`, `mime_type`.
- **`vault_entitlements`** (`orders.sql`): per `order_item` (UNIQUE `order_item_id`), `source one_time|subscription`, `status active|revoked`, `access_expires_at`, `granted_at`, `revoked_at`, `revoke_reason`.
- **`subscription_cycle_orders`** (`orders.sql`): idempotency ledger, UNIQUE `(subscription_id, cycle_number)` + UNIQUE `razorpay_payment_id`.
- **`subscription_plans_cache`** (`payments.sql`): keyed `(period, interval_count, amount_paise, collecting_account)` so repricing versions cleanly.
- **`vault_tickets`** (`auth.sql`): single-use **hashed** SSO tickets, in the tenant DB (no cross-tenant replay).
- **`vault_access_log`** + **`upload_sessions`** (`logs.sql`). **Correction:** `vault_access_log` uses a **`CREATE SEQUENCE` + `nextval` bigint PK** (the repo pattern), NOT `GENERATED AS IDENTITY` — the add-only pipeline can't introduce IDENTITY.

Column adds (all new NOT NULL carry a DEFAULT so the pipeline accepts them on existing tenants):
- `products`: `downloadable`, `subscription_price_ex_gst`, `subscription_intervals text[]`, `subscription_discount_type/value`, `age_rating`. Keep `download_url` (can't drop) — stop writing/exposing it.
- `order_items`: `is_digital` (snapshot), `granted_at`, `access_revoked_at`, `is_returnable DEFAULT true`.
- `orders`: `granted_at`, `subscription_id`, `subscription_cycle`.
- `subscriptions`: widen in place — Razorpay ids, pricing snapshot, address snapshot, state machine, access expiry. **Keep `interval_minutes` NOT NULL and derive it** (pipeline can't make it nullable).

Constraints: `products CHECK (NOT (is_digital AND has_variants))`; widened `subscriptions` status CHECK; **no digital-XOR-subscription CHECK** (they combine). Index names audited for collisions (`idx_subscriptions_user` collides — drop/rename).

Control plane (**local DB only, via `schema-diff.sh` not the tenant pipeline; wrap each ADD CONSTRAINT in an `IF NOT EXISTS` guard**):
- `plans += storage_quota_bytes, max_file_bytes, egress_quota_bytes`; `tenants += razorpay_webhook_secret`; `tenant_infra += used_storage_bytes, file_count`.
- New `razorpay_subscription_index(razorpay_subscription_id PK, tenant_id, collecting_account, product_id, local_subscription_id)` for webhook routing.
- `seed-plans.sql`: quota values + `vault:read/write` + `subscriptions:read/write` scopes added to **both** the INSERT and the DELETE-complement VALUES lists, all 4 plans.

---

## 5. Phases (each leaves the app shippable; unfinished surfaces gated by flags seeded OFF)

**P1 — Schema + core libs + flags.** Tenant DDL (apply pipeline twice: fresh + existing local tenant on 5432). Control-plane DDL via `schema-diff.sh` against the **local** control-plane DB. **Discriminator on the shared `subscriptions` table so `subscription_renewal` only reminds legacy stubs** (`razorpay_subscription_id IS NULL`). Shared libs: `fulfilled-status.ts`, `entitlements.ts`, feature flags.

**P2 — Webhook tenant routing + shared `afterOrderCommitted`.** Wrap subscription/refund/paid handlers in `runWithTenantContext` (resolve tenant from notes **first**). **Non-2xx retry is per-branch** — only new subscription + digital-grant paths; existing payment_link/qr/transfer/refund keep their current 200-on-catch. Grant hook wired as a **no-op guard** (returns early until digital lines exist in P5). Own-key tenants: per-tenant endpoint `/webhooks/razorpay/[tenant]` verifying against that tenant's secret.

**P3 — Product admin + catalog gating.** ProductForm digital gating + server validation; vault-file upload API + storage driver (S3 + local); server guards on variant APIs, delete, feeds, inventory, **offline/POS/quotation routes**; stop the public `download_url` leak; digital storefront UX ("Open in vault", qty 1, no EDD). **Content-sniff uploads; force `Content-Disposition: attachment` + safe content-type on all presigned GETs.**

**P4 — Vault host + auth + UI.** Add `vault` to host resolution/middleware/reserved labels/provisioning. SSO handoff (single-use hashed ticket → host-only `vault_sid`). **Keep vault in the ECDSA key-binding gate** (mint the key in the SSO callback). **Replicate the `sess.tenantId !== tenant.tenantId` guard in the vault branch and assert it in every vault API.** **Explicit middleware guard so `STATIC_ASSET_RE` never short-circuits the vault host.** Library + viewers + ContentGuard + CSP.

**P5 — Digital order flow + `granted` everywhere.** Cart/checkout gating; order creation + lifecycle; `granted` added to **every** status site the review enumerated — including `admin/orders/[id]` route (stamp both `granted_at`+`delivered_at`), the admin orders **list** page + KPI, customer order-history **list** label/color maps, the **support chatbot** and **admin-agent tools** status enums. Documents/ops exclusion of digital lines. Partial/per-line refund → revoke only the refunded digital lines.

**P6 — Subscriptions.** Client selector + create/verify (**server derives amount/interval/account from the product row only; reject client-supplied price/interval**). `quarterly → Razorpay {period:'monthly', interval:3}`. First cycle is charged at authentication when `start_at` omitted → **`razorpay_payment_id` is the sole cycle idempotency key**; cycle number derived from the webhook payload. Cycle engine commits from `address_snapshot` (never a live address row). Self-service cancel-at-cycle-end/pause/resume/change-future-address; admin UI; campaign interplay; legal text. **Enforce RBI frictionless cap (₹15,000/cycle UPI Autopay) at subscribe time.**

**P7 — Hardening.** Signed webhook replay tests, live Route validation, CSP tightening, SEO noindex, churn/retention policy.

---

## 6. Local dev & test

Local DB **port 5432 only** (pipeline applied twice; control plane via `schema-diff.sh`). `VAULT_STORAGE_DRIVER=local` default (zero AWS, spied in tests). `MAIL_DISABLED=true`. `rzp_test_` keys. Route transfers can't run on test keys → guarded behind a live-key check; subscription cycles tested via a **signed webhook replay script**. Nothing touches live RDS / AWS / Razorpay-live.

---

## 7. Open questions for you (only these need a product-owner call)

1. **Guest buyers of digital goods.** Guest-checkout users have no real credential, so they could buy a digital item and never be able to open the vault. Options: (a) require real account creation (email+OTP) when the cart has a digital line, or (b) email a magic-link tied to the order. Recommend **(a)**.
2. **Platform-collect mandate branding.** For tenants on the platform Razorpay account, the UPI mandate will show "Jeffi" (the platform) as merchant, not the tenant. Acceptable for v1, or hold subscriptions for own-key tenants only until Route-on-subscription is validated on live keys?
3. **Legacy `subscription_renewal` campaign.** Retire it entirely (new model supersedes it), or keep it filtered to legacy stub rows only? Recommend **retire**.

Everything else is decided; I'll start at **P1** once you've answered these three.
