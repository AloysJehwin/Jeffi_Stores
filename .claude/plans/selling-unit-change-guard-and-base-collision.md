# Selling-unit change: fix base-collision crash + enforce write-block on publish

Branch: `fix/tenant-forms-host`. No commit/push without instruction. No schema changes (indexes already exist).

## Two problems

### A. BUG (the reported crash) — `duplicate key ... uniq_product_units_one_base_product`
Publishing a product whose **base selling unit was changed** (renamed/switched, e.g. "box" -> "piece")
crashes. Root cause in `src/lib/product-draft.ts` `publishProductDraft()`:

- Product-level upsert (L871-893) conflicts on `(product_id, unit)`. When the draft's new base row has a
  **different `unit` name** than the live base row, the upsert INSERTs a new row with `is_base=true` while
  the old base row (still `is_base=true`) is not cleared until the delete at L900-906, which runs AFTER.
  Two `is_base=true` rows at the same scope -> violates the partial unique index
  `uniq_product_units_one_base_product` at insert time.
- Same defect at variant scope (L937-960 -> `uniq_product_units_one_base_variant`) and sub-variant scope
  (L975-1026 -> `uniq_product_units_one_base_sub_variant`).
- Identical hazard for `is_purchase_default` (`uniq_product_units_one_purchase_{product,variant,sub_variant}`).

The per-unit API route already does this correctly: it clears the scope's `is_base` BEFORE the upsert
(`src/app/api/admin/products/[id]/units/route.ts` L122-127). The publish path was never given the same clear.

**Fix:** in each scope block of `publishProductDraft`, BEFORE the insert/upsert, clear the flags on
existing rows of that scope so only the incoming base/purchase-default row carries them:
- Product scope: `UPDATE product_units SET is_base=FALSE, is_purchase_default=FALSE WHERE product_id=$1 AND variant_id IS NULL AND sub_variant_id IS NULL` (only when `productUnits.length > 0`).
- Variant scope: same, keyed `WHERE product_id=$1 AND variant_id=$vid` (per distinct variant_id present in `variantUnits`).
- Sub-variant scope: same, keyed `WHERE product_id=$1 AND sub_variant_id=$svid` (per distinct sub_variant_id present in `subVariantUnits`).
Clearing only the flags (not deleting rows) preserves the ids that `products.sell_unit_id` /
`product_variants.sell_unit_id` (FK ON DELETE SET NULL) and `product_unit_rules` (ON DELETE CASCADE)
depend on — the same reason the existing code upserts instead of delete-then-reinsert. The upsert then
re-sets the correct flags on the surviving/incoming rows; the existing post-insert DELETE (unlisted units)
and the `sell_unit_id` re-link stay as-is.

### B. FEATURE — block a selling-unit CHANGE when stock exists, at all levels
The guard `assertUnitChangeAllowed()` (+ inheritance-aware `resolveGrainUnit`) already exists in
`src/lib/selling-unit.ts` and is enforced in the per-unit API routes (product/variant/sub-variant units
POST/PATCH/DELETE). BUT the **draft publish path does not call it**, so a unit change made through the
product EDIT FORM (which stages to `product_drafts` and applies via `publishProductDraft`) bypasses the
block entirely. The user's request: "have this fix in all levels" -> enforce the same guard on publish.

Rules (already encoded in `assertUnitChangeAllowed`, reused verbatim):
- SERIALIZED product with in-stock serials at a grain: refuse ANY change to `factor` / `dimension` /
  `qty_step`, or removal of the base unit, at that grain. (Each serial's meaning was fixed at receive time
  by the then-current qty_step; it cannot be recalculated.)
- PERISHABLE with remaining batch stock: refuse only a `dimension` change (batches hold base units, which
  survive a factor change).
- Non-tracked (neither flag): no block.
- Inheritance: a grain with no own unit inherits sub-variant <- variant <- product. `resolveGrainUnit`
  resolves most-specific-first; the guard is applied per grain that has staged unit changes.

**Enforcement point:** in `publishProductDraft`, BEFORE opening the write transaction (mirroring the
`OpenOrdersBlockError` gate at L63-66), compare each staged unit against the LIVE `product_units` row at
the same scope; for every scope whose base unit's load-bearing fields changed (or whose base unit is being
removed), call `assertUnitChangeAllowed({query}, scope, changedUnitFields(staged, live))`. If it returns a
reason, throw a new typed `UnitChangeBlockedError(reason)` (extends Error, like `OpenOrdersBlockError`).
- Product scope: live base row where variant_id IS NULL AND sub_variant_id IS NULL.
- Variant scope: live base row for that variant_id.
- Sub-variant scope: live base row for that sub_variant_id.
Use `changedUnitFields()` so re-sending identical values is NOT a change (won't false-block a normal save).
A base-unit **switch** (different `unit` name) reads as a `factor`/`dimension`/`qty_step` change vs the old
base -> correctly blocked when serials exist; a rename with identical numerics is allowed.

**Callers already surface it:**
- `POST /api/admin/products/[id]/publish` returns `err.message` (L65-68) -> 409-ish message shown.
- Edit-page server action catches and `return { error: err.message }` (L839-843) -> ProductForm shows it.
- `src/lib/product-import.ts` catch (L98-104) already falls through to `err.message` for ANY Error, so
  `UnitChangeBlockedError` surfaces as a row error automatically — no change needed there.

## Files touched (only two)
1. `src/lib/product-draft.ts` —
   (a) add `UnitChangeBlockedError extends Error` next to `OpenOrdersBlockError`;
   (b) pre-transaction guard loop: for the product base + each variant base + each sub-variant base that
       has a staged unit, compare vs the live row and call `assertUnitChangeAllowed` — throw
       `UnitChangeBlockedError` on a reason;
   (c) inside the tx, add a clear-flags UPDATE (`is_base=FALSE, is_purchase_default=FALSE`) for the scope
       before each of the three insert/upsert blocks.
   Reuses `assertUnitChangeAllowed` + `changedUnitFields` from `selling-unit.ts` as-is (import them).
2. No other file needs changing: publish route and edit-page action already surface `err.message`;
   `product-import.ts` catch already falls through to `err.message`.

## Verification (local only, when asked)
- Repro the crash: product with a base unit + change the unit name in the edit form -> Publish. Before:
  duplicate-key 500. After: publishes; exactly one `is_base=true` product-level row; `sell_unit_id` re-linked.
- Serialized product with in-stock serials: changing factor/qty_step/dimension (or switching the base unit)
  via the edit form Publish -> blocked with the guard message; via the units API -> already blocked (unchanged).
- Perishable with batch stock: dimension change blocked; factor change allowed.
- Variant- and sub-variant-level base changes: same block/allow behaviour at their grain (inheritance honored).
- Re-saving with NO unit change -> publishes normally (no false block).
- `npx tsc --noEmit` clean; run affected selling-unit tests if present.

## Constraints honored
One branch, no commit/push until asked, no emojis, files < 500 lines (product-draft.ts is large already —
add minimal focused code, no refactor), touch only unit-publish + guard wiring, no schema changes.
