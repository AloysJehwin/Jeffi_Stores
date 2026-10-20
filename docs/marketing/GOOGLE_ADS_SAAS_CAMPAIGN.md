# Google Ads campaign plan — Jeffi Commerce (ecom.jeffistores.in)

_Last updated: 2026-10-20. Owner: Jeffi Stores marketing. Google Ads manager account (MCC) 587-534-7299
(see `docs/google-ads-api/`)._

This is the launch plan for paid search that sells the **platform itself** (not the flagship
jeffistores.in hardware store). It covers what we are selling, how conversions are measured, the
campaign and ad-group structure, keywords, negatives, ad copy (every line already checked against
Google's 30/90-character limits), assets, landing pages, budgets, bidding and the weekly routine.

> The admin-panel **Google Ads** section (`docs/google-ads-api/`) is the tool store *tenants* use for
> their own Ads accounts. The campaigns below run in Jeffi Stores' own Ads account under the MCC.

---

## 1. What we are selling

Three services, all sold from `ecom.jeffistores.in`, one account, one shared wallet. The service
picker at onboarding (`controller-service/src/app/(ecom)/ecom/onboard/ServicePicker.tsx`) is the
source of truth for the offer.

| Service | What the buyer gets | Pricing | Who buys it |
|---|---|---|---|
| **Online store** | Own `{slug}.jeffistores.in` storefront + admin panel: catalogue, cart, checkout (Razorpay UPI/cards/netbanking + COD), Delhivery shipping, GST invoices, inventory & POs, quotations, returns, CRM, email/WhatsApp campaigns, B2B portal with RFQs, Google Ads tool, AI assistant (plan-gated; `docs/PLAN_FEATURE_MATRIX.md`) | Basic ₹4,999 · Growth ₹9,999 · Pro ₹19,999 · Enterprise ₹49,999 per month; yearly = 10× monthly (2 months free); no setup fee, no card to sign up; custom domain add-on; daily payouts +5% | Indian SME retailers, D2C brands, distributors/wholesalers, industrial & trade suppliers |
| **Messaging API** | Send email, SMS and WhatsApp from any app with an API key; Meta-approved WhatsApp templates and India DLT SMS handled on our side; delivery callbacks; send log | Pay per message from a prepaid wallet (internal send-time estimates in `lib/shared/messaging/pricing.ts`: SMS ≈ ₹7, WhatsApp ≈ ₹1, email ≈ ₹0.05; live prices show on the dashboard) | Developers and SaaS/ops teams in India needing OTPs, alerts and campaigns |
| **Documents API** | Generate GST invoices, quotations, receipts and labels as branded PDFs + shareable links over an API, with numbered sequences | Pay per document from the same wallet | Developers, billing/ERP teams, marketplaces |

Positioning that the landing page already makes (`docs/ECOM_LANDING_DESIGN_BRIEF.md`): *"Sell
anything. We run the store."* Storefront + admin, online + COD, Delhivery, GST-ready, live in
minutes, no setup fee. Ads must not promise anything the page does not: no free trial exists (sign-up
is free, the store plan is paid before provisioning), e-invoicing/e-way bill integrations are
disabled, and custom domains are an add-on.

---

## 2. Measurement (do this before spending a rupee)

### 2.1 What is wired in the code

`ecom.jeffistores.in` is a platform host, so the root layout loads the flagship Google tag
`GT-NM2C3M85` (`lib/analytics/google-tag.ts`, `app/layout.tsx`) with plain measurement (no consent
banner; that is only on storefront hosts). Until this change only storefront purchases fired events,
so a campaign would have had nothing to optimise on. The SaaS funnel now sends three GA4 events via
`trackSaasEvent` (`lib/client/analytics.ts`):

| Event | Fires when | Where | Params | Dedupe |
|---|---|---|---|---|
| `sign_up` | A **new** owner finishes OTP or Google sign-in (the auth routes now return `isNew`; returning owners do not fire) | `OwnerAuthForm.tsx` | `method: otp \| google` | n/a (navigates away) |
| `saas_workspace_created` | A messaging/documents-only workspace is created | `onboard/ServicesOnboard.tsx` | `services: messaging+documents`, `slug` | once per slug |
| `saas_subscription_paid` | Razorpay confirms the store subscription (success page, also on webhook-confirmed reloads) | `onboard/success/SubscriptionPaidPing.tsx` | `transaction_id` (Razorpay subscription id), `value` (₹ charged: monthly, or 10× for yearly), `currency: INR`, `plan`, `billing_interval`, `tenant` | once per subscription id |

The flagship store's purchase conversion label (`window.jeffiAds.sendTo`) is deliberately **not**
used for subscriptions, so store sales and platform sales never mix.

### 2.2 One-time setup in GA4 and Google Ads

1. In the GA4 property behind `GT-NM2C3M85`, open **Admin → Events** and mark `sign_up`,
   `saas_workspace_created` and `saas_subscription_paid` as **key events** (they appear within
   24 h of the first fire; use DebugView to force them while testing).
2. **Admin → Product links → Google Ads**: link the Ads account (the one under MCC 587-534-7299).
3. In Google Ads, **Goals → Conversions → New → Import → Google Analytics 4 → Web**: import all
   three. Settings:
   - `saas_subscription_paid` → category *Purchase*, **Primary**, value *Use the value from GA4*,
     count *One*, click-through window 90 days.
   - `sign_up` → category *Sign-up*, **Secondary** (observation) for the first 4 weeks, value ₹0.
   - `saas_workspace_created` → category *Sign-up*, **Primary for the API campaigns only** (use
     campaign-level goals), value ₹0 until wallet-top-up data exists.
4. Turn on **auto-tagging** (Settings → Account settings) and **enhanced conversions** for web
   (uses the owner's email on the success page; add when ready).
5. Verify end to end on a test tenant: Tag Assistant should show `sign_up` on signup and
   `saas_subscription_paid` with the right `value` on `/onboard/success`.

### 2.3 Still missing (follow-ups)

- A `saas_wallet_topup` event with value, so the API campaigns can be bid on revenue rather than
  workspaces.
- Offline import of plan upgrades/renewals (tenant billing already lives in the control plane) so
  Ads learns lifetime value, not first charge.
- Dedicated landing pages for the Messaging API and Documents API (see §6); today the ecom landing
  page talks only about the store, and the service picker appears only after sign-up.

---

## 3. Account structure

Search only to start (no Display Network expansion, no search partners). India, English. All
campaigns use the same conversion goals except where noted.

| # | Campaign | Goal | Landing page | Daily budget (start) | Bidding |
|---|---|---|---|---|---|
| C1 | `JC · Search · Online store builder · IN` | `saas_subscription_paid` (primary), `sign_up` (secondary) | `https://ecom.jeffistores.in/` ; pricing ad group → `/pricing` | ₹1,100 | Maximise clicks with ₹35 max CPC for 2 weeks → Maximise conversions → tCPA once ≥30 conversions/30 days |
| C2 | `JC · Search · Messaging API · IN` | `saas_workspace_created` (campaign-level primary) | `/signup` (until a `/messaging` page exists) | ₹400 | Maximise clicks ₹30 cap → Maximise conversions |
| C3 | `JC · Search · Documents API · IN` | `saas_workspace_created` | `/signup` (until a `/documents` page exists) | ₹200 | Maximise clicks ₹30 cap → Maximise conversions |
| C4 | `JC · Search · Brand` | all | `/` | ₹100 | Manual CPC ₹5–8 or Target impression share 90% top |
| — | Reserve | | | ₹200 | Reallocate weekly to the campaign with the lowest CPA |

Total ≈ ₹2,000/day (≈ ₹60,000/month). This is a starting assumption, not a forecast; scale what
converts (§8).

**Campaign settings (all):** Location = India, *Presence* (not "interest"); exclude nothing yet,
but watch city reports and add bid adjustments for Tamil Nadu/Karnataka/Maharashtra/Delhi NCR/Gujarat
after 2 weeks. Language = English. Ad schedule = all days, 07:00–23:00 IST, +10% 10:00–13:00 and
19:00–22:00 after data. Devices = all; expect 60–70% mobile. Ad rotation = optimise.
Final URL suffix (campaign level) = `utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={adgroupid}&utm_term={keyword}`
so the Traffic Analytics page attributes sessions.

---

## 4. Ad groups and keywords

Match types: start with **phrase** and **exact** only. Broad match is for later, with Smart Bidding
and a mature negative list. One theme per ad group so headlines match the query.

### C1 · Online store builder

| Ad group | Keywords (phrase unless `[exact]`) |
|---|---|
| **Store builder (generic)** | "online store builder india", "create online store india", "ecommerce website builder india", "build online shop india", "start online store india", [ecommerce platform india], [online store platform india], "ecommerce platform for small business india", "sell online platform india" |
| **GST / billing angle** | "ecommerce with gst billing", "online store with gst invoice", "gst billing software with online store", "ecommerce gst invoice software", "online shop gst compliant", [ecommerce software with gst] |
| **COD / payments angle** | "cash on delivery ecommerce platform", "online store with cod india", "upi payment online store", "razorpay online store builder" (keep an eye on Razorpay's own trademark; fine in keywords, do not use in headlines) |
| **Shopify alternative** | "shopify alternative india", "cheaper than shopify india", "shopify vs", "best shopify alternative for india", "dukaan alternative", "shoopy alternative" — ad copy never names competitors |
| **B2B / wholesale** | "b2b ecommerce platform india", "wholesale ecommerce platform", "b2b online store builder", "distributor ordering portal", "rfq ecommerce platform", "industrial ecommerce platform india", "trade portal software" |
| **Pricing (→ /pricing)** | "ecommerce platform pricing india", "online store monthly plan india", "ecommerce subscription plans india" |

### C2 · Messaging API

| Ad group | Keywords |
|---|---|
| **WhatsApp API** | "whatsapp business api india", "whatsapp api pricing india", "whatsapp api provider india", "whatsapp otp api", "whatsapp template message api", "bulk whatsapp api" |
| **SMS API** | "sms api india", "transactional sms api", "otp sms api india", "dlt sms api", "bulk sms api provider", "sms gateway api india" |
| **Email API** | "transactional email api india", "email api for developers india", "send email api" |
| **Unified** | "messaging api india", "communication api india", "sms whatsapp email api", "twilio alternative india" (never name Twilio in ad text) |

### C3 · Documents API

| Ad group | Keywords |
|---|---|
| **GST invoice API** | "gst invoice api", "invoice generator api india", "gst invoice pdf api", "invoice api for developers", "billing api india" |
| **PDF documents** | "pdf generation api india", "quotation pdf api", "receipt pdf api", "shipping label pdf api", "document generation api" |

### C4 · Brand

`[jeffi stores]`, `[jeffi commerce]`, "jeffistores", "jeffi stores ecom", "jeffi stores pricing",
"jeffi stores login" (the login query lands on `/signin` via a sitelink).

### Negative keywords (shared list `JC · Negatives · Core`, applied to C1–C3)

```
free, free trial, open source, github, download, crack, tutorial, course, training, certificate,
job, jobs, salary, hiring, internship, career, resume, meaning, definition, what is, wikipedia,
pdf download, template free, theme free, wordpress plugin, woocommerce plugin, magento, opencart,
shopify login, shopify app, amazon seller, flipkart seller, meesho, myntra, nykaa, aliexpress,
dropshipping india free, affiliate, reseller program, buy phone, buy laptop, near me, store near me,
grocery, pharmacy, hardware store, hardware shop, jeffi stores hardware
```

Campaign-specific extras:
- C1 also negates `api`, `sdk`, `developer`.
- C2/C3 negate `whatsapp web`, `whatsapp download`, `sms pack`, `recharge`, `jio`, `airtel`,
  `invoice format`, `invoice template`, `excel`, `word`, `tally`.
- Brand negates nothing; add `jeffi stores hardware` **only** if hardware-store queries creep in
  (those belong to the flagship store's account, not this one).

Add the flagship store's product queries (bolts, tools, drill, etc.) to the core list as they
appear in search terms: the shared brand name will pull them in.

---

## 5. Responsive search ads

One RSA per ad group, 15 headlines + 4 descriptions, all distinct, keyword in at least three
headlines. Add a second RSA only after the first has 1,000+ impressions. Every line below is
already ≤30 / ≤90 characters (verified by script). Ad groups not listed reuse the closest block with
the first three headlines swapped for the group's keyword phrasing.

### C1 · Store builder (generic)

**Headlines (≤30 chars, pin #1 and #15 only if CTR drops):**

1. Launch Your Online Store Today
2. Storefront + Admin, One Login
3. GST Invoices Built In
4. UPI, Cards & COD Checkout
5. Delhivery Shipping Included
6. No Setup Fee, Go Live Today
7. Plans From ₹4,999/Month
8. Built For Indian Retailers
9. Inventory & Purchase Orders
10. WhatsApp & Email Campaigns
11. Your Store, Managed For You
12. Set Up In Minutes
13. Own Subdomain, Ready To Sell
14. B2B Portal & Quotations
15. Jeffi Commerce

**Descriptions (≤90 chars):**

1. Your own online store: storefront, admin, payments, delivery and GST on one subdomain.
2. Razorpay checkout with UPI, cards, netbanking and COD, settled to your bank automatically.
3. GST invoices, packing slips and Delhivery labels generated from every order automatically.
4. Sign up in minutes, no card and no setup fee. Add products, hit publish and start selling.

Final URL: `https://ecom.jeffistores.in/` · Display path: `ecom.jeffistores.in/online-store/india`

### C1 · GST / billing angle (also COD/payments, Pricing)

**Headlines (≤30 chars, pin #1 and #15 only if CTR drops):**

1. Online Store With GST Billing
2. CGST, SGST & IGST Invoices
3. GSTR-Ready Sales Reports
4. Sell Online, Stay Compliant
5. Cash Sale POS With GST
6. Quotations & Purchase Orders
7. Invoices Auto-Generated
8. ₹4,999/Month, No Setup Fee
9. E-commerce For Indian SMEs
10. Returns & Replacements
11. Inventory & Low-Stock Alerts
12. Store + Billing In One Admin
13. Start Your GST-Ready Store
14. Payments Settled To Your Bank
15. Jeffi Commerce

**Descriptions (≤90 chars):**

1. Every order becomes a GST-compliant tax invoice with your GSTIN, HSN codes and tax split.
2. Storefront, billing, inventory and shipping in one admin panel, built for Indian SMEs.
3. Accept UPI, cards and COD. Payouts land in your verified bank account, weekly or daily.
4. Start with Basic and move up as you grow. Monthly or yearly billing, cancel anytime.

Final URL: `/` (Pricing ad group → `/pricing`) · Display path: `/gst-billing/online-store`

### C1 · B2B / wholesale

**Headlines (≤30 chars, pin #1 and #15 only if CTR drops):**

1. B2B E-commerce Platform India
2. Wholesale Store With RFQs
3. Per-Customer B2B Pricing
4. Approve Business Buyers
5. Quote, Negotiate, Convert
6. GST Quotations In One Click
7. Bulk Orders Made Simple
8. Business Portal For Buyers
9. Industrial & Trade Suppliers
10. Credit-Ready B2B Checkout
11. Retail + Wholesale, One Store
12. CRM For Repeat Buyers
13. Delhivery Shipping Built In
14. Launch Your B2B Store
15. Jeffi Commerce

**Descriptions (≤90 chars):**

1. Give business buyers their own portal: GST-verified accounts, category discounts and RFQs.
2. Draft GST quotations, negotiate bulk orders and convert them to invoices, all from admin.
3. Retail storefront and wholesale portal on one platform, with shared inventory and billing.
4. Built for distributors, manufacturers and trade suppliers across India. No setup fee.

Final URL: `/` · Display path: `/b2b/wholesale-store`

### C2 · Messaging API (all ad groups; swap headline 1 for "SMS API For India" / "Transactional Email API" per group)

**Headlines (≤30 chars, pin #1 and #15 only if CTR drops):**

1. WhatsApp, SMS & Email API
2. One API For All Messaging
3. Pay Per Message, No Plans
4. Send From Any App In Minutes
5. Approved WhatsApp Templates
6. DLT-Compliant SMS For India
7. Transactional Email Included
8. API Key In Two Minutes
9. Prepaid Wallet, No Lock-In
10. Delivery Status Callbacks
11. OTPs, Alerts & Campaigns
12. Messaging API For India
13. Built For Indian Businesses
14. Start Sending Today
15. Jeffi Commerce

**Descriptions (≤90 chars):**

1. WhatsApp, SMS and email from one REST API. Prepaid wallet, pay only for what you send.
2. Meta-approved WhatsApp templates and DLT-registered SMS routes, handled on our side.
3. Create a workspace, copy your API key and send your first message in minutes. No wait.
4. Delivery callbacks, templates and a send log in one dashboard. Add a store any time.

Final URL: `/signup` · Display path: `/messaging-api/india`

### C3 · Documents API

**Headlines (≤30 chars, pin #1 and #15 only if CTR drops):**

1. GST Invoice API For India
2. Generate Invoice PDFs Via API
3. Invoices, Quotes & Receipts
4. Shipping Labels As PDF
5. One Call, One Shareable Link
6. GST-Compliant PDF Invoices
7. Pay Per Document, No Plans
8. API Key In Two Minutes
9. Your Logo, Your Branding
10. Built For Indian Businesses
11. Documents API For Developers
12. Numbered Invoice Sequences
13. Quotation PDFs On Demand
14. Start Generating Today
15. Jeffi Commerce

**Descriptions (≤90 chars):**

1. Generate GST invoices, quotations, receipts and labels as branded PDFs with one API call.
2. Each document comes back as a PDF and a shareable link, numbered in your own sequence.
3. Prepaid wallet, pay per document. Set up a workspace and get an API key in two minutes.
4. CGST, SGST and IGST handled for you. Add messaging or a store from the same account.

Final URL: `/signup` · Display path: `/documents-api/gst-invoice`

### C4 · Brand

**Headlines (≤30 chars, pin #1 and #15 only if CTR drops):**

1. Jeffi Commerce - Official Site
2. Jeffi Stores: E-commerce SaaS
3. Start Your Store Today
4. Plans From ₹4,999/Month
5. Messaging & Documents APIs
6. Storefront, Admin & GST Bills
7. No Setup Fee
8. Sign In Or Get Started

**Descriptions (≤90 chars):**

1. Official Jeffi Commerce site: online stores, messaging API and documents API for India.
2. Storefront, admin, Razorpay payments, Delhivery shipping and GST billing, managed for you.

Final URL: `/` · Display path: `/official`

---

## 6. Assets (extensions) and landing pages

**Sitelinks (account level):** Pricing → `/pricing` · Start your store → `/signup` · Messaging API
→ `/signup` · Documents API → `/signup` · Sign in → `/signin`. Each with two 35-char description
lines (e.g. "Plans from ₹4,999/month" / "Yearly = 2 months free").

**Callouts:** No Setup Fee · GST Invoicing · UPI, Cards & COD · Delhivery Shipping · WhatsApp
Campaigns · B2B Portal · Live In Minutes · Cancel Anytime.

**Structured snippets:** *Features*: Storefront, Admin panel, GST invoices, Inventory, Quotations,
Returns, CRM, Campaigns. *Services*: Online store, Messaging API, Documents API.

**Business name/logo:** "Jeffi Commerce" with the `J` mark. **Price asset** (C1): Basic ₹4,999,
Growth ₹9,999, Pro ₹19,999, Enterprise ₹49,999 per month. **Call asset:** only if a sales number is
staffed during the ad schedule.

**Landing pages — what exists and what is needed**

| Campaign | Today | Gap / action |
|---|---|---|
| C1 | `/` is a strong, fast, store-focused page with demo, FAQ, pricing link and *Start your store* CTA | Add an above-the-fold line with the Basic price and "no setup fee" (Ads quality score rewards price match); add `<title>`/meta description to the `(ecom)` layout (none set today, so Google uses the storefront defaults) |
| C1 Pricing | `/pricing` with comparison table and FAQ | Fine as is |
| C2 / C3 | No page mentions the APIs before sign-up; the service picker only shows after OTP | Build `/messaging` and `/documents` sections or pages (what it does, per-message price, code sample, "API key in 2 minutes", CTA to `/signup?service=messaging`), and make `OnboardEntry` pre-select the service from that query param. Until then expect weaker quality scores and run C2/C3 at the smaller budgets above |
| All | Google tag loads with plain measurement | Keep; add the enhanced-conversions email hash on `/onboard/success` |

---

## 7. Targets and economics

Plans are priced at ~50% margin over AWS cost (`docs/PLAN_FEATURE_MATRIX.md`), so a Basic tenant
contributes roughly ₹1,650/month of gross margin, Growth ≈ ₹3,300, Pro ≈ ₹6,600. Assumption:
median paid tenant stays 12 months and mixes toward Basic/Growth → ≈ ₹25,000 margin per paid
subscription. Spend at most half of that to acquire one.

| Metric | Launch target | Scale trigger |
|---|---|---|
| Cost per `sign_up` (C1) | ≤ ₹600 | ≤ ₹400 for 2 weeks → +20% budget |
| Cost per `saas_subscription_paid` (C1) | ≤ ₹8,000 in month 1, ≤ ₹6,000 by month 3 | ≤ ₹5,000 → move to tCPA ₹5,000 and +30% budget |
| Sign-up → paid rate | ≥ 10% | below 5% after 100 sign-ups → fix onboarding (plan step, bank verification) before buying more traffic |
| Cost per `saas_workspace_created` (C2/C3) | ≤ ₹800 | re-evaluate once `saas_wallet_topup` exists |
| Search impression share (exact keywords) | ≥ 40% | ≥ 70% → add phrase/broad expansion |
| CTR (Search) | ≥ 4% | below 2% on an ad group → rewrite headlines 1–3 |

---

## 8. Launch checklist and weekly routine

**Before launch**
1. §2.2 done and verified in Tag Assistant; conversions show *Recording* in Ads.
2. Billing, auto-tagging, GA4 link, and the shared negative list in place.
3. Ads reviewed against policy: no competitor names in ad text, no "free trial", prices match
   `/pricing`, "WhatsApp" used descriptively only.
4. Landing pages pass PageSpeed mobile ≥ 70 (the ecom page is animation-heavy; check on 4G).
5. Google Business Profile and the `ecom.jeffistores.in` site verified in Search Console (quality
   score and brand SERP).

**Weeks 1–2 (learning):** Maximise clicks with CPC caps. Daily: search terms → add negatives, move
winning queries to exact. Pause keywords with 100+ impressions and CTR < 1.5%.

**Weeks 3–4:** Switch C1 to Maximise conversions once ≥15 `sign_up` conversions exist. Add the
second RSA per ad group with the best-performing headlines pinned in position 1. Add city bid
adjustments.

**Month 2+:** tCPA on `saas_subscription_paid` when ≥30 in the last 30 days. Launch remarketing
(Display + YouTube, 30-day visitors who did not sign up; 90-day sign-ups who did not pay, with a
plan-specific message). Consider Performance Max for the store offer only after Search is stable, so
PMax does not cannibalise brand.

**Every Monday:** spend vs budget, CPA by campaign, search-terms sweep, impression share lost to
budget vs rank, disapprovals, landing-page errors. Reallocate the reserve. Record decisions in the
change history.

---

## 9. Experiments to queue

1. Headline test: price-led ("₹4,999/Month, No Setup Fee") vs outcome-led ("Launch Your Online
   Store Today") in C1 generic.
2. Landing page test: `/` vs `/pricing` for the GST ad group.
3. Hindi-language C1 copy (Hinglish headlines, same landing page) targeting Hindi-language
   settings, once English CPA is known.
4. A "Growth plan" ad group when B2B/quotation queries show up in search terms, since those features
   start at Growth.
