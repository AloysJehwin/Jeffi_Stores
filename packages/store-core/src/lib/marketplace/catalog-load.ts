import { queryMany } from '@/lib/shared/db'
import type { MarketplaceChannel } from './types'

// Every sellable unit (a product with no active variants, a variant with no active sub-variants, or
// a sub-variant) with its catalogue data, images (variant images first) and the channel's listing.

export type UnitLevel = 'product' | 'variant' | 'sub_variant'
export type ListingStatus = 'unmapped' | 'mapped' | 'submitted' | 'live' | 'rejected' | 'inactive'

export interface UnitListing {
  id: string
  marketplaceSku: string | null
  styleId: string | null
  status: ListingStatus
  issues: string[]
  category: string | null
  listingRef: string | null
  listedPrice: number | null
  listedMrp: number | null
  lastTaskId: string | null
  syncedAt: string | null
}

export interface SellableUnit {
  key: string
  level: UnitLevel
  productId: string
  variantId: string | null
  subVariantId: string | null
  name: string
  variantName: string | null
  subVariantName: string | null
  ourSku: string | null
  size: string | null
  colour: string | null
  brand: string | null
  category: string | null
  description: string | null
  shortDescription: string | null
  material: string | null
  hsn: string | null
  gstRate: number | null
  gtin: string | null
  price: number | null
  mrp: number | null
  quantity: number | null
  stockStatus: string | null
  weightGrams: number | null
  lengthCm: number | null
  breadthCm: number | null
  heightCm: number | null
  attributes: Record<string, string>
  images: string[]
  listing: UnitListing | null
}

export const unitKey = (productId: string, variantId?: string | null, subVariantId?: string | null) => `${productId}:${variantId ?? ''}:${subVariantId ?? ''}`

export function parseUnitKey(key: string): { productId: string; variantId: string | null; subVariantId: string | null } | null {
  const [p, v, s, extra] = String(key).split(':')
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (extra !== undefined || !uuid.test(p ?? '') || (v && !uuid.test(v)) || (s && !uuid.test(s)) || (s && !v)) return null
  return { productId: p, variantId: v || null, subVariantId: s || null }
}

const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

function flatAttrs(...sources: unknown[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const src of sources) {
    if (!src || typeof src !== 'object' || Array.isArray(src)) continue
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
      if (v == null || typeof v === 'object') continue
      const s = String(v).trim()
      if (s) out[k] = s
    }
  }
  return out
}

const attrOf = (attrs: Record<string, string>, re: RegExp) => Object.entries(attrs).find(([k]) => re.test(k))?.[1] ?? null
const SIZE_RE = /^size$|size/i
const COLOUR_RE = /colou?r|shade/i

/** Size and colour from the level labels (variant_type "Colour", sub_variant_type "Size"), then attributes. */
export function sizeAndColour(r: {
  variant_type?: string | null
  sub_variant_type?: string | null
  variant_name?: string | null
  sub_variant_name?: string | null
  product_size?: string | null
  attributes: Record<string, string>
}): { size: string | null; colour: string | null } {
  let size: string | null = null
  let colour: string | null = null
  const levels: [string | null | undefined, string | null | undefined][] = [
    [r.sub_variant_type, r.sub_variant_name],
    [r.variant_type, r.variant_name],
  ]
  for (const [type, name] of levels) {
    if (!type || !name) continue
    if (!size && SIZE_RE.test(type)) size = name
    else if (!colour && COLOUR_RE.test(type)) colour = name
  }
  size ??= attrOf(r.attributes, SIZE_RE) ?? r.product_size ?? null
  colour ??= attrOf(r.attributes, COLOUR_RE)
  return { size, colour }
}

const UNITS_SQL = `
  WITH u AS (
    SELECT 'sub_variant' AS level, p.id AS product_id, v.id AS variant_id, sv.id AS sub_variant_id, sv.sku AS our_sku,
           v.variant_name, sv.sub_variant_name, COALESCE(sv.price, v.price, p.base_price) AS price, COALESCE(sv.mrp, v.mrp, p.mrp) AS mrp,
           sv.inventory_quantity AS qty, sv.stock_status, COALESCE(v.gtin, p.gtin) AS gtin,
           COALESCE(sv.weight_grams, v.weight_grams, p.weight_grams) AS weight_grams, COALESCE(sv.length_cm, v.length_cm, p.length_cm) AS length_cm,
           COALESCE(sv.breadth_cm, v.breadth_cm, p.breadth_cm) AS breadth_cm, COALESCE(sv.height_cm, v.height_cm, p.height_cm) AS height_cm,
           v.attributes AS v_attrs, sv.attributes AS sv_attrs, COALESCE(v.variant_type, p.variant_type) AS variant_type,
           COALESCE(v.sub_variant_type, p.sub_variant_type) AS sub_variant_type
      FROM product_sub_variants sv JOIN product_variants v ON v.id = sv.variant_id JOIN products p ON p.id = sv.product_id
     WHERE sv.is_active AND COALESCE(v.is_active, true) AND COALESCE(p.is_active, true) AND NOT COALESCE(p.is_digital, false)
    UNION ALL
    SELECT 'variant', p.id, v.id, NULL, v.sku, v.variant_name, NULL, COALESCE(v.price, p.base_price), COALESCE(v.mrp, p.mrp),
           v.inventory_quantity, v.stock_status, COALESCE(v.gtin, p.gtin), COALESCE(v.weight_grams, p.weight_grams),
           COALESCE(v.length_cm, p.length_cm), COALESCE(v.breadth_cm, p.breadth_cm), COALESCE(v.height_cm, p.height_cm),
           v.attributes, NULL, COALESCE(v.variant_type, p.variant_type), NULL
      FROM product_variants v JOIN products p ON p.id = v.product_id
     WHERE COALESCE(v.is_active, true) AND COALESCE(p.is_active, true) AND NOT COALESCE(p.is_digital, false)
       AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = v.id AND sv.is_active)
    UNION ALL
    SELECT 'product', p.id, NULL, NULL, p.sku, NULL, NULL, p.base_price, p.mrp, p.inventory_quantity, p.stock_status, p.gtin,
           p.weight_grams, p.length_cm, p.breadth_cm, p.height_cm, NULL, NULL, NULL, NULL
      FROM products p
     WHERE COALESCE(p.is_active, true) AND NOT COALESCE(p.is_digital, false)
       AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND COALESCE(v.is_active, true))
  )
  SELECT u.*, p.name, p.description, p.short_description, p.material, p.hsn_code, p.gst_percentage, p.size AS product_size,
         b.name AS brand, c.name AS category,
         l.id AS listing_id, l.marketplace_sku, l.style_id, l.status AS listing_status, l.issues, l.category AS listing_category,
         l.listing_ref, l.listed_price, l.listed_mrp, l.last_task_id, l.synced_at
    FROM u JOIN products p ON p.id = u.product_id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN marketplace_listings l ON l.channel = $1 AND l.product_id = u.product_id
         AND l.variant_id IS NOT DISTINCT FROM u.variant_id AND l.sub_variant_id IS NOT DISTINCT FROM u.sub_variant_id
   WHERE ($2::uuid[] IS NULL OR u.product_id = ANY($2::uuid[]))
   ORDER BY p.name, u.variant_name NULLS FIRST, u.sub_variant_name NULLS FIRST
   LIMIT $3`

export const MAX_UNITS = 5000

/** Units for a channel, optionally only some products. Images are attached when `images` is set. */
export async function loadSellableUnits(
  channel: MarketplaceChannel,
  opts: { productIds?: string[]; images?: boolean; limit?: number } = {}
): Promise<SellableUnit[]> {
  const rows = await queryMany<any>(UNITS_SQL, [channel, opts.productIds?.length ? opts.productIds : null, Math.min(opts.limit ?? MAX_UNITS, MAX_UNITS)])
  const images = opts.images === false ? null : await loadImages(rows)
  return rows.map(r => {
    const attributes = flatAttrs(r.v_attrs, r.sv_attrs)
    const { size, colour } = sizeAndColour({ ...r, attributes })
    const variantImgs = r.variant_id ? images?.variant.get(r.variant_id) ?? [] : []
    const productImgs = images?.product.get(r.product_id) ?? []
    return {
      key: unitKey(r.product_id, r.variant_id, r.sub_variant_id),
      level: r.level,
      productId: r.product_id,
      variantId: r.variant_id ?? null,
      subVariantId: r.sub_variant_id ?? null,
      name: r.name,
      variantName: r.variant_name ?? null,
      subVariantName: r.sub_variant_name ?? null,
      ourSku: r.our_sku || null,
      size,
      colour,
      brand: r.brand ?? null,
      category: r.category ?? null,
      description: r.description ?? null,
      shortDescription: r.short_description ?? null,
      material: r.material ?? null,
      hsn: r.hsn_code ?? null,
      gstRate: num(r.gst_percentage),
      gtin: r.gtin ?? null,
      price: num(r.price),
      mrp: num(r.mrp),
      quantity: num(r.qty),
      stockStatus: r.stock_status ?? null,
      weightGrams: num(r.weight_grams),
      lengthCm: num(r.length_cm),
      breadthCm: num(r.breadth_cm),
      heightCm: num(r.height_cm),
      attributes,
      images: [...new Set([...variantImgs, ...productImgs])].slice(0, 20),
      listing: r.listing_id
        ? {
            id: r.listing_id,
            marketplaceSku: r.marketplace_sku ?? null,
            styleId: r.style_id ?? null,
            status: r.listing_status,
            issues: Array.isArray(r.issues) ? r.issues.map(String) : [],
            category: r.listing_category ?? null,
            listingRef: r.listing_ref ?? null,
            listedPrice: num(r.listed_price),
            listedMrp: num(r.listed_mrp),
            lastTaskId: r.last_task_id ?? null,
            syncedAt: r.synced_at ? new Date(r.synced_at).toISOString() : null,
          }
        : null,
    }
  })
}

async function loadImages(rows: { product_id: string; variant_id: string | null }[]) {
  const productIds = [...new Set(rows.map(r => r.product_id))]
  const variantIds = [...new Set(rows.map(r => r.variant_id).filter((v): v is string => !!v))]
  const [pi, vi] = await Promise.all([
    productIds.length
      ? queryMany<{ owner: string; image_url: string }>(
          `SELECT product_id AS owner, image_url FROM product_images WHERE product_id = ANY($1::uuid[]) AND image_url IS NOT NULL
            ORDER BY product_id, is_primary DESC NULLS LAST, display_order NULLS LAST, created_at`,
          [productIds]
        )
      : [],
    variantIds.length
      ? queryMany<{ owner: string; image_url: string }>(
          `SELECT variant_id AS owner, image_url FROM variant_images WHERE variant_id = ANY($1::uuid[]) AND image_url IS NOT NULL
            ORDER BY variant_id, is_primary DESC NULLS LAST, display_order NULLS LAST, created_at`,
          [variantIds]
        )
      : [],
  ])
  const group = (list: { owner: string; image_url: string }[]) => {
    const m = new Map<string, string[]>()
    for (const r of list) m.set(r.owner, [...(m.get(r.owner) ?? []), r.image_url])
    return m
  }
  return { product: group(pi), variant: group(vi) }
}

/** One line per unit for display: "Tee · Red · M". */
export const unitLabel = (u: Pick<SellableUnit, 'name' | 'variantName' | 'subVariantName'>) => [u.name, u.variantName, u.subVariantName].filter(Boolean).join(' · ')
