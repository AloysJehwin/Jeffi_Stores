# YouPI-PG as Jeffi's UPI gateway: requirements

Research note, 2026-11-24. Sources: YouPI-PG `main` at `405327c` (2026-11-01), https://github.com/youpi-pg/YouPI-PG, read but never run; our `packages/store-core/src/lib/payments/upi/*`, `docs/PAYMENTS_UPI.md`, `docs/plans/UPI_UPG_V2.md`. Nothing in the repo was changed.

## Bottom line

- **We already run YouPI-PG's design.** Our UPG provider is a port of YouPI-PG's lifecycle: one payer per UPI ID, FIFO queue, 5-minute pay window, 30-second check, UTR fallback (`docs/plans/UPI_UPG_V2.md` §2). We did not take the code at the time because it had no license and needed a phone or Google's restricted Gmail scope (same doc, line 8). Both reasons still hold.
- **It cannot replace PhonePe.** PhonePe gives us a PSP-confirmed status API, refunds, Autopay mandates and unlimited concurrent payers. YouPI-PG has none of these. It can only replace UPG, which already does the same job with stronger email authentication.
- **No license.** The README links to a `LICENSE` file that is not in the repo. GitHub reports no license, and the root `package.json` says `"license": "Commercial"`. Without a grant we have no right to deploy or modify the code.
- **The authors say it is not production-ready.** README: "Research Project — Experimental Use Only", with at most 20 payments a day per receiving account. `SECURITY_AUDIT.md`: "NOT APPROVED FOR REAL-MONEY PRODUCTION".
- **Recommendation:** do not adopt it. Keep PhonePe (preferred) and UPG (fallback), and borrow two YouPI ideas into UPG (see Phased plan).

## 1. What it is and how a payment flows

It is a Node 24 monorepo of about 15k lines of JS: `packages/core`, `db` and `common`, seven apps (`payment-api` :6100, `checkout-portal` :7000, `merchant-admin` :6001, `gmail-observer`, `sms-observer`, `control-center`, a demo store) and an Android observer APK. Everything runs in one container under a supervisor (`Dockerfile` runs `node scripts/start.js`).

Flow (`ARCHITECTURE.md` §2, §4):
1. The merchant server calls `POST /api/v1/payments` with merchant id, key, `Idempotency-Key`, `orderId` and `amount`, and gets back a checkout URL (`apps/payment-api/src/routes/payments.routes.js`).
2. The buyer verifies by **WhatsApp OTP**, sent through the unofficial `berryprotocol` (Baileys-style) socket (`apps/payment-api/src/services/whatsapp-berry.service.js`).
3. The buyer takes the slot on the receiving VPA or waits in the queue. Once active, the checkout shows a `upi://pay?pa=…&am=…` QR or app intent. Payments are push only: no collect request and no PSP.
4. The buyer pays into the merchant's own account, taps "Payment done", and a 30-second check starts.
5. **Detection comes from bank alerts only**: the Android app (bank SMS via `READ_SMS` and app notifications, HMAC-signed), Gmail (OAuth `gmail.readonly` or headless-Chrome scraping), or Google Messages for Web scraping. A credit whose amount exactly equals the active session's amount completes it (`packages/core/src/attribution-engine.js`).
6. The gateway sends `OBSERVED_SUCCESS` (`settlementState: NOT_RECONCILED`) to the merchant. The webhook is HMAC-signed (V2 binds a timestamp) and delivered at least once from an outbox, with `X-Gateway-Delivery-Id` for deduplication. `RECONCILED` comes only after an operator imports a bank statement CSV (`packages/core/src/statement-reconciliation.js`).

**Reliability.** By its own contract an alert is not proof of payment: the README tells merchants to fulfil only on `RECONCILED`. Matching uses the amount alone, protected only by the single slot and a 30-minute late window.

The Gmail path trusts the `From` domain only. It runs no DKIM or ARC check, accepts a message with no `From`, and allow-lists `test` (`apps/gmail-observer/src/parser.js`, `gmail-poller.js:286`). Our `alerts.ts` requires a bank DKIM signature or a passing Gmail ARC seal.

The fraud filter is a keyword regex (`/attack/i`, `/exploit/i`). The only runtime database is SQLite (`packages/db/src/database.js`); the Postgres `schema.sql` is not wired to anything.

## 2. What we must provide

### Infrastructure (k3s)
- **One StatefulSet with one replica and a PVC for `/app/data`** (SQLite WAL file and `data/.secrets`). SQLite has one writer, so there is no HA and a pod restart takes UPI down.
- **Ingress for checkout and API**, for example `pay.jeffistores.in`. Admin and observers stay internal.
- **Secrets:** `ENCRYPTION_MASTER_KEY`, `JWT_SECRET`, `ADMIN_API_TOKEN`, `ANDROID_ENROLLMENT_SECRET`, Gmail OAuth client.
- **SQLite backups to S3** with a restore drill, plus a Chromium sidecar if the scraping observers are used (the alpine image has no browser).
- **Monitoring** for the webhook outbox and observer heartbeats. No queue service is needed: the queue lives in SQLite.

### Banking
- **Each collecting merchant needs a current account with a merchant (P2M) VPA or QR from its bank.** YouPI accepts any VPA, but business collections on a personal (P2P) savings VPA can breach bank terms and trigger freezes. UPI apps also commonly cap or warn on intent or QR payments to non-merchant VPAs.
- **No bank or PSP partnership is needed.** That is also why there is no settlement API, refund API or status API.
- **Per account:** a phone with the bank SIM running a sideloaded APK (a prebuilt binary is checked into the repo), and/or a Google account that receives the bank's alert emails.

### Legal and compliance
- **Collecting for tenants makes us a payment aggregator.** If tenants' customers paid into a Jeffi account and we passed the money on, we would need RBI authorisation as a PA under the PSS Act 2007 (March 2020 PA/PG guidelines, since consolidated): about ₹15 cr net worth at application (₹25 cr by year 3), an escrow account at a scheduled bank, merchant due diligence and settlement rules. Operating without it is an offence, and YouPI's README forbids pooling or collecting for unrelated merchants.
- **Each tenant using its own VPA (today's model) keeps us a technology provider:** "A store's UPI money always goes straight to the store" (`docs/PAYMENTS_UPI.md`). YouPI fits only with one receiving account per tenant. Flagship sales and wallet top-ups are our own receipts.
- **GST is unchanged.** Since we never hold tenant money, CGST s.52 TCS does not arise from the gateway choice. Get a CA to confirm 194-O/TCS for the SaaS model generally.
- **KYC:** PhonePe KYCs each merchant. With YouPI only the tenant's bank does, so our own KYB approval becomes the only gate.
- **Third-party terms:** WhatsApp OTP through an unofficial client breaches WhatsApp's terms (we already have official WhatsApp through AWS). Reading other people's Gmail needs the restricted `gmail.readonly` scope, which requires Google verification and a yearly CASA assessment.
- **Get a legal opinion** before any real-money use (the README says so too).

### Operations
- **Reconciliation** is manual: a statement CSV import per account, and manual UTR review for alerts that never arrive.
- **Refunds:** none. The merchant pays back from a UPI app and records an external refund, as `refund.ts` already does for `upi_upg`/`upi_manual` (lines 75–104).
- **Disputes:** the payer's complaint (UDIR) lands on the tenant's bank. There is no PSP dispute console.
- **Settlement** is instant, with no settlement reports.

## 3. Multi-tenant fit

| Concern | YouPI-PG | Our tenancy |
| --- | --- | --- |
| Data | One SQLite file holds every merchant (`merchants`, `payment_receiving_accounts`) | Each tenant has its own DB; intents live in the store DB, wallet intents in the flagship (`service.ts dbForPurpose`) |
| Observers | One Gmail observer process per receiving account (`RECEIVING_ACCOUNT_ID`, `gmail-poller.js:67`), one paired phone per merchant | A single SES inbound route keyed `upi+<slug>.<token>@` (`alert-parse.ts`); no per-tenant process |
| Onboarding | Per tenant: a merchant row, an API key, a webhook secret, Gmail OAuth or a phone | Per tenant: a UPI ID plus a Gmail forwarding filter (UPG), or PhonePe credentials |
| Payouts | None; money goes straight to the tenant's bank | Same: no platform account, commission or Route transfer for UPI (`settle.ts recordUpiCapturedPayment`, `collectedOn: 'own'`) |
| Throughput | One payer per VPA for up to 5.5 min each; sale spikes queue | Same limit for UPG; PhonePe has none |

Running one shared YouPI for all tenants concentrates every tenant's payment data in one SQLite pod. Running one instance per tenant would add a stateful pod to every `{slug}-*` workload.

## 4. Integration work in our code

| Area | Today | With YouPI as a provider |
| --- | --- | --- |
| Provider choice | `creds.ts resolveUpiProvider`: `phonepe` / `upg` / `none` | Add `youpi` with per-merchant `{merchantId, apiKey, webhookSecret}` in `tenant_integration_credentials` |
| Start | `service.ts startUpiPayment` → PhonePe `createPayment` or a UPG intent | Call `POST /api/v1/payments` (Idempotency-Key = `merchant_order_id`), store the YouPI payment id on `upi_payment_intents.provider_order_id`, redirect to its checkout |
| Webhook | `webhook.ts handlePhonePeCallback` re-reads PhonePe's status API | New `/api/webhooks/upi/youpi/[tenant]`: verify Signature-V2 on the raw body, dedupe `X-Gateway-Delivery-Id` (new column or table), then `GET /api/v1/payments/{id}` before settling |
| Capture idempotency | `claimIntentStatus` (intent CAS), `pending_payment_intents` claim in `commitDraftFromCapture`, unique `payments.transaction_id`; `routeCapturedPayment` is bypassed for UPI through `CaptureGateway.book` | Reuse unchanged: `applyUpiPayment(intent, {transactionId: utr}, {via: 'youpi'})`, with new gateway values `upi_youpi` in `PAYMENT_GATEWAY`/`LEDGER_GATEWAY`. Decide whether `OBSERVED_SUCCESS` or only `RECONCILED` pays the order |
| Sweep | `sweepUpiIntents` polls PhonePe and advances UPG queues | Poll YouPI for intents with no webhook |
| Refunds | `refund.ts`: PhonePe API; UPG/manual = external refund | `upi_youpi` = external refund |
| Admin UI | `UpiCollectionCard`, PhonePe credentials (`/api/admin/integrations/phonepe`), UPI confirmations (`/api/admin/payments/upi`) | A YouPI credentials form, links out to YouPI's admin for observer pairing and statement import, and `MANUAL_REVIEW` mapped onto confirmations |
| Autopay | `autopay.ts`, `autopay-webhook.ts`, `lib/subscriptions/autopay*.ts` | No equivalent: keep PhonePe or fall back to Razorpay Subscriptions |

## 5. Gaps, risks and costs vs PhonePe

| | PhonePe | YouPI-PG |
| --- | --- | --- |
| Confirmation | PSP status API, authoritative | Parsed SMS or email; its own docs say "not proof" |
| Concurrency | Unlimited | One payer per VPA |
| Refunds, disputes | API, dashboard | Manual |
| Autopay | Yes | No |
| License, support | Commercial contract | None granted; repo 2 months old, docs merged in from third-party forks (Fins & Wings, V-Visa) |
| Fees | Low or zero for UPI (UPI P2M has zero MDR; check the plan) | ₹0 per transaction |
| Our costs | Integration done | Security review of 15k unlicensed lines; one pod + PVC (small); a phone and SIM per account, or Gmail CASA (yearly, roughly hundreds to a few thousand USD); staff time on reconciliation and refunds |

Other risks: spoofed or misparsed alerts (no DKIM check), bank formats that change without notice, delayed emails pushing payments into manual review, the privacy cost of reading full bank SMS and inboxes, and frozen personal VPAs. The README also disagrees with the code: it says there is no Dockerfile and calls the app Kotlin.

## Recommendation

Do not adopt YouPI-PG as code or as a service. It duplicates UPG with weaker email trust, a one-pod SQLite store and no license, and it gives none of what PhonePe provides. Keep PhonePe as the recommended UPI provider for any store with volume, refunds or subscriptions, and keep UPG as the zero-cost fallback. If we want a PhonePe alternative, look at another licensed PSP or a bank's merchant UPI collection API. Razorpay UPI is already integrated for cards.

## Phased plan

**Recommended path: improve UPG with YouPI's ideas (no YouPI code).**
1. **Statement reconciliation, about 3–4 days.** Owners upload a bank statement CSV. Its rows become trusted `upi_bank_observations`, auto-match `awaiting_confirmation` intents by UTR and amount, and fill `suggestions` on the confirmations page.
2. **Optional second observer, about 1.5–2 weeks.** An in-house Android notification listener (or an Expo module in `mobile-service/client`) posts HMAC-signed, device-bound credits into `insertObservation`. It is for banks whose emails lag. Needs a privacy review.
3. **Docs and controls, about 1 day.** State in `docs/PAYMENTS_UPI.md` that UPG requires a merchant VPA on a current account, and add a daily-volume warning.

**If YouPI must be evaluated anyway (gated):**
- **Phase 0, about 1 week of calendar time.** A written license from the maintainers, a legal opinion and bank confirmation. Stop if any is missing.
- **Phase 1, 5–10 days.** Security review, including adding DKIM verification.
- **Phase 2, 3–4 days.** Staging StatefulSet, PVC, backups, ingress.
- **Phase 3, 8–12 days.** Provider adapter, webhook dedupe, sweep, tests and admin UI.
- **Phase 4, 2–4 weeks.** Flagship-only pilot under 20 payments a day.
- **Phase 5, 4–8 weeks of calendar time.** Gmail OAuth verification and CASA before tenants can connect.
- **Total:** about 4–6 engineer-weeks plus the external gates, for a result no better than today's UPG.
