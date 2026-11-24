# Recurring charges on one Razorpay subscription: plan (2026-11-24)

Status: **proposed, awaiting decisions** (section 6). Decided by the user so far:
- One combined subscription per tenant (plan plus add-ons, one monthly charge, one mandate).
- Existing wallet-billed Showcase sites and add-ons switch **immediately**; unused wallet-paid time is credited back.
- Showcase trial is **7 days** (was the first month); an owner can have **multiple Showcase sites**.
- AI site corrections stay usage-billed from the wallet: 3 free per day, then a per-correction price.
- Per-use costs (messages, documents, AI) stay on the wallet.

## 1. Razorpay mechanics

**Shape.** One subscription per tenant (workspace). Its amount is the sum of billable lines: `store_plan`
(today's `priceInrMonthForPlan`), `showcase_site` (one line per site past its trial), `messaging_addon` (the tier),
`ad_free` (stores only). One Razorpay plan per distinct total, cached as today. The cache key becomes
`combo:<mode>:<interval>:<paise>`; today's `platform_infra.razorpay_plans` key ignores test vs live mode, so a test plan
id could be used with live keys.

**Changing the amount.** Razorpay rejects `subscriptions.update` for UPI and eMandate subscriptions, so the default is
**replace**: create a new subscription for the new total with `start_at` = the old `current_end` (billing date doesn't
move). For an increase, add an upfront add-on for the price difference over the days left in the cycle; Razorpay
collects only that upfront amount at authorisation. On the replacement's `subscription.authenticated`, apply the
increase, mark the old one `superseded`, and cancel it with `cancel_at_cycle_end=1`. Decreases take effect at cycle
end with no mid-cycle refund. Phase 2, cards only: skip re-authorisation with `update` + `schedule_change_at:
'cycle_end'` and proration through `/subscriptions/:id/addons`. A Showcase trial ending while a subscription exists is
an increase the owner approves, and that is where the upsell shows.

**Mandate limits.** UPI Autopay and card mandates debit up to ₹15,000 without extra authentication. When the total,
or a yearly 10× amount, exceeds that, offer eMandate or card only. `customer_notify: 1` gives the 24-hour pre-debit
notice.

**Failure handling** (through the existing dispatcher):

| Event | Action |
|---|---|
| `pending` | Mark `past_due`, email an "update payment" link; everything keeps running. (Today's ecom route wrongly maps this to `halted`.) |
| `halted` | `grace_until = now + 7d`. The store suspends as today; sites pause and add-ons stop when grace ends. |
| `charged` | Extend entitlements to `current_end` + 1 day, resume sites paused as `unpaid`, issue the invoice and `settlement_ledger` row, insert into `billing_charges` (unique payment id makes it idempotent). |
| `cancelled` / `completed` | Ignore if `superseded`. Otherwise lines end at `current_end`; only a store is terminated and deprovisioned; a Showcase-only workspace stays active. |
| `resumed` | Active again; clear the grace. |

"Pay now" on a halted subscription creates a replacement that starts immediately and cancels the halted one.

**Test mode.** `rzp_test_` keys and a separate webhook secret locally and on staging; test cards and
`success@razorpay` / `failure@razorpay` for UPI Autopay; `BILLING_TEST_PERIOD=weekly` makes staging plans weekly
(Razorpay's shortest daily plan is 7 days); signed payload replays in
`controller-service/integration-tests/subscriptions/webhook-replay.test.ts`.

**Existing bugs to fix along the way.**
- Upgrades in `api/(ecom)/ecom/billing/change-plan` and `/plan` cancel the old subscription before the owner
  authorises the new one; an abandoned checkout leaves the store with no subscription.
- Those upgrades pass a negative add-on amount as the proration credit; confirm in test mode whether Razorpay accepts it.
- Downgrades call `update`, which fails on UPI and eMandate subscriptions.
- `storeIsAdFree` fails open: if the control plane can't be read, a paying ad-free store shows ads.

## 2. Data model

**Control plane** (`controller-service/database/control-plane/`), new `tables/billing.sql`:
- `billing_subscriptions`: tenant_id, razorpay_subscription_id (unique), razorpay_plan_id, status (adds `superseded`,
  `abandoned`), is_current, interval, amount_paise, upfront_paise, `lines` jsonb snapshot, payment_method,
  replaces_id, current_start/current_end, grace_until, last_event_at (older events ignored), checkout_url.
- `billing_lines`: tenant_id, kind, ref (site id or tier), amount_paise, status
  (`trial|awaiting_payment|active|ending|legacy_wallet|ended`), trial_ends_at, ends_at, grace_until.
- `billing_charges`: payment_id (unique), subscription id, amount, lines snapshot (invoices, admin revenue).
- PKs/CHECKs in `constraints.sql`; indexes `uq_billing_subscriptions_current (tenant_id) WHERE is_current`,
  `uq_billing_lines_open (tenant_id, kind, ref) WHERE status <> 'ended'`, sweep indexes on `grace_until` and
  `trial_ends_at`; FKs in `foreign-keys.sql`.
- `razorpay_subscription_index`: no DDL; billing subscriptions get rows with `collecting_account = 'billing'`.
- `tenant_custom_domains`: `showcase_site_id uuid`. `site_studio_sessions`: `site_id uuid`, plus a
  `site_studio_owner_allowance(owner_id, day, tweaks_used)` table and a unique index on (owner_id, product, site_id).
- Entitlements are still read from `tenants.ad_free_until`, `messaging_addon(_until)` and `showcase_sites.paid_until`;
  only the billing handler writes them, so `storeIsAdFree`, `messagingEntitlement` and `resumeShowcase` keep working.

**Showcase** (`showcase-service/database/platform-only/`): `showcase_sites.trial_ends_at` plus an index.

**Migrations** (data/destructive only): `2026-12-01_billing_backfill.sql` (existing store subscriptions into
`billing_subscriptions` and the index, `billing_lines` seeded `legacy_wallet` for wallet-paid sites and add-ons,
`trial_ends_at` set; `ON CONFLICT DO NOTHING`); `2026-12-01_studio_sessions_per_site.sql` (drop
`site_studio_sessions_owner_product_key`, backfill `site_id`; remove that line from `constraints.sql` in the same
commit). Later, once unread: drop the wallet-renew columns (`ad_free_renew`, `messaging_addon_renew`, Showcase
`renew`, `renewal_reminded_for`, `charge_failed_at`, `last_charge_error`).

## 3. Migrating existing customers (switch now)

- **Cutover:** `platform_infra.billing_mode='subscription'`; no recurring wallet debit after that.
- **Credit** per open wallet-paid period: `credit = paid × (until − t) / (until − period_start)`, `t` = the owner's first
  successful subscription charge. Amount and period from the `wallet_ledger` row by external_ref
  (`showcase:<site>:<YYYY-MM>`, `ad_free:<tenant>:<date>`, `messaging_addon:<tenant>:<tier>:<date>`), paid with
  `creditWallet`, ref `migrate:<ref>` (idempotent), same category as the debit.
- **Owner flow:** email plus a console banner (`ConsoleShell.tsx`) to `/dashboard/billing/subscribe`: lines, monthly
  total, credit, deadline, then Razorpay checkout. Starts immediately; for stores it's a replacement including add-on
  proration.
- **Owners who don't subscribe:** keep working until `paid_until`, then grace until
  `GREATEST(paid_until, cutover + 7d) + 7d`, then the sweep pauses sites as `unpaid` and ends add-ons.
- **Sites mid-trial** keep their promised end (`trial_ends_at = paid_until`).
- **`requested_addons`** from onboarding go into the store's first subscription at KYC approval.

## 4. Code changes

- **New engine** `controller-service/src/lib/billing/`: `lines.ts` (price per kind; yearly = 10× monthly),
  `subscription.ts` (quote, start, replace, cancel, removeLine), `webhook.ts` (takes over the ecom route's logic:
  first-charge provisioning, `applyPendingPlan`, invoices), `sweep.ts`, `migrate.ts`.
- **Webhooks:** `packages/store-core/src/lib/payments/webhook-tenant.ts` returns `collecting_account`;
  `razorpay-events/dispatch.ts` sends `billing` rows to an injected `onBillingSubscription` handler from
  `controller-service/src/app/api/(public)/webhooks/razorpay/route.ts` (store-core can't import controller code);
  `api/(ecom)/ecom/webhook/razorpay/route.ts` becomes a 200 no-op until the Razorpay dashboard stops sending there;
  `tenant-registry/lifecycle.ts` keeps `tenants.razorpay_subscription_id`/`subscription_status` as a mirror.
- **Crons:** remove `ad_free_renew`, `messaging_addon_renew`, `showcase_renew` from
  `packages/store-core/src/lib/shared/cron-jobs.ts` and their routes; regenerate `deploy/k8s/platform/cronjobs.yaml`
  with `deploy/k8s/gen-cronjobs.ts`; add a daily `billing_sweep` (trial reminders, trial-end and grace pauses,
  migration deadlines, `subscriptions.fetch` reconciliation for missed webhooks).
- **Add-ons:** `packages/store-core/src/lib/billing/{ad-free,messaging-addon,requested-addons,topup}.ts` lose buy,
  renew and due functions; `storeIsAdFree` keeps the last known value on read errors;
  `api/(ecom)/ecom/billing/{ad-free,messaging-addon}/route.ts` add or remove a line (an increase returns a
  `checkoutUrl`); `AdFreeCard.tsx`, `MessagingAddonCard.tsx`, `lib/ecom/*-state.ts` lose the renew toggles.
- **Store plans:** `api/(admin)/admin/ecom/kyc/[tenantId]/approve/route.ts` and `api/(ecom)/ecom/plan/route.ts` go
  through the engine; delete `billing/change-plan/route.ts`; `api/(ecom)/ecom/provisioning/route.ts` removes the
  store's line, not the whole subscription; `lib/payments/razorpay-subscriptions.ts` gains combined plans,
  `start_at`, upfront add-ons, `addSubscriptionAddon`.
- **Domains:** `lib/domains/renewal.ts` renewals become a one-time subscription add-on (decision 8).
- **Showcase billing:** `SHOWCASE_TRIAL_DAYS = 7` in `packages/store-core/src/lib/showcase/types.ts`;
  `store.ts` `publishShowcase` sets `trial_ends_at` per site; `controller-service/src/lib/showcase/billing.ts` drops
  wallet charging (keeps state logic and notices); `state.ts` shows subscription status; new templates in
  `lib/shared/ecom-emails.ts`.
- **Multiple sites per owner** (console routes under `/dashboard/showcase/[siteId]/…`): `dashboard/showcase/page.tsx`
  becomes the sites list (name, host, trial/paid/paused, unread enquiries; Edit, Enquiries, Analytics, Domain,
  Hosting; **New site**); new `[siteId]/page.tsx` (ShowcaseClient moves here), `[siteId]/edit/*`, `[siteId]/leads/*`,
  `[siteId]/domain`, plus `[siteId]/analytics` (built separately); old `edit/` and `leads/` redirect to the newest
  site; `nav.ts` gets one "Sites" entry; `onboard/showcase/page.tsx`, `ShowcaseOnboard.tsx`, `_builder/*` take
  `?site=` or `?new=1`; APIs move to `api/(ecom)/ecom/showcase/[siteId]/{hosting,leads}` and
  `onboard/showcase/{route,publish,slug,upload}` take a `siteId` checked with `getOwnedShowcase`; `store.ts` drops the
  `LIMIT 1` lookups and adds `listShowcasesByTenant`; studio sessions per site across `showcase-builder/*`,
  `site-studio/{sessions,allowance}.ts`, `(studio)/_preview/ShowcasePreview.tsx`; custom domains link through
  `lib/domains/orders.ts` to `showcase_site_id`. Each site is its own `showcase_site` line (own trial and pause
  state; Razorpay only allows quantity changes on card subscriptions).
- **Pay screen and upsell:** `PublishPanel.tsx` says "7 days free, then ₹200/month on your subscription"; new
  `components/ecom/KeepOnline.tsx` (trial ended, site lapsed, or subscription halted) shows "Keep Showcase ₹200/mo"
  next to "Upgrade to an online store" (plans from `listPlans` with prices and features); choosing a store opens
  `/onboard` with that plan preselected.
- **Billing and admin screens:** `dashboard/billing/{page,BillingClient}.tsx` (lines, next charge, payment method,
  pending change, Pay now, cancel); wallet copy says usage only; admin `admin/ecom/billing/*`,
  `detail/BillingTables.tsx`, `tabs/OverviewTab.tsx`, `lib/overviews/{ecom-billing,ecom-platform}.ts` (revenue from
  `billing_charges`).

## 5. Tests

Update the Razorpay webhook, dispatcher, webhook-tenant, subscription, messaging add-on, ecom billing, showcase
(build, generate, complete, leads), instrumentation, BillingTables, billing overview and purge-tenant tests. New:
`controller-service/tests/lib/billing/{lines,proration,subscription,webhook,sweep,migrate}.test.ts`, an ad-free gate
test (no `adsbygoogle` while active; last known value survives a read error), and UI tests for the sites list and
`KeepOnline`.

## 6. Decisions (recommended answer in bold)

1. Publish without a mandate? **Yes; offer "set up autopay now" during the trial (Razorpay's refundable ₹5 authorisation).**
2. Grace after the trial without a subscription? **No; reminders on days 5 and 7, pause on day 7.**
3. Sites already in the old 30-day free month keep it? **Yes.**
4. Migration grace? **The paid-for time, then 7 days, never less than 14 days from the announcement.**
5. Are ₹200 and ₹500 GST-inclusive? **Yes, so the switch doesn't raise prices by 18%.**
6. Owner removes something on UPI/eMandate but hasn't approved the lower mandate? **Refund the difference automatically on each charge.**
7. On a halted payment: store suspends at once, sites and add-ons stop after 7 days? **Yes.**
8. Domain renewals as a one-time subscription add-on at least 35 days before expiry, first year still from the wallet? **Yes.**
9. After an owner upgrades to a store, how are Showcase sites billed? **First site included in the store plan; each extra ₹200.**
10. Yearly plans bill add-ons yearly in the same subscription at 10× monthly? **Yes.**
11. Admin changes add-on prices: existing subscriptions change? **No; old price until the tenant's next change.**
12. Totals above ₹15,000 allow only eMandate or card? ~~Yes~~ **Revised 2026-11-24: UPI stays allowed** — the hosted checkout offers it anyway (test mode, 2026-11-24), and the payer approves each debit above the limit (NPCI).
13. AI allowances per site or per owner? **Free generation per site (only while the owner has no other unpaid trial or draft site); daily corrections pooled per owner.** (`controller-service/src/lib/site-studio/allowance.ts` defaults `TWEAKS_PER_DAY` to 30 today; the user chose 3.)
