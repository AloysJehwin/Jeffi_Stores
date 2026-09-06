import type { ProductGroup, VariantGroup } from './validate-row'

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
    return values
  })
}

// Phase-2 sub-variant rows. The publish path only processes sub-variants when a change
// marker is present AND each carries a resolved variant_id (which exists only after the
// variants are published). The engine calls this after re-reading variant ids, passing a
// sku -> id map. _seeded marks the group as touched so hasSubVariantChanges() fires.
export function buildSubVariants(
  group: ProductGroup,
  variantIdBySku: Map<string, string>,
): Record<string, unknown>[] {
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
