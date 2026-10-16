# Overview analysis for every admin page

Status: in progress (2026-10-16). This is the companion to `MAIN_DASHBOARD_PLAN.md`: every module page opens on an Overview tab that answers "how is this area doing, and what needs me", and the main dashboard reuses the same summaries.

## Shared kit (built)

| Piece | What it does |
|---|---|
| `lib/overview/period.ts` | IST presets (today, yesterday, 7d, 30d, this month, last month, 90d, this FY), `parsePeriod`, `previousPeriod`, `bucketFor` (day/week/month), `istRangeSql`, `delta`, `ratio` |
| `components/admin/overview/kit.tsx` | `usePeriod` (kept in `?from&to`), `PeriodBar` (presets, custom dates, compare label, refresh), `useOverviewData` (results tagged with their URL, so stale data never renders), `AttentionList`, `OverviewSkeleton` |
| `components/admin/channels/ui.tsx` | `Kpi` (with change vs previous), `KpiGrid`, `Section`, `Table`, `Badge`, `money`, `count`, `pct` |

### Every overview follows the same contract

1. **One endpoint** per area: `GET /api/admin/<area>/overview?from&to`. It is gated by that area's read scope, does its work in SQL on the server, and returns the current period, the previous period and an `attention[]` list.
2. **Layout:** period bar, then KPI grid with changes, then Needs attention, then one or two charts, then top lists that link to where you act.
3. **Overview first:** it is the default tab. Existing list views move to their own tab, and old URLs keep working.

## Which pages get what

Tiers:
- **Full:** a complete overview with KPIs, trends, attention and top lists.
- **Strip:** a KPI strip and attention list above the existing list. Used where the page is mainly a work queue.
- **None:** settings or utility pages.

| Page | Tier | Overview content | Status |
|---|---|---|---|
| Dashboard | - | See `MAIN_DASHBOARD_PLAN.md` | planned |
| Finance | Full | Sales, margin, cash, GST, aging, payment mix | done |
| Inventory | Full | Value, turnover, cover, reorder, dead stock | done |
| CRM | Full | Customer KPIs, cohorts, top customers | done |
| Reviews | Full | Ratings, funnel, best and worst products | done |
| Traffic | Full (8 tabs) | Sessions, acquisition, funnel, search, audience, real-time | in progress |
| Merchant, Amazon, Amazon Ads, Meta Ads, Google Ads, Social | Full | Channel consoles | done |
| GST, Wallet | Strip | Existing | done |
| **Orders** | Full | Placed, value, AOV, status pipeline, to confirm, to ship, late to ship, dispatch and delivery times, on-time %, cancellations by reason, COD vs prepaid, RTO rate, by channel and state | this round |
| **Delhivery (shipping)** | Full | Shipments, in transit, delivered, RTO, NDR/failed attempts, pickups pending or failed, delivery time by zone, COD collected vs remitted, freight cost per order | this round |
| **Returns** | Full | Return rate, by reason and product, refund value, time to process, pending inspection, restock vs damaged | this round |
| **Replacements** | Strip | Rate, by reason, pending, time to close | this round |
| **Products** | Full | Catalogue health (no image, description, HSN/GST, cost, or price; inactive; out of stock), top sellers, most viewed, never sold, recently added, price changes | this round |
| **Categories, Brands** | Strip | Products, stock value, sales and margin per category or brand; empty or unused ones | this round |
| **Offers** | Strip | Active, expiring, revenue with offer | this round |
| **Catalogue enrichment** | Strip | Products enriched, pending approval, approval rate, fields filled | this round |
| **Bulk price (inflation)** | Strip | Price changes applied, products affected, average change, last run | this round |
| **Invoices** | Full | Invoiced value, GST collected, paid vs unpaid, overdue and aging, e-invoice coverage, by GST rate | this round |
| **Quotations** | Full | Sent, accepted, conversion, pipeline value, expiring this week, average time to accept, top customers | this round |
| **Cash sale (POS)** | Full | Sales today and in period, bills, average bill, by payment mode, by cashier, by hour, top items | this round |
| **Subscriptions** | Full | Active, new, cancelled, MRR, churn %, renewals due in 7 days, failed renewals | this round |
| **Customers** | Strip | New, active, repeat %, accounts vs guests, top states, with a link to CRM for depth | this round |
| **Coupons** | Full | Redemptions, discount given, revenue with coupon, discount as % of revenue, top coupons, expiring, unused | this round |
| **Customer programs (loyalty, referrals)** | Full | Points issued, redeemed and liability, active members, tiers; referral signups, first orders, revenue, top referrers | this round |
| **Campaigns** | Full | Sends, delivered, opens, clicks, conversions and revenue (UTM), unsubscribes, by campaign and channel | this round |
| **Marketing messaging** | Full | Messages by channel and status, failure reasons (e.g. 63049), spend, templates used | this round |
| **Review forms** | Strip | Forms, submissions, conversion from requests | this round |
| **B2B customers and RFQs** | Full | RFQs open, awaiting reply, response time, conversion to order, quoted vs won value, top B2B customers, credit outstanding | this round |
| **Suppliers** | Full | Spend, open POs, on-time delivery %, average lead time, top suppliers, payables due | this round |
| **Tasks** | Strip | Open, overdue, completed, by assignee, average time to complete | this round |
| **Shelving** | Strip | Locations, utilisation, unassigned stock | this round |
| **Team** | Strip | Admins, active in period, sign-ins, MFA coverage | this round |
| **Audit** | Strip | Actions by admin and type, risky actions, failed sign-ins | this round |
| **AI agent** | Strip | Conversations, actions taken, tools used, AI spend | this round |
| **Platform: ecom customers, billing, instances, store status** | Full (platform only) | Tenants by plan, MRR and ARR, new and churned, trials, failed payments, instance health, stores down | this round |
| Packing slips, labels, scan | Strip | Printed or scanned today, by user | this round (light) |
| Settings, controls, service accounts, data source, login | None | Configuration pages | - |
| Loyalty, referrals, mailer, merchant-sync | None | Redirect pages | - |

## Delivery

The work is split across six parallel agents, each owning separate folders: orders and fulfilment; catalogue; sales documents; customers and marketing; B2B and operations; platform. Each one:
- uses the shared kit;
- adds tests for its pure helpers and routes;
- passes the typecheck and the scope audits.

The integrator runs the full suite, then commits.
