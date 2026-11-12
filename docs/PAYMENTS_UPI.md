# UPI payments

How a merchant collects UPI. The build contract (API shapes, sessions, bank alerts) is
`docs/plans/UPI_UPG_V2.md`; this page is the operator's view. v1's platform / own / manual modes are gone.

## Provider — chosen automatically

A collecting merchant is a store, or the platform (the flagship store and everything paid *to* the
platform: wallet top-ups). `resolveUpiProvider` (`lib/payments/upi/creds.ts`):

| Provider | When | How a payment is confirmed |
| --- | --- | --- |
| `phonepe` | PhonePe credentials are saved (`tenant_integration_credentials` provider `phonepe`; the platform's under the nil tenant id, else env `PHONEPE_*`) | PhonePe's hosted page; webhook + status API |
| `upg` | No PhonePe, but a UPI ID (store: `tenant_bank_accounts.upi_id`; platform: site setting `upi_vpa`, else env `RAZORPAY_UPI_VPA`) | The customer pays the UPI ID; the bank's credit-alert email confirms it. Fallback: the customer's UTR, approved by staff |
| `none` | Neither | UPI is hidden |

Saving PhonePe credentials switches the merchant to PhonePe at once; removing them switches it back. A
store's UPI money always goes straight to the store: no platform account, commission or Route transfer
(`tenant_transactions.gateway` = `upi_phonepe` | `upi_upg` | `upi_manual`, booked like own Razorpay).

Kill switches, any one stops UPI: env `ENABLE_UPI` set to an explicit false (platform-wide), the merchant's
Site Controls `feature_upi_enabled`, and for a store `tenants.upi_mode = 'off'` (`'auto' | 'off'`, set by a
platform administrator under Ecom Store → Billing → UPI collection, `PATCH /api/admin/ecom/[tenantId]/upi-mode`
`{ mode }`).

## UPG sessions

One payer per UPI ID at a time (partial unique index on `upi_payment_intents.receiving_vpa`); others queue
FIFO. Statuses: `queued → active → processing → completed`; `active → expired` after `UPG_PAY_SECONDS` (300);
`processing → failed` after `UPG_VERIFY_SECONDS` (30); `queued|active → cancelled`; `failed|expired →
awaiting_confirmation → completed|rejected`. Timers are server-side and applied on every status read and by
the `upi_sweep` cron, which also promotes the next in line.

- `POST …/start` → `{ intentId, mode: 'upg', amountPaise, checkoutUrl }` (`/pay/upi/<id>` on the caller's host).
- `GET …/<id>` → status plus `queuePosition, payExpiresAt, verifyExpiresAt, serverNow, payee, upiUri, qrDataUrl`.
- `POST …/<id>/check` (active → processing), `/cancel`, `/confirm { utr }` (failed / expired only).
- Bases: storefront `/api/payments/upi`, store admin `/api/admin/financial/wallet/topup/upi`, ecom portal
  `/api/ecom/wallet/topup/upi`. Wallet top-ups pay the platform, so their intents live in the flagship DB and
  share the platform UPI ID's queue.

A UTR waiting for staff shows under Financial → **UPI confirmations** (`GET /api/admin/payments/upi`,
`POST …/[intentId]/decide`); rows carry `suggestions` — bank credits of the same amount or UTR that could not
be auto-confirmed. Approving pays the order with the UTR as the transaction id (`upi_manual`). UPG and manual
payments cannot be refunded through a gateway: send the money back and record an external refund.

## Bank alerts (how UPG confirms a payment)

Each merchant has a forwarding address `upi+<slug>.<token>@<REPLY_MAIL_DOMAIN>` (token = HMAC of the slug with
`UPG_ALERT_SECRET`; the flagship's slug is `platform`). The owner sets a Gmail filter to auto-forward the bank's
credit alerts to it (Site Controls → UPI collection shows the address, the steps, and Gmail's confirmation
code and link once Gmail sends them). SES receives the mail on the existing inbound domain;
`/api/webhooks/ses-inbound` hands `upi+` recipients to `handleUpgAlertEmail` (`lib/payments/upi/alerts.ts`)
in that store's context.

- **Trusted** only when From is a bank domain (`*.bank.in` or the list in `alert-parse.ts`) and that bank's
  DKIM signature verifies, or Gmail's ARC seal (chain passes, `d=google.com`) records `dkim=pass` for it
  (`mailauth`). Anything else is stored `trusted=false`: staff see it as a suggestion, it never confirms.
- **Parsed**: credit vs debit (debits ignored), amount, 12-digit UPI reference, sender UPI ID — per-bank
  patterns plus a generic fallback. Stored once in `upi_bank_observations` (unique fingerprint and UTR).
- **Matched** by exact amount to the intent `active` / `processing` on that UPI ID; else, for forwarding lag,
  to a `failed` / `expired` intent of that amount that ended within 15 minutes with no other intent of that
  amount open or shown since; else to an `awaiting_confirmation` intent with the same UTR.

## PhonePe credentials

Site Controls → Payments & tax → **UPI collection**, store owner (or the platform owner on the flagship) with
`financial:write`: environment, client id, secret, version, merchant id, webhook username and password.
Checked against PhonePe's OAuth endpoint before saving; stored AES-GCM encrypted; only masked values are
shown again. API: `GET/PUT/DELETE /api/admin/integrations/phonepe`, `POST …/phonepe?action=test`. The card
itself reads `GET /api/admin/integrations/upi`; the UPI ID is changed with `PUT /api/admin/integrations/upi/vpa`
(owner only; a store needs its settlement bank account first).

Webhook URLs (storefront-service), `Authorization` = `SHA256("username:password")`:

- Platform account: `${PUBLIC_WEBHOOK_BASE_URL}/api/webhooks/upi`
- A store's account: `${PUBLIC_WEBHOOK_BASE_URL}/api/webhooks/upi/{slug}`

The handler never trusts the body's state: it re-fetches the order status from PhonePe and settles from that.

## Environment

`ENABLE_UPI`, `PHONEPE_*` (platform fallback), `RAZORPAY_UPI_VPA` (platform UPI ID fallback),
`UPG_ALERT_SECRET` (required for bank-alert addresses), `UPG_PAY_SECONDS`, `UPG_VERIFY_SECONDS`,
`REPLY_MAIL_DOMAIN`. See `.env.example`.

## Where things are

- `lib/payments/upi/`: `creds.ts` (provider, kill switches), `service.ts` (start), `upg.ts` + `upg-logic.ts`
  (sessions, queue, matching), `alerts.ts` + `alert-parse.ts` (bank alerts), `settle.ts` (completion, UTR
  fallback, sweep), `handlers.ts` (HTTP), `settings.ts` (Site Controls API), `webhook.ts` (PhonePe).
- Schema: `upi_payment_intents`, `upi_bank_observations` (`admin-service/database/tables/payments.sql`), `tenants.upi_mode`
  (`controller-service/database/control-plane/`).
- Flagship admin: `UpiModeToggle` on the Billing view page. Store admin: `UpiCollectionCard`.
- Owner portal: onboarding bank step and the Payouts page set the UPI ID (`PATCH /api/ecom/bank/upi`).

## PhonePe Autopay (customer subscriptions)

A subscription checkout shows the UPI section only when the store's UPI provider is `phonepe`
(`docs/plans/UPI_UPG_V2.md` §6). With UPG or no UPI the section is hidden and Razorpay Subscriptions are
unchanged. **Autopay must be enabled on the merchant's PhonePe Business account** (PhonePe turns it on per
account); until then mandate setup is rejected and the customer is told to pick another method.

- **What bills a subscription:** `subscriptions.billing_provider` (`razorpay` | `phonepe`), with
  `phonepe_merchant_subscription_id` (ours, `SUB-<id>`), `phonepe_subscription_id`, `phonepe_setup_order_id`,
  `phonepe_mandate_state`, `phonepe_mandate_expires_at`. Each renewal attempt is a `subscription_redemptions`
  row (`notifying → notified → executing → completed | failed | cancelled`, one open row per subscription).
- **Sign-up:** `POST /api/subscriptions` with `method: 'upi_autopay'` creates the local row (`created`) and a
  mandate setup (`POST /checkout/v2/pay`, `paymentFlow.type = SUBSCRIPTION_CHECKOUT_SETUP`, `authWorkflowType
  TRANSACTION`, `amountType FIXED`, frequency from our interval, mandate end = last cycle + 7 days) and returns
  PhonePe's `redirectUrl`. The first cycle is paid on that page. PhonePe returns to `/subscribe/return?sub=<id>`
  (`/business/subscribe/return`), which polls `GET /api/subscriptions/autopay/<id>`; that reads the setup order
  from PhonePe and, when it is `COMPLETED`, commits cycle 1 and sets the subscription `active`. The
  `/quote` response carries `upiAutopay: true` when the section should show.
- **Renewals:** cron `subscription_renewals` (`/api/cron/subscription-renewals`, every 30 min, per store). 36 h
  before `current_end` it re-reads the mandate, then sends the pre-debit notification
  (`POST /checkout/v2/subscriptions/notify`, `autoDebit: false`, retry strategy `STANDARD`). Once PhonePe reports
  `NOTIFIED`, the debit may run at the later of the due date, 24 h after the notification and PhonePe's
  `validAfter`; the cron then calls `POST /checkout/v2/subscriptions/redeem`. A `COMPLETED` redemption mints the
  cycle's order through the same `commitCycle` the Razorpay charge path uses (payment `upi` / `phonepe`, keyed
  by PhonePe's transaction id). A `FAILED` one (PhonePe has already retried inside its 48 h window) sets the
  subscription `halted` and sends the payment-failed email, as when Razorpay's retries run out. The customer
  (My subscriptions → Retry payment) or an admin can resume a halted subscription; the next run notifies again.
- **Cancel:** `POST /checkout/v2/subscriptions/{merchantSubscriptionId}/cancel` at once in both cases, so no
  further debit is possible; a cycle-end cancel keeps the paid period and the cron ends it at `current_end`.
- **Pause:** PhonePe has no merchant pause API. Pausing from the account or the admin stops our notifications
  and debits and keeps the mandate; resuming checks the mandate is still `ACTIVE`. A customer can also pause or
  revoke the mandate in their UPI app: the webhook (or the next renewal run) mirrors it (`PAUSED` → paused,
  `REVOKED` / `CANCELLED` → cancelled, `EXPIRED` → expired).
- **Webhooks:** on the same PhonePe webhook URL, add the subscription events (`subscription.notification.*`,
  `subscription.redemption.order.*`, `subscription.redemption.transaction.*`, `subscription.paused`,
  `subscription.unpaused`, `subscription.revoked`, `subscription.cancelled`) next to the checkout ones.
  `handleAutopayWebhook` (`lib/payments/upi/autopay-webhook.ts`) handles them and the setup order's
  `checkout.order.*`; it never trusts the body and re-reads the order or mandate from PhonePe. The cron covers
  a lost webhook.
- **Code:** API client `lib/payments/upi/autopay.ts`; sign-up, renewals and state changes
  `lib/subscriptions/autopay.ts`; the timing rules `lib/subscriptions/autopay-schedule.ts`.
