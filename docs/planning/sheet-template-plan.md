# Multi-sheet product template + scoped Google Sheets sync — plan

## Goal

Replace the single flat `Products` sheet (where `row_type` = product|variant|sub_variant
distinguishes rows) with a **multi-sheet workbook**: a description sheet, then one sheet per
level (Product / Variant / Sub-variant) and per attribute group, with **cross-sheet
auto-population** (a product added on Products appears in the Variant sheet's dropdown, etc.).
Plus: a `data_source` product field so sync only touches sheet-sourced products, and
**delete-on-sync** (a row removed from the sheet is removed from the DB/store).

## Today (what exists)

- `src/lib/import/columns.ts` — one flat `ALL_COLUMNS` list; each `ImportColumn` has
  `header, coerce, rowTypes[], required?, enumKey?, help?`. 88 product-level, 24 variant,
  11 sub-variant columns.
- `src/lib/import/template.ts` — `buildTemplateWorkbook()` builds ONE `Products` worksheet,
  colour-coded header band, help row, dropdowns from `enums.ts`.
- `src/lib/import/google-sync.ts` — reads the sheet, coerces rows, upserts. No delete. No
  data_source scoping.
- `products` table has NO `data_source` column yet.

## Target workbook (sheets, in order)

1. **README / Field Guide** (read-only): every field, its level, required?, accepted values
   (enum lists), coercion type, and an example. Generated from the column catalog so it can
   never drift from the real fields.
2. **Products** — product-level columns only (sku required; name, pricing, GST, flags…).
   `sku` is the key.
3. **Variants** — `parent_sku` (dropdown fed from Products.sku) + variant columns
   (variant_sku, variant_name, price, weight…). A variant only makes sense under a product.
4. **Sub-variants** — `parent_sku` + `variant_sku` (dropdowns fed from Products / Variants)
   + sub-variant columns.
5. **Attributes / physical** (segregated by level) — the many optional fields (perishable,
   serialized toggles, weight_grams, dimensions, handling charge, extra delivery days, HSN…)
   split so each sheet stays narrow. Keyed by sku (product-level attrs) or variant_sku
   (variant-level attrs). Exact grouping decided from the catalog's `level`.

### Cross-sheet auto-population
Use spreadsheet data-validation dropdowns referencing another sheet's key column
(e.g. Variants!parent_sku validates against Products!A:A). exceljs supports list validation
with a cross-sheet formula range. This gives the "product appears in the variant sheet"
behaviour without macros. (A fully dynamic "only show variants of the chosen product" needs
Apps Script — out of scope; the flat dropdown of all skus is the pragmatic version.)

## Column model change

Add `level: 'product' | 'variant' | 'sub_variant' | 'attr_product' | 'attr_variant'` and
`sheet: string` to `ImportColumn` (derive from existing `rowTypes` initially). `template.ts`
groups columns by `sheet` and emits one worksheet each; the README sheet iterates the whole
catalog. Keep `row_type` support in the parser for backward compatibility during rollout, but
the new sheets carry their level implicitly (no `row_type` column needed).

## Sync changes

1. **Read every sheet**, not just `Products`. Map each sheet's rows to its level; stitch
   variants/sub-variants to parents by `parent_sku` / `variant_sku`.
2. **`data_source` scoping** — add `data_source varchar` to `products` (values e.g.
   `google_sheet`, `manual`, `import`). On "Sync data", only INSERT/UPDATE products whose
   sku is in the sheet, and only ever DELETE/deactivate products with
   `data_source = 'google_sheet'`. Manually-created products are never touched by a sync.
3. **Delete-on-sync** — a product with `data_source='google_sheet'` that is NO LONGER in the
   sheet is removed (soft-delete: `is_active=false` + hidden from store, per the existing
   draft-publisher soft-delete convention) or hard-deleted — DECIDE (see open questions).
   Same for variants/sub-variants dropped from their sheets.
4. Wrap the whole sync in a summary: created / updated / deleted / skipped(not sheet-sourced),
   surfaced in the data-source UI.

## Schema (LOCAL DB only; never live RDS)
- `products.data_source varchar(24) DEFAULT 'manual'` (topic file + constraints if enumerated).
- Backfill existing sheet-synced products to `google_sheet` where identifiable, else leave
  `manual` (they won't be delete-swept — safe default).

## Files
| File | Change |
|---|---|
| `src/lib/import/columns.ts` | add `level` + `sheet` to each column |
| `src/lib/import/template.ts` | multi-sheet builder + README sheet + cross-sheet dropdowns |
| `src/lib/import/google-sync.ts` | read all sheets, stitch by keys, data_source scope, delete-on-sync |
| `database/catalog.sql` (+ constraints) | `products.data_source` |
| data-source UI | show sync summary (created/updated/deleted/skipped) |

## Guardrails
- Delete-on-sync only ever touches `data_source='google_sheet'` rows — never manual products.
- Soft-delete preferred (recoverable) unless you want hard delete.
- Local DB only for schema; no emojis; no build/test runs unless asked.

## SKU generation (decided)
- SKUs are auto-generated ON SYNC when the cell is blank, using the exact form logic
  (`generateProductSku(categoryId)` for products, `generateVariantSku(productSku, name)` for
  children) — NOT a spreadsheet formula (the product generator needs a DB sequence + regex
  tokenizer). The generated SKU is written back so children can link.
- Constraint: a product with variant/sub-variant rows MUST have its `sku` filled (children link by
  `parent_sku`); only a childless product may leave `sku` blank. The sync errors clearly if a child
  references a blank/missing parent SKU rather than mis-linking.

## Colors (done)
- Distinct saturated header bands per sheet + matching coloured sheet tabs; Field Guide rows
  colour-coded by sheet; required columns orange, key/link columns grey.

## Open questions (decide before build)
1. **Delete = soft (is_active=false, hidden) or hard (row removed)?** Soft is safer/recoverable.
2. **`data_source` default for existing products** — `manual` (never swept) vs backfilling
   known sheet products to `google_sheet`. Manual is the safe default.
3. **Cross-sheet dropdowns**: flat list of all skus (exceljs, ships now) vs per-product
   filtering (needs Apps Script, bigger). Recommend flat list first.
4. **Attribute sheet grouping** — confirm which fields go on which attribute sheet, or let me
   propose a grouping from the catalog's levels.
