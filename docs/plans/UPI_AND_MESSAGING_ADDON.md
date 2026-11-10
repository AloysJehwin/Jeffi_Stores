# UPI payments and the SMS & WhatsApp add-on

Two features built together on `feat/feature-release`. This is the shared contract: module names, API shapes,
table columns and gating rules every part relies on. Decisions taken (2026-11-10): PhonePe Business as the
UPI provider (zero MDR on UPI, webhooks, status API, refunds); a store collecting on its own PhonePe account
or its own UPI ID pays no platform charges, exactly like `own_razorpay`; a manual "pay to UPI ID, enter UTR"
mode for stores without a PhonePe account; subscriptions use Razorpay UPI Autopay (recurring UPI needs a
mandate, which PhonePe enables per account later); the add-on is ₹500/month for one channel, ₹1,000 for both.

## 1. UPI

### 1.1 Provider: PhonePe PG v2 (Standard Checkout)

- Token: `POST {authBase}/v1/oauth/token` form-encoded `client_id, client_version, client_secret,
  grant_type=client_credentials` → `{ access_token, expires_at (epoch s), token_type: "O-Bearer" }`. Cache per
  client id until a minute before `expires_at`. Sandbox auth base `https://api-preprod.phonepe.com/apis/pg-sandbox`,
  production `https://api.phonepe.com/apis/identity-manager`.
- API base: sandbox `https://api-preprod.phonepe.com/apis/pg-sandbox`, production `https://api.phonepe.com/apis/pg`.
  Header `Authorization: O-Bearer <token>`.
- Create: `POST /checkout/v2/pay` `{ merchantOrderId (≤63, [A-Za-z0-9_-]), amount (paise, ≥100), expireAfter (300–3600 s),
  metaInfo: { udf1..udf5 }, paymentFlow: { type: 'PG_CHECKOUT', message, merchantUrls: { redirectUrl },
  paymentModeConfig: { enabledPaymentModes: [{type:'UPI_INTENT'},{type:'UPI_QR'},{type:'UPI_COLLECT'}] } } }`
  → `{ orderId, state: 'PENDING', expireAt, redirectUrl }`. The hosted page opens the UPI app on phones and shows a QR on desktop.
- Status (source of truth): `GET /checkout/v2/order/{merchantOrderId}/status?details=false&errorContext=true` →
  `{ orderId, state: 'PENDING'|'COMPLETED'|'FAILED', amount, expireAt, paymentDetails: [{ transactionId, paymentMode,
  state, amount, rail: { type:'UPI', utr?, upiTransactionId?, vpa? }, errorCode? }], errorContext? }`.
- Refund: `POST /payments/v2/refund` `{ merchantRefundId, originalMerchantOrderId, amount }` → `{ refundId, state, amount }`;
  `GET /payments/v2/refund/{merchantRefundId}/status` → `state PENDING|COMPLETED|FAILED`.
- Webhook: `Authorization` header equals `SHA256("<username>:<password>")` hex (credentials set on the PhonePe
  dashboard). Body `{ event, payload }`; events `checkout.order.completed`, `checkout.order.failed`,
  `checkout.transaction.attempt.failed`, `pg.refund.completed|failed|accepted`. Never trust the body's state:
  on every checkout event re-fetch the order status and settle from that.
- Platform env (`.env.example`): `PHONEPE_ENV=sandbox|production`, `PHONEPE_CLIENT_ID`, `PHONEPE_CLIENT_SECRET`,
  `PHONEPE_CLIENT_VERSION`, `PHONEPE_MERCHANT_ID` (display only), `PHONEPE_WEBHOOK_USERNAME`, `PHONEPE_WEBHOOK_PASSWORD`,
  `ENABLE_UPI=false`. Tenant own creds: `tenant_integration_credentials` provider `phonepe`, encrypted blob
  `{ env, client_id, client_secret, client_version, merchant_id, webhook_username, webhook_password }`.

### 1.2 Modes and credential resolution (`lib/payments/upi/creds.ts`)

`tenants.upi_mode` ∈ `platform | own | manual | off` (default `platform`).

- `platform`: platform PhonePe creds; the platform holds the money, books tenant share + commission in
  `tenant_transactions`/ledger (gateway `upi_platform`, no Route transfer), pays out through the existing payout flow.
- `own`: the tenant's PhonePe creds (`own` only when a decryptable blob exists, else falls back to `platform` with a
  warning, mirroring `resolveRazorpayCreds`); gateway `upi_own`, no platform charges.
- `manual`: no gateway. The customer pays to the store's UPI ID (`tenant_bank_accounts.upi_id`), enters the UTR,
  the order is placed unpaid with `payment_mode='upi_manual'`, staff approve or reject it. No platform charges.
- `off`: no UPI section.
- Flagship: platform creds. `upiAvailable(tenantId)` = Site Controls `feature_upi_enabled` && mode≠off &&
  (mode==='manual' ? has UPI ID : creds resolve).

### 1.3 Intents (`lib/payments/upi/intents.ts`) — store DB, `database/payments.sql`

```
upi_payment_intents (
  id uuid pk, tenant_id uuid null, provider varchar(16) 'phonepe'|'manual', mode varchar(12),
  purpose varchar(32) 'order_draft'|'order'|'order_adjustment'|'variant_change'|'wallet_topup'|'ecom_wallet_topup',
  amount_paise bigint, currency char(3) 'INR', merchant_order_id varchar(63) unique,
  provider_order_id text, provider_txn_id text, utr text, payer_vpa text,
  status varchar(24) 'pending'|'awaiting_confirmation'|'completed'|'failed'|'expired'|'rejected',
  redirect_url text, return_to text, refs jsonb (draftToken, orderId, adjustmentId, requestId, userId, adminId, ownerId, notes),
  result jsonb (orderId, orderNumber, balance), error_code text, expires_at, confirmed_at, decided_by uuid, decided_at,
  created_at, updated_at )
```
`merchant_order_id = 'JS' + id without dashes`. PK/CHECKs in `constraints.sql`, indexes (status+created_at, order ref) in `indexes.sql`.
Ecom-owner wallet intents live in the flagship/control-plane DB (controller-service), `tenant_id` = the owner's tenant.

### 1.4 Settlement (`lib/payments/upi/settle.ts`)

`settleUpiIntent(intentId | merchantOrderId)`: pending phonepe intent → status API → COMPLETED: `applyUpiPayment`
by purpose, in the store's tenant context:
- `order_draft`: commit the draft like `commitDraftFromCapture` (generalised: gateway `'phonepe'`, payment row
  `payment_method='upi'`, `transaction_id=transactionId`, `vpa`). The draft's `pending_payment_intents` row is keyed on
  `razorpay_order_id = merchant_order_id` (the column holds whichever gateway's order id).
- `order`: mark the order paid (`applyCapturedPayment`'s record branch, gateway `phonepe`).
- `order_adjustment` / `variant_change`: `settleAdjustmentPayment` / `settleVariantChangePayment` with the
  merchant order id in their `razorpay_order_id` column (set when the intent starts).
- `wallet_topup` / `ecom_wallet_topup`: `creditTopup({ paymentId: transactionId, paidPaise, notes })`, then
  `startStoreIfReady` for ecom.
Then `recordUpiCapturedPayment` → `recordCapturedPayment({ collectedOn: 'platform_upi' | 'own' })` (new
`CollectedOn` value: books share/commission in the ledger without a transfer). FAILED → `failed`; past `expires_at`
→ `expired`. Idempotent: an intent settles once.
Manual: `confirmManualUpi(intentId, utr)` → `awaiting_confirmation`; for `order_draft` the order is committed now
(unpaid, `payment_mode='upi_manual'`, UTR in `payments.gateway_response`), for `order` the UTR is recorded;
`decideManualUpi(intentId, 'approve'|'reject', adminId)` → approve runs the same paid path with
`transaction_id = utr`, reject sets `rejected` and leaves the order unpaid.
Refunds: `refundAcrossPayments` handles `payment_gateway='phonepe'` via the refund API (merchantRefundId
`RF<uuid-no-dashes>`), `upi_manual` payments refund as external (existing `recordExternalRefund`).
Sweep: `sweepUpiIntents()` settles pending phonepe intents 2 min–24 h old; cron `/api/cron/upi-sweep` (admin-service),
registered in `lib/shared/cron-jobs.ts`.

### 1.5 HTTP (handlers in `lib/payments/upi/handlers.ts`, thin route files per service)

- `POST /api/payments/upi/start` — body `{ purpose, draftToken?, orderId?, adjustmentId?, requestId?, amountInr?, returnTo? }`.
  Auth: customer (storefront; the business portal reaches it with X-Auth-Portal). Wallet top-ups use the same handlers
  under paths their host routes to them: `/api/admin/financial/wallet/topup/upi/{start,[intentId]}` (admin-service)
  and `/api/ecom/wallet/topup/upi/{start,[intentId]}` (controller); every other `/api/` path goes to the storefront.
  → `{ intentId, mode: 'phonepe'|'manual', amountPaise, redirectUrl?, manual?: { vpa, payeeName, upiUri, qrDataUrl, reference } }`.
  The amount is computed server-side exactly as `/api/razorpay/create-order` does for the same inputs.
- `GET /api/payments/upi/[intentId]` → `{ status, purpose, result?, returnTo }` (settles a pending intent first).
- `POST /api/payments/upi/[intentId]/confirm` `{ utr }` (manual only).
- `POST /api/webhooks/upi` (platform creds) and `POST /api/webhooks/upi/[tenant]` (own creds), storefront-service; a
  store with its own pods gets an ingress for its `/api/webhooks/upi/<slug>` on the platform host, like Razorpay's.
  `metaInfo.udf1` = tenant id or `cp` (control-plane intent), `udf2` = purpose, `udf3` = intent id.
- Admin: `GET /api/admin/payments/upi?status=awaiting_confirmation`, `POST /api/admin/payments/upi/[intentId]/decide`
  `{ action: 'approve'|'reject' }` (list `financial:read`, decide `financial:write`).
- Return page `/pay/upi/[intentId]/return` in storefront, business, admin and controller: polls the GET, then
  redirects to `returnTo` (order page, wallet, …).

### 1.6 Browser (`components/payments/`)

- `PaymentSections` — "UPI" and "Other payment methods" sections (COD / manual business payment where the page has
  them), radio selection, the host page keeps its pay button. Props `{ amountInr, upi, razorpay, cod?, manual?, value, onChange }`.
- `useUpiPayment({ returnTo })` → `{ start(body), busy, manual, confirmUtr(utr), error }`: phonepe → `location.href = redirectUrl`;
  manual → `UpiManualDialog` (QR of `upiUri`, copyable UPI ID, UTR input).
- `razorpayDisplayConfig({ hideUpi })` → Razorpay `config.display` hiding UPI whenever a UPI section is shown, so the
  two sections never overlap; for subscriptions `upiAutopayDisplayConfig()` shows only UPI (Autopay) and the
  "Other" section hides it.
- `UpiReturnClient` for the return pages.
- Flags: `SiteControls.flags.upiEnabled` (`feature_upi_enabled`, default `ENABLE_UPI`), `StoreConfig.flags.upiEnabled`,
  `/api/feature-flags.upiEnabled`; mobile reads the same flag.
- Screens: storefront checkout, B2B `CheckoutReviewPage`, storefront + business order pay-now, variant-change collect,
  admin `WalletClient`, ecom `WalletClient`, ecom `PaymentTrigger`/`BillingClient` (Autopay), `SubscribeCheckout`,
  mobile checkout payment + order pay-now (opens `redirectUrl` in the system browser, then polls).
- Invoice/quotation QR: unchanged on Razorpay modes (already a UPI QR); a `manual` store gets a static QR of its UPI ID
  with the amount and order number.

### 1.7 Tenant settings

- Onboarding bank step: UPI ID field (`tenant_bank_accounts.upi_id`, through `/api/ecom/bank/verify`).
- Store admin Integrations: PhonePe card (env, client id/secret/version, merchant id, webhook username/password; shows the
  webhook URL) — `/api/admin/integrations/phonepe` like the Razorpay card; owner payouts page shows/edit the UPI ID.
- Flagship admin, Ecom Store → Billing: "UPI collection" (`UpiModeToggle`, `PATCH /api/admin/ecom/[tenantId]/upi-mode`);
  `own` refused without stored creds, `manual` refused without a UPI ID.
- Admin Financial → "UPI confirmations" page: awaiting-confirmation intents with approve/reject.

## 2. SMS & WhatsApp add-on

### 2.1 Control plane (`database/control-plane/schema.sql`)

```
ALTER TABLE tenants ADD COLUMN messaging_addon varchar(8) NOT NULL DEFAULT 'none'  -- none|sms|whatsapp|both
                   ADD COLUMN messaging_addon_until timestamptz, ADD COLUMN messaging_addon_renew boolean NOT NULL DEFAULT false;
tenant_messaging_senders ( id uuid pk, tenant_id uuid, channel varchar(10) 'sms'|'whatsapp', provider varchar(16) 'twilio'|'aws',
  sender varchar(120) -- DLT header or WhatsApp number, config_enc text, meta jsonb, status varchar(16) 'active'|'disabled',
  created_by varchar(255), created_at, updated_at, UNIQUE (tenant_id, channel) )
```
Credential blobs (AES-GCM via `token-cipher`): twilio `{ account_sid, auth_token?, api_key_sid?, api_key_secret?, messaging_service_sid? }`;
aws `{ region, access_key_id, secret_access_key, whatsapp_phone_number_id?, waba_id?, sms_origination?, dlt_entity_id?, configuration_set? }`.

### 2.2 `lib/billing/messaging-addon.ts` (pattern: `lib/billing/ad-free.ts`)

`MessagingTier = 'sms'|'whatsapp'|'both'`, `MESSAGING_ADDON_PRICE_INR = { sms: 500, whatsapp: 500, both: 1000 }`,
`getMessagingAddon`, `buyMessagingAddonMonth(tenantId, { tier, renew, reason })` (wallet debit, category `messaging_addon`,
externalRef `messaging_addon:<tenant>:<periodKey>`; changing tier mid-period starts a new period from now),
`setMessagingAddonRenew`, `tenantsDueForMessagingAddonRenewal`, cron `/api/cron/messaging-addon-renew` (controller).
`messagingEntitlement(tenantId)` → `{ sms: 'ok'|'addon'|'number', whatsapp: same }` — `addon` when the active tier doesn't
cover the channel, `number` when it does but no active sender row exists; flagship always `ok`; 60 s cache,
`invalidateMessagingEntitlement`.
`lib/messaging/tenant-senders.ts`: `getTenantSender`, `listTenantSenders`, `saveTenantSender`, `deleteTenantSender`.

### 2.3 Gating

- `getSiteControls()` (tenant stores only): `flags.smsEnabled/whatsappEnabled` forced false while locked and
  `locks: { sms?: 'addon'|'number', whatsapp?: … }` added to `SiteControls`. Everything downstream (`getFeatureFlags`,
  `/api/feature-flags`, `useMessagingChannels`, composer, templates, campaigns, customer panels, storefront/app login
  OTP channels, `sendByTemplate`, `sms.ts`, `whatsapp.ts`, `phone-otp-delivery`) therefore hides and refuses the channel.
- Site Controls page: the two switches get `locked`/`lockedHint` — "Add SMS & WhatsApp in the ecom portal (Billing)" or
  "Waiting for your number to be assigned". `PATCH /api/admin/settings` refuses turning a locked channel on (409).
- messaging-service `channelsOff`: locked channels (control-plane query, 30 s cache) → `SendError(409, 'channel_locked')`.
- Setup guide SMS/WhatsApp steps say why they're locked.
- Flagship exempt.

### 2.4 Ecom portal and flagship admin

- Billing page `MessagingAddonCard`: pick SMS / WhatsApp / Both, price, wallet balance, buy, auto-renew; API
  `GET/POST /api/ecom/billing/messaging-addon` `{ action: 'buy', tier } | { action: 'renew_on'|'renew_off' }`.
- Flagship Ecom Store → Billing: "SMS & WhatsApp numbers" section — add-on status; per channel a form (provider,
  sender, credentials), save/replace/delete; `GET/PUT/DELETE /api/admin/ecom/[tenantId]/messaging-senders/[channel]`,
  platform admins only; secrets never returned (masked meta only).

### 2.5 Sending with a tenant's own sender

messaging-service resolves `tenant_messaging_senders` (decrypted with the same cipher, `SOCIAL_TOKEN_ENC_KEY`) and
passes the sender + credentials into the Twilio / AWS providers; the platform env is used only when the tenant has no row.
Store-core's inline providers (`lib/shared/messaging/twilio-provider.ts`, `aws-provider.ts`) do the same.
