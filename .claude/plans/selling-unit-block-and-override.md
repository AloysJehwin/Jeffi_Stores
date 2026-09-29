# Selling-unit change: block at edit time + stock-wipe override

Branch: `fix/tenant-forms-host`. No commit/push without instruction. No schema changes.

## Goal (refines the prior publish-time guard)
1. Block a base selling-unit CHANGE at the moment it is edited (the draft-units editor), not only at
   publish — so the admin learns immediately instead of after hitting Publish.
2. Offer an explicit OVERRIDE: "set inventory to 0 and delete existing serials/shelf/batches at this grain
   (and its inheriting children), then allow the unit switch."

## Decisions (confirmed with user)
- Override wipes IN-STOCK only: delete `product_serials` where `status='in_stock'`, delete `shelf_stock`
  rows, delete `product_batches`, set inventory_quantity=0 at the grain. Sold/returned/reserved serials are
  KEPT (FK-referenced by orders — deleting them corrupts history).
- Wipe is DEFERRED to publish: confirming the override only records intent on the draft; the actual
  destruction runs inside `publishProductDraft`. Discarding the draft undoes it; nothing is destroyed until
  Publish.
- Grain reach: override wipes the edited grain PLUS every variant/sub-variant that INHERITS that unit
  (no own base unit). Product-level override clears the whole inherited subtree.

## Current state (verified)
- Base unit edited via `UnitsManager.tsx` -> draft endpoints `POST /draft/units`, `PATCH /draft/units/[unitId]`,
  `DELETE /draft/units/[unitId]`. These write `product_drafts.units` JSONB with NO guard today.
- Publish-time guard already added (prior task) in `publishProductDraft` via `assertStagedUnitChangesAllowed`
  + the base-flag collision fix. That guard THROWS `UnitChangeBlockedError` at publish. This task moves the
  first line of defence earlier and adds the override escape hatch.
- Guard logic lives in `src/lib/selling-unit.ts` (`assertUnitChangeAllowed`, `changedUnitFields`,
  `resolveGrainUnit`) — reuse as-is.
- Stock-teardown template already exists in `publishProductDraft` (toggle-off cleanup, L1134-1200):
  captures per-grain counts, deletes `product_serials` in_stock, `product_batches`, `shelf_stock`. The
  override wipe is a simpler variant (zero, not roll-back).
- Grain columns confirmed: `product_serials`, `shelf_stock`, `product_batches` all keyed
  (product_id, variant_id, sub_variant_id).

## Design

### A. Block at edit time (draft-units endpoints)
In `POST /api/admin/products/[id]/draft/units` and `PATCH .../draft/units/[unitId]`:
- When the write sets/edits the BASE unit for a scope, resolve the LIVE base row at that scope and call
  `assertUnitChangeAllowed({query}, scope, changedUnitFields(body, live))`.
- If it returns a reason AND the request did not pass `override: true`, respond `409` with
  `{ error: reason, canOverride: true, scope: {...} }` and DO NOT write the draft.
- Same guard on `DELETE .../draft/units/[unitId]` when removing a base unit (changing.remove = true).
- When `override: true` is passed, skip the block and stamp the draft: add `_unit_override` intent for the
  scope (see C) so publish knows to wipe. Then write the unit change to the draft as normal.

### B. Override UX (`UnitsManager.tsx`)
- `handleSaveBase` / `handleResetBase`: on a `409` with `canOverride`, show a confirm (existing
  `showConfirm` from ToastContext) spelling out exactly what will be wiped and that it happens on Publish:
  "Changing the selling unit will set stock to 0 and delete all serials, shelf locations and batches for
  this <product/variant/sub-variant> (and anything inheriting it) when you publish. This cannot be undone
  after publish. Continue?"
- On confirm, re-send the same request with `override: true`. On success, reload; the editor shows the new
  unit and (optionally) a small "stock will be reset on publish" note.
- No emojis.

### C. Record intent on the draft, wipe on publish
- Draft carries the override as a marker on the base unit entry it writes, e.g. `_reset_stock_on_publish: true`
  on that scope's unit object in `product_drafts.units` (JSONB — no schema change). A cleared base
  (DELETE + override) records the marker on the `_cleared` sentinel entry for the scope.
- In `publishProductDraft`, BEFORE `assertStagedUnitChangesAllowed`:
  - Collect scopes whose staged base unit has `_reset_stock_on_publish`.
  - For each such scope, run a wipe INSIDE the existing tx (add near the top of the tx, before unit upserts):
    - resolve inheriting children (a variant/sub-variant with no own base unit inherits the product/variant),
      matching `resolveGrainUnit`'s precedence, so a product-level override also targets inheritors;
    - `DELETE FROM product_serials WHERE <grain(s)> AND status='in_stock'`;
    - `DELETE FROM product_batches WHERE <grain(s)>`;
    - `DELETE FROM shelf_stock WHERE <grain(s)>`;
    - set `inventory_quantity = 0`, `stock_status='Out of Stock'` on the product / variants / sub-variants
      in scope (reuse the grain UPDATE shapes from the toggle-off block).
  - Then EXEMPT those scopes from `assertStagedUnitChangesAllowed` (their stock is being wiped, so the
    change is allowed). Simplest: run the wipe first, so by the time the guard runs there is no in-stock
    stock left and it passes naturally. Confirm the guard counts in_stock serials / remaining batches only
    (it does) — after the wipe those are 0, so no special-casing needed.
- Keep the base-flag collision fix from the prior task (clear is_base/is_purchase_default per scope before
  upsert) unchanged.

## Files touched
1. `src/app/api/admin/products/[id]/draft/units/route.ts` — POST: guard base change; honor `override`.
2. `src/app/api/admin/products/[id]/draft/units/[unitId]/route.ts` — PATCH + DELETE: same guard + override
   + write the `_reset_stock_on_publish` marker.
3. `src/components/admin/UnitsManager.tsx` — 409/`canOverride` handling + confirm + retry with override.
4. `src/lib/product-draft.ts` — pre-upsert wipe for flagged scopes (reuse teardown SQL), run before the
   existing guard; resolve inheriting children.
5. (maybe) `src/lib/selling-unit.ts` — small exported helper to list inheriting child grains, if not cleanly
   expressible inline. Prefer inline SQL in product-draft to keep the change contained.

## Verification (local only, when asked)
- Serialized product w/ in-stock serials: edit base unit in the form -> blocked immediately with override
  offered (no Publish needed to see it).
- Confirm override -> draft saved; Publish -> serials(in_stock)/shelf/batches deleted, inventory 0, new unit
  applied; sold serials untouched; orders intact.
- Product-level override -> inheriting variants/sub-variants also wiped; a variant with its OWN unit is not.
- Perishable w/ batch stock: dimension change blocked + override wipes batches; factor change still allowed
  without override.
- No unit change, or identical re-save -> no block, no wipe.
- Discard draft after confirming override -> nothing wiped (deferred).
- `npx tsc --noEmit` clean; run tests/lib/product-draft.test.ts, selling-unit.test.ts, units.test.ts and the
  draft-units API tests.

## Constraints
One branch, no commit/push until asked, no emojis, files < 500 lines (UnitsManager is 529 already — add
minimal handlers, no refactor; product-draft is large — add focused code only), touch only unit
block/override wiring, no schema changes.
