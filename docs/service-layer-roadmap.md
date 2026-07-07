# Service Layer Roadmap — Product Fields Integration

## Background
The products table was expanded with ~50 new fields for a generic multi-category catalog.
This document tracks which fields need service-layer integration (not just storage) and the implementation plan.

---

## Features — Priority Order

### 1. Handling Days → EDD  *(quick win)*
**Fields:** `handling_days`  
**What:** EDD formula currently uses only `extra_delivery_days + TAT(pincode)`. Feed `handling_days` in as dispatch delay — `max(handling_days across items) + TAT`.  
**Touch:** `src/app/api/orders/create/route.ts` (EDD calc ~L143)

---

### 2. COD Eligibility Check  *(quick win)*
**Fields:** `is_cod_allowed`  
**What:** If any cart item has `is_cod_allowed = false`, block COD payment mode at checkout with a clear message.  
**Touch:** `src/app/api/orders/create/route.ts` (payment mode validation)

---

### 3. Launch Date & Discontinue Date Enforcement  *(catalog integrity)*
**Fields:** `launch_date`, `discontinue_date`  
**What:**
- `launch_date` — block cart add + hide from storefront if today < launch_date
- `discontinue_date` — auto-deactivate product via cron if today ≥ discontinue_date; block cart add
**Touch:**
- `src/app/api/cart/route.ts` (add-to-cart validation)
- `src/app/api/cron/` (new sweep job — `sweep_auto_tasks` or new `lifecycle_products`)
- Product fetch queries (filter out pre-launch from storefront)

---

### 4. Batch Capture on GRN Receive  *(foundation for expiry chain)*
**Fields:** `lot_number`, `manufacture_date`, `expiry_date` on `product_batches`  
**What:** When receiving a PO (GRN flow), optionally capture lot number, manufacture date, expiry date per line item. Insert into `product_batches` table. Required before features 6 & 7.  
**Touch:**
- GRN receive UI (`src/app/admin/inventory/InventoryClient.tsx` receive modal)
- `src/app/api/admin/inventory/po/[id]/receive/route.ts` (insert to product_batches)

---

### 5. Expiry Warnings on Inventory Dashboard  *(ops value)*
**Fields:** `shelf_life_days`, `perishable`, `expiry_date` (from product_batches)  
**What:** New "Expiring Soon" tab/section in inventory dashboard. Show batches expiring within `shelf_life_days` days. Color-code: red (<7d), amber (<30d).  
**Touch:**
- `src/app/admin/inventory/InventoryClient.tsx` (new tab)
- New API route: `GET /api/admin/inventory/expiring`

---

### 6. FIFO Stock Deduction on Order  *(needs feature 4)*
**Fields:** `perishable`, `product_batches.expiry_date`  
**What:** For perishable products, deduct from oldest batch first (earliest expiry_date). Log `batch_id` on `inventory_transactions`.  
**Touch:**
- `src/lib/inventory.ts` `logStockMovement()` — add optional `batch_id` param
- `src/lib/order-commit.ts` — FIFO batch selection for perishable items
- `database/inventory.sql` — add `batch_id uuid` column to `inventory_transactions`

---

### 7. Shelf Life Check at Checkout  *(needs feature 4)*
**Fields:** `shelf_life_days`, `perishable`, `product_batches.expiry_date`  
**What:** At checkout, for perishable items check: `oldest_batch.expiry_date - EDD ≥ min_acceptable_days`. Block or warn if stock will expire before delivery.  
**Touch:**
- `src/app/api/orders/create/route.ts` (pre-commit validation)

---

### 8. Oversized / Freight Shipping Flag  *(shipping UX)*
**Fields:** `is_oversized`, `shipping_class`  
**What:** If any cart item is `is_oversized = true` or `shipping_class = 'freight'`, disable standard Delhivery at checkout and show "manual shipping quote required" message.  
**Touch:**
- `src/app/api/orders/create/route.ts` (shipping validation)
- Checkout UI (warning banner)

---

### 9. Condition Badge on Product Listings  *(display only)*
**Fields:** `condition`  
**What:** Show "Refurbished", "Used", "Open Box" badge on PDP and product cards. New = no badge (default).  
**Touch:**
- `src/components/visitor/ProductDetailClient.tsx`
- `src/components/business/ProductCard.tsx`

---

### 10. Sort Order on Storefront & Admin Listings  *(display/UX)*
**Fields:** `sort_order`  
**What:** Use `sort_order` (integer, lower = first) as the default ordering in category/storefront product queries and admin product list. Currently products are ordered by `created_at` or name. This allows manual curation of display order within a category.  
**Touch:**
- `src/app/products/` category/listing queries — add `ORDER BY sort_order ASC, created_at DESC`
- `src/app/business/products/` — same
- `src/app/admin/products/page.tsx` — expose sort_order as a sortable column
- `src/app/api/admin/products/` listing route — include sort_order in default ORDER BY

---

## Excluded / Out of Scope
- `is_digital`, `download_url` — digital goods delivery not yet planned
- `is_subscription`, `subscription_price` — subscription billing not yet planned  
- `is_bundle`, `bundle_items` — bundle management separate feature
- `inclusive_tax` — tax configuration separate feature
- Cart stock reservation — separate large feature, not tied to new fields

---

## Implementation Order
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10

Features 1–3 and 10 are independent. Feature 4 must land before 6 & 7.
