# Entity timelines (status and key-parameter history)

Status: proposed (2026-10-17).

Goal: for the records that matter (orders first), keep an ordered history of every change to a few important parameters, and show it as a timeline. For an order that means every order status, payment status, shipment status, refund and COD remittance step, with who or what made the change and when it really happened.

## 1. What exists today

**History-like tables**

| Table | What it holds | Usable for timelines? |
|---|---|---|
| `order_status_history` (`orders.sql`) | order_id, status, comment, created_by, created_at | Declared but **never written or read** by any service. Empty in practice. |
| `admin_audit_log` (`logs.sql`) | admin_id, action, entity_type, entity_id, summary, `diff` jsonb `{field: {from, to}}` | Written two ways: `logAdminAudit()` in `lib/shared/admin-audit.ts` (about 23 callers) and the `audit_row_change()` trigger (`functions.sql`, `triggers.sql`) on products, variants, purchase_orders, purchase_order_items, grns, suppliers, coupons, campaigns and a few others. **Not on orders, returns, quotations, invoices, subscriptions, RFQs or tasks.** Best backfill source for products and POs. |
| `inventory_transactions`, `shelf_stock_transactions` | every stock movement with quantity_after, reference | Already a full stock ledger; the timeline links to it rather than copying it. |
| `customer_activity_log` (`crm.sql`) | per-customer feed (kind, reference, summary) | Feeds the existing `CustomerTimeline.tsx`. Event feed, not field history. |
| `customer_health_history` | health score snapshots | Keep as is. |
| `channel_change_log`, `ads_change_log`, `amazon_sync_log`, `merchant_sync_log`, `scenario_audit_log` | per-integration change logs | Out of scope; they already have their own UIs. |
| `payments` (`payments.sql`) | one row per payment attempt, status, gateway_response | Current state only; status is overwritten (pending to completed, failed, refunded). |
| `order_adjustments` | `refunds` jsonb array, `refund_status` | Has refund attempts with timestamps; backfill source. |
| `email_logs`, `message_logs` | sends per order/customer | Optional "communication" lane on the order timeline. |

**Timestamp columns that imply history:** `orders.confirmed_at, shipped_at, delivered_at, cancelled_at, cod_remitted_at, delhivery_billed_at, irn_cancelled_at`; `return_requests.received_at, resolved_at, reviewed_at, valuated_at, rvp_created_at`; `subscriptions.cancel_requested_at, paused_at, cancelled_at, last_renewed_at`; `business_rfqs.reviewed_at`; `customer_tasks.completed_at`. These give the "when" of the main steps for backfill but lose repeats and reversals.

**Delhivery scans** are fetched live (`components/DelhiveryTracking.tsx`, the track routes, `delhivery/sync-statuses` cron) and reduced to `orders.shipment_status` by `lib/shipping/shipment-status.ts`. The raw scans are not stored.

**Existing timeline UI:** only `CustomerTimeline.tsx` on the customer view (activity feed). The order view page shows current status pills, the timestamp columns and the live Delhivery tracking card; there is no status history.

**Where status fields are written: not centralised.** 37 files run `UPDATE orders ...` directly, including the storefront order routes, `webhooks/razorpay` (paid, failed, refunded, payment-link expired, QR paid), `razorpay/verify`, admin `orders/[id]` (status), `orders/[id]/payment-status`, cancel, create-shipment, cancel-shipment, `delhivery/sync-statuses`, `financial/cod-remittance`, `lib/orders/orders.ts` (`cancelOrder`), `lib/orders/adjustments.ts`, variant/address change, `lib/amazon/orders.ts`, `lib/shipping/courier-edd.ts`, and the agent approval actions. Returns, RFQs, tasks and subscriptions are similarly spread (returns routes, `lib/subscriptions/*`, `lib/shared/auto-tasks.ts`, business RFQ routes). Only product and PO changes are caught centrally, by the audit trigger. `lib/shared/db.ts` already sets the `audit.admin_id` GUC on every query and transaction, which the trigger reads.

## 2. Entities and parameters, by priority

| P | Entity | Tracked parameters |
|---|---|---|
| 1 | Order | `status`, `payment_status`, `shipment_status`, `payment_link_status`, `irn_status`, `awb_number` (assigned/cleared), `estimated_delivery_date`, COD remitted (`cod_remitted_at`), `payment_mode` |
| 1 | Shipment (per order, also RVP) | each Delhivery scan as an event (status type, location, remark, scan time) |
| 1 | Payment | `payments.status` per attempt; refund initiated/processed/failed (from `order_adjustments.refund_status` and the Razorpay refund webhook) |
| 2 | Return request | `status`, `valuation_status`, RVP AWB assigned, received, resolved, replacement order created |
| 2 | Order adjustment / variant change / address change | `status`, `refund_status` |
| 2 | Purchase order | `status` (draft, sent, partial, received, cancelled), received share on each GRN, payable/payout events |
| 2 | Quotation | `status` (draft, sent, accepted, converted, expired) |
| 2 | Invoice | draft to finalized, e-invoice IRN generated/cancelled, paid (via the order) |
| 3 | Subscription | `status`, renewals, pause/resume, cancel requested |
| 3 | Business RFQ | `status` |
| 3 | Product | `price`, `sale_price`, `is_active`, stock status (in/low/out, derived from the inventory ledger, not every movement) |
| 3 | Customer | tier, tags added/removed, B2B approval |
| 3 | Customer task | `status`, assignee |

Reviews, social posts and campaigns already have status plus their own logs; leave them out until someone asks.

## 3. Design

### Options

- **Per-entity history tables** (`order_status_history` style): simple queries, but a table, write path and API per entity, and every new parameter needs schema work. The one we have was never wired.
- **App-only helper** (`recordChange()` beside each update): carries actor, reason and provider time well, but with 37 order writers plus raw SQL elsewhere, some writes will be missed and the history silently lies.
- **DB trigger only:** catches every write including raw SQL and scripts, but knows nothing about why or the provider's event time.

### Recommendation: one generic table, filled by a narrow trigger, enriched by app context

1. **Table `entity_timeline`** (new topic file `database/timeline.sql`; PK in `constraints.sql`; indexes in `indexes.sql`; no migration file):

   `id bigint` (sequence), `entity_type varchar(32)`, `entity_id uuid`, `field varchar(48)`, `from_value text`, `to_value text`, `source varchar(16)` (admin, customer, system, webhook, cron, agent, backfill), `actor_id uuid`, `actor_label text` (email or "Razorpay", "Delhivery"), `reason text`, `metadata jsonb default '{}'` (scan location, refund id, amount, GRN id), `event_key text` (provider event id for idempotency), `occurred_at timestamptz not null`, `created_at timestamptz default now()`. CHECK on `source`.

   Indexes: `(entity_type, entity_id, occurred_at)` for the timeline read; `(entity_type, field, to_value, occurred_at)` for analytics; unique partial `(entity_type, entity_id, field, event_key) WHERE event_key IS NOT NULL` for webhook and scan idempotency.

2. **Trigger `timeline_capture()`** (`functions.sql`, `triggers.sql`), `AFTER UPDATE OF <tracked columns>` plus `AFTER INSERT` (initial state), on orders, payments, return_requests, order_adjustments, purchase_orders, quotations, invoices, subscriptions, business_rfqs, customer_tasks, and products limited to price, sale_price and is_active. For each tracked column where `OLD IS DISTINCT FROM NEW` it inserts one row. The tracked column list per table is passed as trigger arguments, so adding a parameter is a `triggers.sql` change only. It reads optional session context with `current_setting(..., true)`: `audit.admin_id` (already set by `db.ts`), and new `timeline.source`, `timeline.actor_label`, `timeline.reason`, `timeline.occurred_at`, `timeline.event_key`. Missing context defaults to `source = 'system'`, `occurred_at = now()`, so nothing is ever skipped. Same pattern and skip switch as the existing `audit_row_change()`.

   Why the trigger: it closes the gap of 37 scattered writers and raw SQL without touching their logic, it runs in the writer's transaction (the history can't disagree with the row), and it works unchanged in every per-tenant DB because it ships with the schema.

3. **App helpers in `controller-service/src/lib/timeline/`**:
   - `withTimelineContext(ctx, fn)`: wraps `withTransaction`, sets the `timeline.*` GUCs with `set_config(..., true)` (transaction-local), then runs the existing update. Used where we know more than the trigger can (webhooks: provider event time and id; admin routes: reason/note; customer routes: `source = customer`).
   - `recordEvent(client, {...})`: direct insert for things that are events, not column changes: Delhivery scans, refund attempts, COD remittance batch, IRN generation, GRN receipts, emails sent. `ON CONFLICT DO NOTHING` on the event_key index.
   - `getTimeline(entityType, id, {fields})`: one read query, also merging links into existing ledgers (inventory transactions for products, `customer_activity_log` for customers) rather than duplicating them.

   The same table and helpers are usable from messaging-service and document-service, since all services share the one DB; put the read/write helpers in a small `packages/timeline` only if a second service actually needs them.

### Ordering, webhooks and idempotency

- Display and analytics order by `occurred_at` (provider time: Razorpay `created_at` of the event, Delhivery `ScanDateTime`), tie-broken by `id`. `created_at` stays as the insert time for debugging lag.
- Replays: webhook handlers set `timeline.event_key` to the Razorpay event id (`x-razorpay-event-id`) or a payment/refund id; scans use `awb + scan time + scan code`. The unique partial index makes a replay a no-op. Handlers already guard state (`WHERE payment_status != 'paid'`), so a stale or duplicate event does not change the row and the trigger writes nothing.
- Out of order events: a late `payment.failed` after `paid` is blocked by the existing guards; if it is still worth showing, the handler can `recordEvent` it with `metadata.ignored = true` so the UI shows it greyed.
- Shipment scans: the track route and the sync cron pass the scan list to `recordEvent`; the idempotency key means re-polling every few hours adds only new scans. `shipment_status` changes still come from the trigger.

### Volume, retention, tenancy

- Rough size: under 15 rows per order plus 5 to 15 scans; small next to `page_events` and `message_logs`. No partitioning now; revisit past about 20 million rows.
- Retention: keep order, invoice and payment history for at least 8 years (GST record keeping). Product price/active history can be trimmed to 2 years by a cron if it grows.
- Multi-tenant: the table, function and triggers live in the main schema files, so `release-db.sh` and the tenant fan-out create them in every tenant DB. No tenant_id column; tenancy is the DB.

### Backfill (one-off script, idempotent via `source = 'backfill'` plus `event_key = 'bf:<table>:<id>:<field>'`)

- Orders: synthesise rows from `created_at` (placed), `confirmed_at`, `shipped_at`, `delivered_at`, `cancelled_at`, `cod_remitted_at`, current `payment_status` (at `updated_at` if not unpaid), `irn_status`. Marked as approximate in metadata.
- Payments: one row per payment at its `created_at` and current status at `updated_at`.
- Refunds: from `order_adjustments.refunds` entries.
- Returns, subscriptions, RFQs, tasks: from their timestamp columns.
- Products and POs: replay `admin_audit_log.diff` for the tracked fields; this is real history, not approximated.
- Delhivery scans for open and recently delivered orders: one pass through the track API in the sync cron's batch size.
- `order_status_history`: empty today; drop it from `orders.sql` once the new table is live.

## 4. UI

**Shared component** `components/admin/timeline/Timeline.tsx`, app-native, using the admin kit and the 32px control height:

- Vertical list grouped by day (IST), newest first with a toggle for oldest first.
- Each row: time, a colour dot per parameter (order status, payment, shipment, refund, document, note), `from → to` chips using the existing status pill colours, actor and source badge (Admin name, Customer, Razorpay, Delhivery, Cron, Agent), reason/note, expandable metadata (scan location, refund id, amount).
- Duration between steps on the connector line ("1d 4h"), and a summary strip at the top for the key spans: placed to paid, paid to shipped, shipped to delivered.
- Filter chips per parameter (All, Status, Payment, Shipment, Refunds); shipment scans collapsed to a single "N scans" group unless the Shipment filter is on.
- Mobile: single column, chips wrap, metadata in the existing `MobileDetailSheet`.

**Where it appears**

- Order view: a Timeline section/tab with all lanes merged in one list (filters split them); the current Delhivery tracking card stays for live tracking.
- Return/replacement view, purchase order view, quotation, invoice, subscription, RFQ, task: the same component filtered to that entity.
- Customer view: keep `CustomerTimeline` as the activity feed; add a link from each order event to the order timeline.
- Product view: price/active changes plus a link to the inventory ledger.

**API:** `GET /api/admin/<entity>/[id]/timeline?fields=` per entity, each gated by that entity's read scope (`orders:read`, `returns:read`, purchase-order and quotation read scopes, etc.), mapped in `lib/auth/scopes.ts` like the other routes. All call `getTimeline`.

**Storefront (optional, later):** the customer's order page shows a simple status-only progress list (placed, paid, shipped, out for delivery, delivered, cancelled/returned) from the same table, never admin notes, actors or internal fields. Reuse on the business account order page.

## 5. Analytics

- Time in status and step durations per order (placed to paid, paid to shipped, shipped to delivered, delivered to COD remitted) as SQL over `entity_timeline` with window functions.
- SLA breaches: confirmed but not shipped within N hours, shipped but not delivered by EDD, COD delivered but not remitted after N days, return received but not resolved. These feed the Orders, Returns and Delhivery overviews' `attention[]` lists and KPIs (median ship time, % shipped within SLA) per `PAGE_OVERVIEWS_PLAN.md`.
- PO lead time (sent to fully received) per supplier for the Suppliers overview; quote-to-accept time for Quotations.

## 6. Phasing

1. **Schema and capture:** table, function, triggers on orders and payments only; `lib/timeline`; order timeline API and the Timeline component on the order view. No changes to existing update code.
2. **Context and events:** `withTimelineContext` in the Razorpay webhook, verify, admin status/payment-status/cancel routes, COD remittance; `recordEvent` for Delhivery scans and refunds. Order backfill.
3. **Other entities:** returns, adjustments, POs, quotations, invoices, subscriptions, RFQs, tasks, products; their pages get the component; backfill from `admin_audit_log` and timestamps.
4. **Analytics and storefront:** SLA queries into the overviews; customer-facing order progress.

## Risks

- **Breaking existing writes:** the trigger is AFTER, inserts only, and wraps its body in an exception handler that logs and returns, so a timeline failure can never fail an order update. `audit.skip`-style switch (`timeline.skip`) for bulk imports.
- **Noise:** only listed columns are tracked; `updated_at` and derived fields are ignored; bulk product imports set `timeline.skip` or are summarised.
- **Context leaking between requests:** GUCs are set transaction-local only, never session-level.
- **Backfilled rows look precise when they are not:** marked `source = 'backfill'` and shown with an "approximate" hint.
- **Double recording** (trigger plus `recordEvent` for the same change): rule is column changes come only from the trigger; `recordEvent` is for non-column events.

## Verification

- Locally (port 5432, `jeffi_production_ready`): place a test order, pay via Razorpay test mode, create shipment, run the Delhivery sync, mark COD remitted, cancel another; check the order timeline shows every step in provider-time order with correct actors.
- Replay a captured Razorpay webhook twice; confirm no duplicate rows.
- Run a raw `UPDATE orders SET status = ...` in psql; confirm it appears as `source = system`.
- Run the backfill twice; row count unchanged on the second run.
- Release through `release-db.sh` and check a tenant DB has the table and triggers.
- No new test suites; extend the existing tests only if a helper ends up with real logic (for example the duration formatter).
