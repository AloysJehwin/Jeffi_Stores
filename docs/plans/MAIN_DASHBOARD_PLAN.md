# Main dashboard: master plan

Status: proposal (2026-10-16). Nothing in this document is built yet.

The admin home (`/admin/dashboard`) is rebuilt as a plan-aware command centre. Each store sees every KPI its plan and its admin's role allow. Locked modules show what an upgrade would unlock, and every number links to the page where you act on it.

## 1. Today

| Piece | What it does | Where |
|---|---|---|
| Quick actions | Shortcut buttons filtered by scope | `dashboard/_components/QuickActionBar.tsx` |
| Pending tasks | The admin's open tasks | `PendingTasksCard.tsx` |
| Alert chips | Counts that link to pages | `dashboard/page.tsx` |
| Analytics | Revenue, orders, AOV, customers, margin, paid orders, units, conversion, repeat rate, ops/product/growth insights, stock and returns summary | `AnalyticsDashboardClient.tsx`, `lib/queries/dashboard.ts` (`getDashboardAnalytics`, range presets) |

Gaps:
- **One size for all plans.** A Basic store sees the same layout as Enterprise, with empty spaces where it lacks data.
- **No channel or marketing view.** None of the new consoles appear on the home page: Merchant, Amazon, Amazon Ads, Meta Ads, Google Ads and social.
- **Attention is scattered.** It is split between alert chips, `channel_alerts`, the CRM queue and the new overview pages' "Needs attention" lists.
- **No history.** Trends that need past state, such as stock value, active customers or ratings, cannot be drawn because nothing is snapshotted.
- **No targets, no saved layouts and no scheduled summaries.**

## 2. Principles

1. **Plan and role decide what shows.** A widget appears when the tenant's plan includes its scope (`currentTenantPlanGate`) and the admin holds it (`hasScope`). When the plan lacks it, the widget shows as a locked teaser. When only the role lacks it, the widget is hidden.
2. **Attention first.** The top of the page answers "what needs me now", across every module.
3. **Every KPI has a definition, a comparison and a link.** Each one carries a value, its change vs the previous equal period (and vs the same period last year once there is enough history), and an "open" link.
4. **One source of truth per number.** Widgets call the same libraries as the module pages (finance overview summary, inventory overview, CRM overview, channel console loaders). The dashboard never re-implements a calculation.
5. **Fast.**
   - The Today strip is server-rendered.
   - Sections load in parallel and fail independently.
   - Expensive figures come from a daily snapshot table, not live scans.
6. **India-correct.** IST days, the April to March financial year, INR with lakh/crore formatting, GST shown separately, COD treated as its own cash state.

## 3. Architecture

### 3.1 Widget registry (`lib/dashboard/widgets.ts`)

```ts
interface DashboardWidget {
  id: string                 // 'sales.revenue', 'ads.blended_roas'
  module: ModuleKey          // sales | ops | inventory | finance | customers | marketing | channels | reviews | b2b | ai | services | platform
  title: string
  scope: string              // plan + role scope, e.g. 'financial:read'
  minPlan: PlanSlug          // for the locked teaser: 'growth' | 'pro' | 'enterprise'
  kind: 'kpi' | 'chart' | 'list' | 'attention'
  size: 'sm' | 'md' | 'lg'
  load: (ctx: { range: Range; prev: Range; tenantId: string | null }) => Promise<unknown>
  href?: string              // where to act
  ttlSec?: number            // cache lifetime (default 300)
}
```

- `GET /api/admin/dashboard/summary?from&to&modules=` filters the registry by plan and role.
  - It runs the loaders in parallel with a per-widget timeout of about 4 seconds.
  - It returns `{ widgets: { [id]: { ok, data } | { ok: false, error } }, locked: [{ id, minPlan }] }`.
  - The route keeps its existing `dashboard:read` gate. Each widget then checks its own scope.
- Responses are cached in Redis per (tenant, widget, range) for `ttlSec`. A "refresh" button bypasses the cache.
- Existing loaders become widget loaders with no rewrite:
  - `getDashboardAnalytics`
  - the finance, inventory, reviews and CRM overview summaries
  - `lib/merchant/console-data`, `lib/amazon/console`, `lib/amazon-ads/console`, `lib/meta-ads/console`, the Google Ads console
  - `lib/social/data`

### 3.2 Daily snapshots (`dashboard_kpi_daily`)

```sql
CREATE TABLE public.dashboard_kpi_daily (
  date date NOT NULL,
  kpi  varchar(64) NOT NULL,
  dim  varchar(64) NOT NULL DEFAULT '',   -- e.g. channel, category, network
  value numeric(18,4) NOT NULL,
  PRIMARY KEY (date, kpi, dim)
);
```

- A nightly cron, `dashboard_snapshot` (tenant scope `dashboard:read`), writes about 40 point-in-time figures:
  - stock value at cost and at selling price; units on hand; low and out-of-stock SKUs
  - receivables, payables and COD outstanding
  - active customers (90 days); customers at risk; average rating and review count
  - wallet balance; open tasks; open RFQs; listings live per channel
- This fixes "turnover uses today's stock value" (inventory overview) and allows month-on-month and year-on-year trends for figures that are otherwise only "now".
- It goes in the usual schema pipeline: a new `database/dashboard.sql`, with PK and index in `constraints.sql` and `indexes.sql`, and an `APPLY_ORDER` entry.

### 3.3 Unified attention feed (`lib/dashboard/attention.ts`)

- One list, sorted by severity and then money at stake. Each source returns `{ key, module, severity, title, sub, amount?, href }`:
  - `channel_alerts`: Merchant, Amazon, Amazon Ads, Meta Ads, social, Google Ads
  - the overview "needs attention" lists: finance, inventory, CRM, reviews
  - orders, which today are the dashboard's alert chips
  - tasks, support, B2B
- Snooze for 24 hours and "done" are stored per admin in a new `dashboard_attention_state (admin_id, key, snoozed_until, done_at)` table.
- The same feed powers the bell, the morning digest (section 7) and the mobile view.

### 3.4 Layout, targets and saved views

- **Layout:** a new `admin_dashboard_layouts (admin_id, layout jsonb)` table holds each admin's section order and hidden widgets. Defaults come from the plan template (section 5). Staff can rearrange their own view only.
- **Targets:** a new `kpi_targets (kpi, period: 'month'|'quarter'|'fy', target, set_by)` table. Widgets with a target show progress and pace, e.g. "62% of the monthly revenue target with 48% of the month gone".
- **Saved views (Enterprise):** named filters across channel, category, warehouse and sales rep, such as "Amazon only" or "Chennai warehouse".

### 3.5 Locked teasers (upsell)

A locked widget renders its frame, a sample sparkline and one line of copy, for example "See ad spend and true ROAS across Google, Meta and Amazon: available on Pro". It links to the plan page. The copy lives in the registry, and nothing about the tenant's own data is shown.

## 4. Page layout (top to bottom)

1. **Header.**
   - Period presets: today, yesterday, 7 days, 30 days, this month, last month, this quarter, this FY, custom.
   - A compare toggle: previous period or same period last year.
   - The store status pill (live, maintenance, plan), last refreshed, refresh.
2. **Today strip, live:** today's sales, orders, visitors, conversion, AOV, COD vs prepaid, and orders still to ship. Each has a comparison with the same weekday last week.
3. **Needs attention:** the unified feed, top 8 with "see all".
4. **Targets:** progress bars for any set targets.
5. **Module sections:** KPI rows plus one chart and one list each, in the plan template's order (section 5).
6. **Quick actions and my tasks:** kept from today.

On mobile, the Today strip and Needs attention come first, and sections collapse into accordions.

## 5. What each plan sees

| Section | Services | Basic | Grow | Pro | Enterprise |
|---|:-:|:-:|:-:|:-:|:-:|
| API usage and wallet (services) | full | - | - | - | - |
| Today strip | - | yes | yes | yes | yes |
| Needs attention | wallet only | orders, stock, reviews | + returns, GST, CRM, inventory, tasks | + finance, channels, ads, social, B2B | + SLA breaches, team |
| Sales | - | core | + returns, invoices | + margin, P&L link | + targets, forecast |
| Orders and fulfilment | - | core | + returns, replacements, packing | + RTO cost, courier SLA | + per-warehouse |
| Inventory | - | stock counts only | full | full | + multi-warehouse, forecast |
| Customers | - | core | + CRM health, cohorts, loyalty | + B2B, subscriptions | + cohort LTV, segments |
| Finance | - | COD only | GST summary | full | + cash forecast |
| Website and traffic | - | visitors, top pages | + sources, funnel, search | + attribution by channel | same |
| Marketing | - | - | coupons, reviews, Google Ads | + email, campaigns, Meta Ads, social | + blended ROAS by target |
| Marketplaces (Merchant, Amazon) | - | - | locked | full | full |
| Ads (Google, Meta, Amazon) | - | - | Google Ads only | all three, blended | same + budgets vs target |
| Reviews | - | core | + forms and funnel | same | same |
| B2B (RFQs, quotations) | - | - | quotations | + RFQs, portal | same |
| AI and messaging usage | messaging | messaging spend | same | + AI agent usage | same |
| Team and operations | - | - | tasks | + support | + per-admin performance, audit |
| Scheduled reports and digest | - | weekly email | daily or weekly | + WhatsApp digest | + custom schedule, PDF |

Rows marked "locked" or "-" for a plan render as locked teasers when a higher plan has them. Services tenants (API-only) get a separate, smaller dashboard.

## 6. KPI catalogue

| Column | Meaning |
|---|---|
| Plan | The lowest plan that sees it |
| Src | Data source |
| Now | Something that already computes it: **D** = `lib/queries/dashboard.ts`; **F**, **I**, **R**, **C** = the finance, inventory, reviews and CRM overview summaries; **Ch** = a channel console loader; **new** = to be built |

All money figures are ex GST unless they say otherwise.

### 6.1 Sales

| KPI | Definition | Plan | Src | Now |
|---|---|---|---|---|
| Gross sales | Sum of order totals in the period, excluding cancelled | Basic | orders | D |
| Net sales | Gross minus returns/refunds minus discounts, ex GST | Basic | orders, return_requests | F |
| Orders | Order count, excluding cancelled | Basic | orders | D |
| Average order value | Net sales / orders | Basic | orders | D |
| Units sold | Sum of item quantities | Basic | order_items | D |
| Units per order | Units / orders | Basic | order_items | new |
| Paid orders % | Paid / all | Basic | orders | D |
| COD share | COD orders / orders, by count and value | Basic | orders | new |
| Prepaid share | 1 - COD share | Basic | orders | new |
| Discount rate | Coupon and discount value / gross sales | Grow | orders, coupon_usage | new |
| Sales by channel | Website, Amazon, POS/cash sale, B2B, marketplace | Basic | orders.source | F |
| Sales by payment method | Prepaid, COD, UPI QR, card, cash, credit | Basic | orders | F |
| Sales by category, brand, product | Top 10 each, with share and change | Basic | order_items, products | D (partly) |
| Sales by state and city | Map and top 10 | Grow | orders shipping address | new |
| Sales by hour and weekday | Heatmap | Grow | orders | new |
| New vs returning revenue | Split by the customer's first order | Grow | orders | C |
| Gross margin | (Net sales - COGS) / net sales | Pro | order_items, cost_price | F, D |
| Gross profit | Net sales - COGS | Pro | same | F |
| Cancellation rate | Cancelled / placed, split customer vs seller | Basic | orders | new |
| Draft and abandoned checkouts | Pending payment intents not converted, and their value | Grow | pending_payment_intents | new |
| Cart abandonment rate | Carts with items and no order in 24 h / carts | Grow | cart_items, orders | new |
| Recovered revenue | Orders after an abandonment message or nudge | Pro | message_logs, orders | new |
| Revenue vs target and pace | Section 3.4 | Enterprise | kpi_targets | new |
| Forecast for the period end | Run-rate plus weekday seasonality | Enterprise | snapshots | new |

### 6.2 Orders and fulfilment

| KPI | Definition | Plan | Src | Now |
|---|---|---|---|---|
| To confirm | Pending orders, and oldest age | Basic | orders | D (chip) |
| To ship | Confirmed or processing, not shipped | Basic | orders | D |
| Late to ship | Past the promised dispatch time (EDD settings) | Basic | orders, edd settings | new |
| In transit / delivered | Counts and value | Basic | orders, shipments | D |
| Time to dispatch | Median hours from paid to shipped | Grow | orders status history | new |
| Delivery time | Median days from shipped to delivered | Grow | same | new |
| On-time delivery % | Delivered by EDD / delivered | Grow | orders, EDD | new |
| RTO rate | RTO / shipped, by value and count; COD vs prepaid | Basic | orders | D (counts) |
| RTO cost | Forward plus return freight on RTOs | Pro | shipping charges | new |
| Return rate | Return requests / delivered, by reason | Grow | return_requests | D |
| Replacement rate | Replacements / delivered | Grow | replacements | new |
| Refunds pending | Refunds owed and not issued | Grow | F attention | F |
| Pickup failures | Failed or rescheduled pickups (Delhivery) | Basic | shipments | new |
| Shipping cost per order | Freight / shipped orders | Pro | shipping | new |
| Orders per warehouse | Split and backlog per warehouse | Enterprise | orders, warehouses | new |
| Courier SLA by zone | On-time % per zone and courier | Enterprise | shipments | new |

### 6.3 Inventory

All from the inventory overview (I) unless marked new.

| KPI | Plan |
|---|---|
| Stock value at cost and at selling price | Grow (Basic: counts only) |
| Units on hand; SKUs in stock, low and out | Basic |
| Out of stock but selling (lost-sales risk) | Basic |
| Days of cover (median and worst 10) | Grow |
| Inventory turnover (period and annualised; accurate once snapshots exist) | Grow |
| Reorder suggestions count and value | Grow |
| Dead stock: count and value tied up | Grow |
| Open POs, overdue POs and their value | Grow |
| Expiring batches (perishables) | Grow |
| Items without a cost price | Grow |
| Negative stock | Grow |
| Shrinkage, from stock adjustments marked damaged or lost (new) | Pro |
| Back-in-stock demand, from waiting notify requests per SKU (new: `back_in_stock_notify`) | Basic |
| Stock by warehouse and shelf utilisation (new) | Enterprise |

### 6.4 Customers

| KPI | Definition | Plan | Src | Now |
|---|---|---|---|---|
| New customers | First order in the period | Basic | orders | C |
| Active customers | Ordered in the period | Basic | orders | C |
| Repeat purchase rate | Customers with 2 or more orders / active | Basic | orders | C, D |
| Revenue per customer | Net sales / active | Grow | orders | C |
| Average lifetime value | Lifetime revenue / customers | Grow | orders | C |
| Cohort retention, months 1 to 6 | | Grow | orders | C |
| Time between orders | Median days | Grow | orders | new |
| At risk and dormant | CRM health | Grow | CRM | C |
| Churn risk | Count and value | Grow | CRM | C |
| Signups and accounts | New accounts, and account to first-order conversion | Basic | users, orders | D (signups) |
| Loyalty | Points issued, redeemed, liability (outstanding points x value), active members | Grow | loyalty_ledger, loyalty_accounts | new |
| Referrals | Referral signups, first orders from referrals, revenue | Grow | referrals, referral_signups | new |
| Subscriptions | Active, new, cancelled, MRR, churn %, next 7 days' renewals | Pro | subscriptions, subscription_cycle_orders | new |
| Wishlist demand | Most wishlisted products and wishlist-to-buy rate | Grow | wishlist_items | new |
| Support | Sessions, first-response time, unresolved, bot vs human handled | Pro | support_sessions, support_messages | new |

### 6.5 Website and traffic

| KPI | Definition | Plan | Src | Now |
|---|---|---|---|---|
| Visitors and sessions | Unique and total | Basic | page_events | D (conversion) |
| Conversion rate | Orders / sessions | Basic | page_events, orders | D |
| Funnel | Sessions, product view, add to cart, checkout, paid; drop-off at each step | Grow | page_events, cart_items, pending_payment_intents, orders | new |
| Traffic sources | Direct, organic, paid (Google, Meta), social, referral, email, marketplace; sessions, orders and revenue each | Grow | lib/analytics/traffic-sources, orders utm | partly |
| Top landing pages and top products viewed | | Basic | page_events | new |
| Product view to purchase | Per product, flags high-view low-buy items | Grow | page_events, order_items | new |
| Search | Searches, zero-result rate, top zero-result terms (catalogue gaps), search-to-purchase | Grow | search_queries, search_logs | new |
| Device split | Mobile vs desktop sessions and conversion | Grow | page_events | new |
| Storefront health | Uptime, slow pages, checkout errors | Pro | site-reachability | partly |

### 6.6 Marketing

| KPI | Definition | Plan | Src | Now |
|---|---|---|---|---|
| Coupons | Redemptions, discount given, revenue with coupon, top coupons, ROI | Grow | coupon_usage | new |
| Email campaigns | Sent, open %, click %, revenue (UTM), unsubscribes | Pro | email_campaign_logs, email events | partly |
| Automations | Abandoned cart, back in stock, birthday: sends and revenue | Pro | campaigns, message_logs | new |
| WhatsApp/SMS | Sent, delivered %, failed (e.g. 63049), cost, revenue | Grow | message_logs, wallet | new |
| Social | Posts, reach, engagement, orders and revenue per post, pending approvals, unanswered comments | Pro | lib/social/data | Ch |
| Reviews | Covered in 6.10 | | | |

### 6.7 Advertising (blended)

| KPI | Definition | Plan | Src | Now |
|---|---|---|---|---|
| Ad spend | Google, Meta and Amazon, total and per platform | Grow (Google), Pro (all) | ads_daily_metrics, mads_daily_metrics, aads_daily_metrics | Ch |
| Platform-reported ROAS | Per platform | same | same | Ch |
| True ROAS | Our own orders attributed to each platform (gclid, fbc, utm) / spend | Pro | orders + spend | Ch (Meta, Google) |
| Blended ROAS / MER | All net sales / all ad spend | Pro | orders + spend | new |
| Cost per order and CAC | Spend / ad-attributed orders; spend / new customers | Pro | same | new |
| ACoS and TACoS | Amazon: ad spend / ad sales; ad spend / all Amazon sales | Pro | aads, amazon sales | Ch |
| Wasted spend | Spend on search terms or ads with no orders in 14 days | Pro | ads and aads search terms | Ch |
| Budget pacing | Month-to-date spend vs monthly budget per platform | Enterprise | spend + kpi_targets | new |

### 6.8 Marketplaces and feeds

| KPI | Definition | Plan | Src | Now |
|---|---|---|---|---|
| Google Merchant | Products approved, limited and disapproved; free-listing clicks and orders; price competitiveness; best sellers not listed | Pro | gmc_* | Ch |
| Amazon | Sales, units, sessions, Buy Box %, suppressed listings, loss-making SKUs, estimated profit, next payout | Pro | amazon_* | Ch |
| Amazon order sync | Imported today, unmatched SKUs, stock drift | Pro | amazon_orders, amazon_inventory_state | Ch |
| Channel share | Revenue by website vs Amazon vs others, and its trend | Pro | orders.source | F |

### 6.9 Finance

From the finance overview (F) unless marked new.

| KPI | Plan |
|---|---|
| Inflow, outflow, net cash | Pro |
| Receivables outstanding and aging; payables due in 7 days and overdue | Pro |
| COD awaiting remittance, and COD in transit | Basic |
| Refunds issued and refunds pending | Grow |
| GST payable (output minus ITC); GSTR-1 and 3B filing due dates (new) | Grow |
| TCS/TDS on marketplace settlements (Amazon) | Pro |
| Payment gateway fees and settlements: Razorpay fees, next settlement (new) | Pro |
| Cash runway: cash plus receivables minus payables over average weekly outflow (new) | Enterprise |
| Cash forecast for the next 4 weeks: expected COD remittances, settlements, payables (new) | Enterprise |

### 6.10 Reviews and reputation

From the reviews overview (R) unless marked new.

| KPI | Plan |
|---|---|
| New reviews, average rating and trend, % 4-5 and % 1-2 stars | Basic |
| Pending moderation | Basic |
| Review requests, then opened, then submitted: conversion | Grow |
| Best and worst rated products; rating drops | Grow |
| Google Business Profile reviews: count, rating, unanswered (new, from the social inbox) | Pro |
| Reply rate and time to reply | Pro (needs a reply column) |

### 6.11 B2B

| KPI | Plan | Src |
|---|---|---|
| Quotations: sent, accepted %, value, expiring this week | Grow | quotations |
| RFQs: open, awaiting our response, response time, conversion to order | Pro | business_rfqs, rfq_messages |
| B2B revenue and share; top B2B customers; credit outstanding | Pro | orders, receivables |

### 6.12 AI, messaging and wallet

| KPI | Plan | Src |
|---|---|---|
| Messaging wallet balance, spend today and per period, days left at the current burn | Basic | wallet, message_logs |
| Messages by channel and status, failure reasons | Basic | message_logs |
| AI agent: questions, actions taken, AI spend | Pro | admin_agent_messages |
| Catalogue AI: enrichments run and approved | Pro | catalog enrichment |

### 6.13 Team and operations

| KPI | Plan |
|---|---|
| Open tasks, overdue tasks, tasks by assignee | Grow |
| Support load per agent | Pro |
| Orders handled per admin (confirmed, packed, shipped), from the audit log | Enterprise |
| Admin activity and sign-ins; risky actions | Enterprise (audit) |
| Integration health: connected channels, failing syncs, tokens expiring | Pro |

### 6.14 Services plan (API-only tenants)

| KPI | Src |
|---|---|
| API calls today and per period by endpoint; error rate; p95 latency | public-api logs, new |
| Messages sent by channel and status; delivery %; cost | message_logs |
| Documents rendered by type; bulk jobs | documents |
| Wallet balance, burn rate, days left; top-up history | wallet |
| Active API keys; last used; rate-limit hits | api keys |

That is about 150 KPIs across 14 modules. A Basic store sees about 35, Grow about 75, Pro about 130, and Enterprise all of them.

## 7. Outside the page

- **Morning digest at 9:00 IST,** by email, plus WhatsApp on Pro and up. It carries yesterday's numbers vs the same weekday last week, the top 5 attention items, and progress against targets. It is built from the same summary endpoint and attention feed.
- **Weekly and monthly reports.** Enterprise gets PDFs from the document service (a new `dashboard_report` design) on a custom schedule.
- **Anomaly alerts.** These fire when a KPI moves more than 3 standard deviations from its 28-day weekday baseline (from the snapshots): sales drop, RTO spike, conversion drop, ad spend spike. They go into `channel_alerts` under a new `dashboard` channel.
- **Ask the dashboard.** The AI admin agent (Pro and up) gets a `dashboard_kpi` tool that reads the registry, so "why did sales drop yesterday" is answered from the same numbers.

## 8. Phases

| Phase | Scope | Size |
|---|---|---|
| 1. Foundation | Widget registry; summary endpoint with plan and role filtering, timeouts and cache; header, period and compare controls; Today strip; locked teasers; port the existing dashboard analytics into widgets; wire in the finance, inventory, CRM and reviews overview summaries | 1 to 1.5 weeks |
| 2. Attention and snapshots | Unified attention feed with snooze and done; `dashboard_kpi_daily` and the nightly cron; trends for point-in-time KPIs | 1 week |
| 3. New KPIs, Basic and Grow | Sales mix (state, hour, COD share, discounts); fulfilment times and on-time %; funnel, search and abandonment; coupons, loyalty, referrals and wishlist; messaging and wallet | 1.5 weeks |
| 4. Pro modules | Blended advertising; marketplaces; finance extras; subscriptions; B2B; support; AI usage; integration health | 1 week (mostly reusing console loaders) |
| 5. Enterprise | Targets and pacing; forecasts and cash runway; per-warehouse and per-admin views; saved views; scheduled PDF reports | 1 to 1.5 weeks |
| 6. Digest and anomalies | Morning digest (email, WhatsApp); anomaly alerts; the agent tool; mobile polish | 1 week |
| 7. Services dashboard | The API-only tenant home | 3 to 4 days |

Each phase ships on its own and is gated by plan, so lower plans never wait on Enterprise work.

## 9. Testing and verification

- **Registry tests:**
  - every widget's scope exists in `TENANT_SCOPE_KEYS`
  - `minPlan` matches the seed plans
  - Basic, Grow, Pro and Enterprise fixtures each get the widget set in section 5
- **Calculations:**
  - each new KPI's SQL lives in a pure, testable module, with fixtures for the edge cases: cancelled, returned, COD, Amazon/FBA, GST, and zero denominators shown as "-"
  - a consistency test checks that each dashboard widget and its module page return the same number for the same range
- **Performance:** the summary endpoint finishes under 1.5 s at p95 with the cache cold, on a 50k-order fixture.
- **Snapshots:** the cron is idempotent per date, and a missed day is backfilled.
- **Access:** a staff admin without `financial:read` never receives finance widget data, even when the plan has it (route test).

## 10. Open questions for the owner

1. Should KPIs show GST-inclusive or ex-GST sales by default? The plan proposes ex GST, with a toggle.
2. Should targets be set by the owner only, or by any admin with `settings:write`?
3. Digest recipients: owner only, or every admin who opts in?
4. Are Services-plan tenants allowed to see store modules as teasers, or is their dashboard API-only?
5. Should Basic see the locked teasers, or would a lighter upsell banner fit better?
