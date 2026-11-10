# UPI v2: UPG (our own UPI gateway) + PhonePe

Supersedes the mode model in [UPI_AND_MESSAGING_ADDON.md](UPI_AND_MESSAGING_ADDON.md) §1.2 and §1.7 (platform / own / manual).
Everything not mentioned here (intents, settlement, return pages, PaymentSections, the confirmations page) stays and is reused.

UPG mirrors the open-source YouPI-PG gateway's checkout and lifecycle (one payer per UPI ID at a time, FIFO
queue, 5-minute pay window, "Payment done — check my payment", 30-second verification, UTR fallback for staff
review). YouPI-PG itself is not used: it has no license and needs a phone or Google's restricted Gmail scope.
Our observer is the merchant's bank credit-alert emails, auto-forwarded to our existing SES inbound domain.

## 1. Provider model

A **collecting merchant** is the platform (the flagship store, and every payment made *to* the platform) or a store.
Each has one UPI provider, chosen automatically (`resolveUpiProvider(merchant)` in `lib/payments/upi/creds.ts`):

1. `phonepe` — its PhonePe credentials are saved. Store: `tenant_integration_credentials` provider `phonepe` for its
   tenant id (as today). Platform: the same table under `PLATFORM_TENANT_ID`, falling back to env `PHONEPE_*`.
2. `upg` — no PhonePe, but it has a UPI ID. Store: `getTenantUpiId(tenantId)` (control-plane bank details). Platform:
   flagship site setting `upi_vpa`, falling back to env `RAZORPAY_UPI_VPA`.
3. `none` — UPI hidden.

Kill switches, all must allow: env `ENABLE_UPI` (platform), the merchant's Site Controls `feature_upi_enabled`, and for
stores the platform admin's `tenants.upi_mode` — now `'auto' | 'off'` (default `'auto'`; replaces
`platform|own|manual|off`; existing rows map `off`→`off`, everything else→`auto`).

Saving PhonePe credentials switches that merchant to PhonePe at once (no platform approval); removing them switches it
back to UPG. Stores **never** collect UPI on the platform's account any more: delete the `'platform'` mode, the
`upi_platform` gateway, `CollectedOn 'platform_upi'` and its share/Route handling. A store's UPI money always goes
straight to the store; no platform charges on it (same as own Razorpay).

Platform-paid purposes (`wallet_topup` from a store admin, `ecom_wallet_topup`) collect on the platform's provider, and
their intents live in the **flagship DB**, so one queue serves the platform UPI ID. The admin status/confirm routes for
wallet top-ups read and write there.

Order gateways: `upi_phonepe` (was `upi_own`), `upi_upg` (auto-verified from a bank alert), `upi_manual` (UTR approved by
staff). Intent `provider`: `'phonepe' | 'upg'` (`'manual'` goes away: a UPG intent whose UTR staff approve settles as
`upi_manual`). Intent `mode` column is dropped or left unused — no platform/own distinction remains.

## 2. UPG sessions (mirror YouPI-PG)

New intent columns (`database/payments.sql`; constraints/indexes in their files; apply to the local DB only):
`receiving_vpa text`, `active_at timestamptz`, `pay_expires_at timestamptz`, `processing_at timestamptz`,
`verify_expires_at timestamptz`, `observation_id uuid`, `cancelled_at timestamptz`.

Statuses for UPG intents: `queued → active → processing → completed`, with `active → expired` (5:00 elapsed),
`active|queued → cancelled`, `processing → failed` (30 s, no match), `failed|expired → awaiting_confirmation` (customer
submits a UTR) `→ completed | rejected` (staff). PhonePe intents keep `pending → completed | failed | expired`.

- **One payer per UPI ID:** at most one intent `active` or `processing` per `receiving_vpa` (partial unique index).
  Others are `queued`, FIFO by `created_at`; `queuePosition` = 1 + queued intents ahead of it.
- **Promotion** is atomic (advisory lock on the VPA, or `FOR UPDATE SKIP LOCKED`): on create when the slot is free, on any
  terminal transition, lazily on every status read (clients poll every 2 s), and in the existing `upi_sweep` cron.
  Promotion sets `active_at = now()`, `pay_expires_at = now() + 5 min`.
- **Timers are server-side** (`UPG_PAY_SECONDS=300`, `UPG_VERIFY_SECONDS=30`); expiry is applied on read and by the sweep.
- **"Payment done — check my payment"** moves `active → processing` (`verify_expires_at = now() + 30 s`).
- **A matching bank alert completes the intent** whether it is `active` or `processing` (no click needed), settling it
  as `upi_upg` through the existing settle path.
- **Late alert:** email forwarding can lag. An alert matching a `failed` or `expired` intent of the same VPA and exact
  amount within 15 minutes, with no other open intent of that amount in the meantime, still completes it. This is
  the one addition to YouPI-PG's behaviour.
- **UTR fallback:** after `failed`/`expired` the customer may enter the UTR → `awaiting_confirmation` → the existing
  Finance → UPI Confirmations page. If a trusted alert with that UTR has already been observed, complete at once.

## 3. Bank alerts (the observer)

Table `upi_bank_observations` (same DB as the merchant's intents): `id, receiving_vpa, amount_paise, utr, sender_vpa,
bank_domain, ses_message_id, message_id, fingerprint, trusted bool, subject, observed_at, matched_intent_id,
created_at`. Unique on `fingerprint` = sha256(receiving_vpa | amount_paise | utr | 10-min bucket) and on `utr` (when set).

- **Address:** `upi+<slug>.<token>@<REPLY_MAIL_DOMAIN>` (same domain as customer replies), token = first 12 hex of
  HMAC-SHA256(`UPG_ALERT_SECRET`, slug). The flagship uses its own slug. The existing controller
  `/api/webhooks/ses-inbound` routes `upi+` recipients to the UPG handler, inside that store's tenant context
  (as it does for `reply+`); everything else is unchanged.
- **Trust:** auto-confirm only when (a) the From domain is a bank (`*.bank.in`, or the legacy list —
  hdfcbank.net/com, icicibank.com, sbi.co.in, axisbank.com, kotak.com, yesbank.in, idfcfirstbank.com, indusind.com,
  pnb.co.in, bankofbaroda.co.in/com, canarabank.com, unionbankofindia.co.in, federalbank.co.in, aubank.in, rblbank.com,
  idbibank.co.in, bandhanbank.com; subdomains included), and (b) that domain's DKIM signature verifies, or Gmail's ARC
  seal (cv=pass, d=google.com) records dkim=pass for it. Use the `mailauth` package (add it). Anything else is stored
  `trusted=false`: shown to staff, never auto-confirms.
- **Parse:** credit vs debit (ignore debits), amount, UTR (12-digit UPI ref), sender VPA. Bank-specific patterns for
  the banks above plus a generic fallback; unit tests over sample alert texts.
- **Match:** strict `amount_paise` equality against the merchant's `active`/`processing` intent on that VPA (at most one
  by construction), then the late-alert rule.
- **Gmail forwarding confirmation:** mail from `forwarding-noreply@google.com` to the address is stored (code + link,
  latest per merchant) and shown in Site Controls so the owner can confirm forwarding.

## 4. HTTP

Handlers in `lib/payments/upi/handlers.ts`; same route bases as today (storefront `/api/payments/upi`, admin wallet
`/api/admin/financial/wallet/topup/upi`, ecom wallet `/api/ecom/wallet/topup/upi`).

- `POST …/start` → PhonePe: `{ intentId, mode: 'phonepe', amountPaise, redirectUrl }` (unchanged).
  UPG: `{ intentId, mode: 'upg', amountPaise, checkoutUrl }`, `checkoutUrl` = the host's `/pay/upi/<id>` page
  (`returnPrefix` + `/pay/upi/<id>`).
- `GET …/<id>` → adds, for UPG: `{ queuePosition, payExpiresAt, verifyExpiresAt, serverNow, payee: { vpa, name },
  upiUri, qrDataUrl }` (`upiUri`/`qrDataUrl` only while `active`/`processing`; `tn` = the store name + short reference).
- `POST …/<id>/check` → `active → processing`.
- `POST …/<id>/cancel` → `cancelled` (slot released).
- `POST …/<id>/confirm` `{ utr }` → allowed on `failed`/`expired` UPG intents.
- Admin: `GET /api/admin/payments/upi` and `/decide` unchanged; the list also shows untrusted observations' suggestions.
- `GET /api/admin/integrations/upi` (financial:read) → what Site Controls shows:
  `{ provider: 'phonepe'|'upg'|'none', killed: boolean, reason?, vpa, vpaEditable, alerts: { address, connected,
  lastAlertAt, trustedCount30d, gmailConfirmation?: { code, link, at } }, phonepe: <today's PhonePeAccountInfo, now
  editable for the platform too> }`. `PUT …/upi/vpa` `{ vpa }` (store owner / platform owner, financial:write).
  PhonePe credential routes stay at `/api/admin/integrations/phonepe`, now also accepting the platform.

## 5. Checkout page `/pay/upi/<id>` (storefront; business `/business/pay/upi/<id>`; admin `/admin/pay/upi/<id>`; ecom `/pay/upi/<id>` on the ecom host)

YouPI-PG's screen, on our design system, polling the status every 2 s:

- **Queued:** "You're #N in line" with the live position and a cancel button.
- **Active:** amount, payee name and UPI ID, 5:00 countdown, the QR (large on desktop). On phones, app buttons that open
  the app with everything filled in: Google Pay (`tez://upi/pay?…`, iOS `gpay://upi/pay?…`), PhonePe (`phonepe://pay?…`),
  Paytm (`paytmmp://pay?…`), and "Other UPI app" (`upi://pay?…`; on Android a chooser via the plain upi:// link). Then
  **Payment done — check my payment** and Cancel.
- **Processing:** "Checking with your bank…" with the 30-second countdown.
- **Completed:** redirect to the intent's return target (same as the return page).
- **Failed / expired:** "We couldn't see your payment yet" + UTR form (→ awaiting confirmation) + Try again.
- **Awaiting confirmation:** the existing "Payment noted" state.

The PhonePe return page `/pay/upi/<id>/return` stays as it is.

## 6. Subscriptions

Subscription checkouts show the UPI section only when the store's provider is `phonepe`, using **PhonePe Autopay**
(mandate set up at sign-up; each renewal: notify ≥24 h before, then execute; cancel/pause through PhonePe). With UPG
or none, the UPI section is hidden there and Razorpay subscriptions are unchanged.

## 7. Settings UI

- **Site Controls → Payments & tax → UPI collection card** (store and flagship): provider in effect and why; UPI ID
  (editable by the owner); bank alerts — the forwarding address with a copy button, step-by-step Gmail auto-forward
  instructions (add forwarding address → paste the Gmail confirmation code we show → filter: from your bank, has
  "credited", forward to the address), last alert time and a connected badge; PhonePe credentials (saving switches to
  PhonePe, removing switches back).
- **Ecom Store → Billing → UPI collection:** on/off only (`tenants.upi_mode` auto|off).

## 8. Mobile app

The Expo checkout gets the same UPG screen (queue, timer, QR, app buttons via `Linking.openURL`, check button, UTR
fallback) against the same API.
