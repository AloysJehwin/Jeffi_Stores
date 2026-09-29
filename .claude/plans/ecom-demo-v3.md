# Ecom demo v3: full-bleed, six flows, map tracking, SVG products

## Decisions (user)
- Responsive full-bleed stage on /ecom (fills viewport width, ~88vh desktop, adapts every display; no fixed px, no inner scroll). Pricing REMOVED from the landing (user will revisit pricing separately).
- Six flows in ONE build: (1) Customer buys, (2) Store owner fulfils, (3) Marketing & CRM [keep+polish], plus (4) Inventory & catalogue, (5) Payments/GST/Finance, (6) Returns/Quotations/B2B.
- Flows must mirror the REAL product (~70%), from the app survey (subagent ad901ea6b702375f8) — use its real statuses/fields, not invented ones.
- Shipment: animated stylised map + moving courier dot + vertical courier timeline (not a plain "shipped" label).
- Product images: generated inline SVG illustrations per category (store-neutral, no network, blue theme).
- Blue accent everywhere (done). No emojis. Dummy data only, no network in demo/. Files < 500 lines.

## Real product facts (from survey) — flows mirror these
- Order status: pending -> confirmed -> processing -> shipped -> out_for_delivery -> delivered. Payment: unpaid/paid/cod_collected; methods razorpay|cod (COD handling fee).
- Product: base_price (NOT price), mrp, gst_percentage(18), hsn_code, stock_status 'In Stock'|'Low Stock'|'Out of Stock', inventory_quantity, low_stock_threshold, sku. Draft->Publish model.
- Shipment (Delhivery): create AWB (name/pin/city/state/phone/payment_mode COD|Prepaid/cod_amount/weight/dims) -> awb_number, shipment_status created->picked_up->in_transit->out_for_delivery->delivered. Packing slip + shipping label (label only once AWB exists).
- Invoice: number JS/2025-26/001; taxable_amount,cgst,sgst,igst,buyer_gstin; status draft->finalized.
- Settlement (tenant Route): tenant_transactions captured -> settled/refunded; gross_amount, tenant_share, platform_commission(~5%), gateway_fee, is_cod.
- Financial tabs: receivables/payables/transactions/pl/cashflow/cod_remittance; payout modes IMPS/NEFT/RTGS/UPI.
- Inventory: stock levels + status, low-stock threshold, batches (lot/expiry), serials (in_stock/sold/returned/damaged/lost); Suppliers (payment_terms); Purchase Orders po_number status draft->sent->received (GRN, partial).
- Returns: return_requests type refund|replacement; status pending_approval->approved->received->completed (or rejected); reason defective/wrong_item/not_as_described/damaged/other.
- Quotations: status draft|final; quote_number, consignee/buyer gstin, items hsn/gst_rate/qty/unit/rate/discount; convert->invoice. RFQ (B2B): pending->reviewed->negotiating->offer_accepted->converted; business_profiles approval pending/approved/rejected; per-category discounts.
- Marketing: campaigns kind slug + enabled(Active/Paused), per-recipient Sent/Opened/Clicked; coupons percentage|fixed (code, discount_value, min_purchase, usage_limit); mailer draft/scheduled/sending/sent; reviews boolean is_approved (Pending/Approved).
- CRM: tags[], health_score (healthy>=70/at_risk 40-69/critical<40), segments vip/loyal/b2b/repeat/new/at_risk/dormant; lifetime_value, total_orders, AOV.
- Dashboard KPIs: Revenue, Orders, Avg Order Value, Customers, Gross Margin, Paid Orders, Units Sold, Conversion, Repeat Rate; "Needs Attention" chips (pending>24h, unshipped>48h, low stock, open returns...); Payment split Online/COD.

## Six flows / chapters (each fills the stage, no scroll)
- shop (Customer buys): browse (catalogue w/ SVG art, stock_status) -> product (variants, mrp/discount, GST-incl price) -> cart -> checkout (address+pincode, razorpay/cod, place) -> confirmed(order_number, EDD).
- fulfil (Store owner fulfils): dashboard (real KPIs + Needs Attention) -> order (detail, mark confirmed/processing) -> shipment (create AWB -> ShipmentMap animated route + courier timeline created->picked_up->in_transit->out_for_delivery->delivered) -> docs (packing slip + shipping label).
- stock (Inventory & catalogue): inventory (stock levels, Low Stock pills, stock value) -> supplier+PO (create PO draft->sent) -> receive (GRN partial, serial/batch capture).
- finance (Payments/GST/Finance): settlement (tenant_transactions captured->settled, tenant_share/commission) -> invoice (GST invoice JS/2025-26/001, cgst/sgst) -> reports (GSTR-1 B2B/B2C split or financial receivables aging).
- b2b (Returns/Quotations/B2B): return (request refund/replacement, approve->received->completed) -> quotation (draft w/ items, finalize) -> rfq (B2B negotiate pending->negotiating->converted).
- grow (Marketing & CRM): campaign (Active/Paused, Sent/Opened/Clicked) -> coupon (percentage/fixed, redemptions) -> crm (customers, health tiers, segments, lifetime value).

## Engine (extend src/app/ecom/demo/store.ts + data.ts)
- Add FlowId: 'shop'|'fulfil'|'grow'|'stock'|'finance'|'b2b'. Extend FLOWS + FLOW_CHAPTERS + CHAPTERS with real-status chapters per the survey.
- Add world slices per flow (inventory rows, invoice/settlement, returns/quote) + actions. Keep store.ts < 500 (move data + maybe split chapter defs into data.ts / a chapters.ts if needed).
- Auto-play stays flow-scoped; goToChapter replays deterministically.

## UI
- ProductArt.tsx: inline SVG illustrations keyed by category (headphones/shirt/cookware/lamp/speaker/etc.), blue-tinted.
- ShipmentMap.tsx: responsive SVG route with animated courier dot + timeline; reduced-motion falls back to filled states.
- Surfaces render per chapter.focus, each fills height (no scroll). Add stock/finance/b2b views.
- DemoStage: full-bleed responsive wrapper (w-screen breakout, h ~88vh via svh units, clamp), flow switcher scrolls/wraps for 6 tabs, chapter rail per flow.
- page.tsx: remove pricing section + listPlans import; demo is the full-bleed hero; keep other sections below.

## Verify
- tsc clean; grep no overflow-y-auto/network/emoji in demo; every file <500; render on dev server (all 6 flow labels, no error); graphify update.
