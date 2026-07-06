# Selling Unit & Unit Factor Logic

## Overview

Products can be sold in a "selling unit" that differs from the base unit (e.g. sell a box of 12 pcs, or sell by metre). The `product_units` table drives this. Every price display, cart total, and EDD fetch must account for the selling unit and its factor.

---

## Database: `product_units`

| Column | Type | Description |
|--------|------|-------------|
| `product_id` | uuid | Parent product |
| `variant_id` | uuid \| null | null = product-level unit; non-null = variant-level |
| `sub_variant_id` | uuid \| null | null unless sub-variant specific |
| `unit` | text | Raw unit string (e.g. `pc`, `m`, `box`) |
| `display_label` | text \| null | Human label shown in UI (e.g. `Pc`, `Set`, `Box`) |
| `dimension` | text \| null | `count` \| `length` \| `area` \| `volume` — drives input widget |
| `factor` | numeric | How many base units make one selling unit (e.g. 12 for a box of 12) |
| `is_base` | boolean | True = this is the base/reference unit |
| `min_qty` | numeric | Minimum order quantity in this unit |
| `max_qty` | numeric \| null | Maximum order quantity (null = unlimited) |
| `qty_step` | numeric | Step increment (e.g. 0.25 for quarter-metre steps) |

**Unique constraints (partial indexes):**
- `uniq_product_units_product_unit` — `(product_id, unit) WHERE variant_id IS NULL`
- `uniq_product_units_variant_unit` — `(product_id, unit) WHERE variant_id IS NOT NULL`

> The old non-partial constraint `product_units_product_id_unit_key` was stale and has been dropped — it blocked renaming a product-level unit to a name already used by a variant-level unit.

---

## Key Derived Values

These are computed in `ProductActions.tsx` (both visitor and business) and `ProductCard.tsx`:

```ts
// The active selling unit record
const sellUnit = productUnits.find(u => ...)   // selected by user or default

// Factor: how many base units per selling unit
// 1 for base units, >1 for bundles (box of 12 = factor 12)
const unitFactor = (sellUnit && sellUnit.factor) ? Number(sellUnit.factor) : 1

// Label shown in UI: prefer display_label, fall back to unit string
const effectiveUnitLabel = sellUnit?.display_label ?? sellUnit?.unit ?? null

// Base unit label (for breakdown line)
const baseUnit = productUnits.find(u => u.is_base)
const baseUnitLabel = baseUnit?.display_label ?? baseUnit?.unit ?? null

// Whether to show "1 Box = 12 pc × Rs. X" breakdown
const showPerBasePrice = unitFactor !== 1
```

---

## Price Display Rules

| Scenario | Displayed price | MRP | Savings | Breakdown line |
|----------|----------------|-----|---------|----------------|
| `unitFactor === 1` | `price` | `mrp` | `mrp - price` | hidden |
| `unitFactor > 1` | `price × unitFactor` | `mrp × unitFactor` | `(mrp - price) × unitFactor` | shown |

**Breakdown line format:**
```
(1 Box = 12 pc × Rs. 133.13)
```

**Example:** Selling unit is "Set" with factor 12, base price Rs. 133.13
- Displayed price: Rs. 1,597.56 / Set
- Breakdown: (1 Set = 12 pc × Rs. 133.13)

---

## `isCustomQty` Flag

Controls whether the cart uses a free-form input (length/area/volume) vs. a stepper (count).

```ts
// CORRECT — dimension-only check
const isCustomQty = !!(item.cart_item_unit?.dimension && item.cart_item_unit.dimension !== 'count')

// WRONG — do NOT use buy_mode to derive this
// buy_mode values include 'pc', 'box', 'unit' (unit names), not just literal 'unit'
```

When `isCustomQty === true`:
- Price = `price_at_addition` (stored at time of add, includes custom measurement)
- No `unitFactor` applied (already baked into `price_at_addition`)
- Input widget = free-form number field

When `isCustomQty === false`:
- Price = `(sub_variant?.price ?? variant?.price ?? base_price) × unitFactor`
- Input widget = stepper with +/- buttons

---

## Cart Total & Tax

In `CartContext.tsx`, `getCartTotal()` and `getCartTax()` apply the same `isCustomQty` / `unitFactor` logic:

```ts
const isCustomQty = !!(item.cart_item_unit?.dimension && item.cart_item_unit.dimension !== 'count')
const unitFactor = (!isCustomQty && item.cart_item_unit?.factor) ? Number(item.cart_item_unit.factor) : 1
const price = isCustomQty
  ? item.price_at_addition
  : (item.sub_variant?.price ?? item.variant?.price ?? item.products.base_price) * unitFactor
```

---

## Quantity Constraints

All three values come from the selling unit record:

| Field | Default | Behaviour |
|-------|---------|-----------|
| `qtyMin` | 1 (count) / 0.001 (custom) | Lower clamp on input |
| `qtyMax` | undefined | Upper clamp on input |
| `qtyStep` | 1 (count) / 0.001 (custom) | Step increment; typed values are snapped on blur |

**Step-snap formula (on blur):**
```ts
// count stepper
safe = Math.round(safe / qtyStep) * qtyStep

// length/area ruler (offset-aware)
clamped = Math.round((clamped - qtyMin) / qtyStep) * qtyStep + qtyMin
```

---

## EDD (Estimated Delivery Date) Integration

The `/api/products/edd` route accepts an `extraDays` param for products with `extra_delivery_days > 0`. Both `ProductActions` and `ProductCard` append it:

```ts
fetch(`/api/products/edd?pin=${pin}&extraDays=${extraDeliveryDays}`)
```

TAT = zone TAT + extraDeliveryDays.

---

## Files Involved

| File | Role |
|------|------|
| `database/catalog.sql` | Schema: `product_units` table + partial unique indexes |
| `src/components/visitor/ProductActions.tsx` | Price display + qty input (visitor detail page) |
| `src/components/business/ProductActions.tsx` | Price display + qty input (business detail page) |
| `src/components/visitor/ProductCard.tsx` | Card EDD + price (visitor listings) |
| `src/components/business/ProductCard.tsx` | Card EDD + price (business listings) |
| `src/components/shared/QuantityInput.tsx` | Reusable qty widgets: CountStepper, LengthRuler, SliderInput, AreaInput |
| `src/app/cart/page.tsx` | Cart item price, totals, qty input with clamp+snap |
| `src/contexts/CartContext.tsx` | Cart totals (getCartTotal, getCartTax) |
| `src/app/api/products/edd/route.ts` | EDD calculation with extraDays |
