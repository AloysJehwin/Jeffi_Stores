import type { ProductGroup, VariantGroup } from '@/lib/import/validate-row'
import { PRODUCT_COLUMNS } from '@/lib/import/columns'

// Optional PRODUCT columns an import row may leave blank. Blank → the key is omitted from the draft
// (coerce.ts), and the shared publish SQL writes NULL for most columns via bare NULLIF — which would
// WIPE the live value on re-import. For an EXISTING product we therefore carry its current value
// back into the draft for every optional column the row left blank, so publish writes it unchanged.
// Required columns (sku/name) and engine-resolved refs (category/brand/supplier → *_id) are excluded.
const EXCLUDED_BACKFILL_KEYS = new Set(['sku', 'name', 'category', 'brand', 'supplier'])
const BACKFILLABLE_PRODUCT_KEYS = PRODUCT_COLUMNS.filter(c => !c.required && !EXCLUDED_BACKFILL_KEYS.has(c.key)).map(
  c => c.key
)

/**
 * Preserve an existing product's values for optional fields a re-import left blank. For each
 * backfillable product column absent from `fields`, copy the live row's non-null value in. New
 * products (no live row) are untouched — they take the DB column defaults. #492.
 */
export function backfillBlankOptionalFields(
  fields: Record<string, unknown>,
  liveRow: Record<string, unknown> | null
): Record<string, unknown> {
  if (!liveRow) return fields
  for (const key of BACKFILLABLE_PRODUCT_KEYS) {
    if (fields[key] !== undefined) continue
    const live = liveRow[key]
    if (live !== null && live !== undefined) fields[key] = live
  }
  // Per-interval prices left blank keep their live value.
  const livePrices = liveRow.subscription_prices
  if (fields.subscription_prices && livePrices && typeof livePrices === 'object') {
    fields.subscription_prices = { ...(livePrices as object), ...(fields.subscription_prices as object) }
  }
  return fields
}

// The shared publish SQL writes many columns as bare NULLIF, so a blank cell on a NEW product is
// NULL and a NOT NULL column fails the publish. Those take the skeleton row's DB defaults instead.
const NEVER_DEFAULTED = new Set(['id', 'sku', 'name', 'slug', 'data_source', 'is_draft', 'created_at', 'updated_at'])

/** Fill a new product's blank NOT NULL fields (`notNullKeys`) from its freshly inserted skeleton row;
 * discount_pct is derived from mrp and base_price when both are given, as the product editor shows it. */
export function fillCreateDefaults(
  fields: Record<string, unknown>,
  skeleton: Record<string, unknown> | null,
  notNullKeys: Iterable<string>
): Record<string, unknown> {
  if (fields.discount_pct === undefined) {
    const mrp = Number(fields.mrp)
    const price = Number(fields.base_price)
    if (Number.isFinite(mrp) && Number.isFinite(price) && mrp > 0 && price >= 0 && price <= mrp) {
      fields.discount_pct = Math.round(((mrp - price) / mrp) * 10000) / 100
    }
  }
  for (const key of notNullKeys) {
    if (NEVER_DEFAULTED.has(key) || fields[key] !== undefined) continue
    const v = skeleton?.[key]
    if (v !== null && v !== undefined) fields[key] = v
  }
  return fields
}

export interface ResolvedIds {
  categoryId: string | null
  brandId: string | null
  supplierId: string | null
}

export interface DraftImage {
  image_url: string
  thumbnail_url: string
  s3_bucket: string
  s3_key: string
  s3_thumbnail_key: string
  file_name: string
  file_size: number
  mime_type: string
  width: number
  height: number
  is_primary: boolean
  display_order: number
}

export interface DraftPayload {
  fields: Record<string, unknown>
  variants: Record<string, unknown>[]
  images: DraftImage[]
  sub_variants: Record<string, unknown>[]
  units: Record<string, unknown>[]
  variant_images: Record<string, unknown>[]
}

// Build the product_drafts row `fields` from a product group. category/brand/supplier
// are already resolved to ids by the engine; the raw name columns are dropped so they
// don't leak into the products UPDATE. has_variants is forced true when the group has
// variant rows, so the publish path activates the variant branch.
export function buildFields(group: ProductGroup, ids: ResolvedIds): Record<string, unknown> {
  const { sku, name, category, brand, supplier, ...rest } = group.values as Record<string, unknown>
  const fields: Record<string, unknown> = { ...rest, sku: group.sku, name: group.name }
  fields.category_id = ids.categoryId ?? ''
  fields.brand_id = ids.brandId ?? ''
  if (ids.supplierId) fields.supplier_id = ids.supplierId
  if (group.variants.length > 0) fields.has_variants = true
  return fields
}

// Variant rows for the draft. sub_variant_type_on must be true wherever the variant
// carries sub-variants, or the publish path deactivates them.
export function buildVariants(group: ProductGroup): Record<string, unknown>[] {
  return group.variants.map((v: VariantGroup) => {
    const values = { ...v.values }
    if (v.subVariants.length > 0) values.sub_variant_type_on = true
    // A variant with its own image_urls uses its own images — otherwise the publisher's
    // "use_own_images off" branch would delete the staged variant_images on publish.
    if (String((values as Record<string, unknown>).image_urls ?? '').trim()) values.use_own_images = true
    return values
  })
}

// Phase-2 sub-variant rows. The publish path only processes sub-variants when a change
// marker is present AND each carries a resolved variant_id (which exists only after the
// variants are published). The engine calls this after re-reading variant ids, passing a
// sku -> id map. _seeded marks the group as touched so hasSubVariantChanges() fires.
export function buildSubVariants(group: ProductGroup, variantIdBySku: Map<string, string>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const v of group.variants) {
    const variantId = v.sku ? variantIdBySku.get(v.sku) : undefined
    if (!variantId) continue
    for (const sv of v.subVariants) {
      out.push({ ...sv.values, variant_id: variantId, _seeded: true, is_active: true })
    }
  }
  return out
}

export function hasSubVariants(group: ProductGroup): boolean {
  return group.variants.some(v => v.subVariants.length > 0)
}
