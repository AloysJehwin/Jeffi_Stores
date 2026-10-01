# Admin overview pages — financial, inventory, RFQs

New Overview section (a tab like the others, set as the default/first tab) on financial and inventory; orders-style KPI + chart components on the RFQs page. Built one verified batch at a time, financial first. Local commits, never push. Reuse existing endpoints/queries — no invented numbers.

## Batch 1 — Financial Overview tab

Add `OverviewTab` as the first/default tab in `FinancialClient.tsx`. KPIs sourced from the existing financial endpoints (`/api/admin/financial/{transactions,receivables,payables,cashflow,cod-remittance,pl}`):

KPI cards (responsive grid, no fixed grid-cols overflow):
- Total Inflow (period) — transactions.summary.total_inflow
- Total Outflow (period) — transactions.summary.total_outflow
- Net cash — transactions.summary.net (surplus/deficit)
- Receivables outstanding — receivables total unpaid
- Payables due — payables total unpaid; highlight overdue count
- COD pending remittance — cod-remittance pending total

Indicators / small viz:
- Net revenue (P&L) for the period
- A small cashflow trend (reuse cashflow monthly data) if cheap; else a compact in/out bar.

Behaviour: Overview is the default tab; the other tabs unchanged. One period selector (reuse the existing from/to if present) drives the figures. Loading skeletons; graceful empty states. Reduced-motion safe. Mobile: cards stack (grid-cols-1 sm:grid-cols-2 lg:grid-cols-3), no overflow.

## Batch 2 — Inventory Overview tab

Add `OverviewTab` as the first/default tab in `InventoryClient.tsx`. KPIs from the inventory data already loaded (suppliers, purchase orders, stock ledger/valuation):
- Total stock value (valuation)
- Low-stock / out-of-stock SKU count (indicator, warning color)
- Open purchase orders (count + value)
- Suppliers (active count)
- Recent stock movements (small list or count)
- Pending goods receipts (if available)

Same behaviour rules as financial (default tab, others unchanged, responsive, skeletons, empty states).

## Batch 3 — RFQs page, orders-style components

The RFQs page gains the orders top section (image not received; parameters chosen to match orders):
- KPI stat cards: Total RFQs, Open, Quoted, Won, Lost (or Expired) — from the RFQ list data already queried.
- A small trend chart: RFQs received over time (mirror RevenueTrendChart’s shape/placement) if the data supports it; else omit.
- Keep the existing filters, status tabs, sortable table, and mobile list.
Match the orders page layout: stats → chart → filters → table. Reuse AdminFilters/Pagination/SortableHeader where applicable.

## Constraints (all batches)
- Reuse existing endpoints/queries; do not invent figures or add fake data.
- Desktop unchanged for existing tabs; only add the Overview tab + its content.
- Responsive KPI grids (no fixed grid-cols-3/4 that overflow mobile).
- Mobile read-only policy still holds (overview is read-only by nature).
- tsc 0 real errors, CSS build Done, full suite green, graphify refresh. Files under 500 lines.
