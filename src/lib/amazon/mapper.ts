import { buildProductHighlights } from '@/lib/google-merchant-helpers'
import { MARKETPLACE_ID } from './client'

// Amazon SP-API mapper — analog of src/lib/merchant/mapper.ts (Google).
//
// The big divergence from Google's flat feed: Amazon requires, per SKU, a `productType`
// plus an `attributes` object that must validate against that productType's schema. v1
// resolves productType with a deterministic fallback chain (no live schema fetch in the hot
// path) and emits a minimal, high-value common attribute set. Refine using the `issues`
// array returned by putListingsItem.

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistoress.com'
const CURRENCY = 'INR'

export interface AmazonListing {
  sku: string
  productType: string
  requirements: 'LISTING'
  attributes: Record<string, unknown>
}

// Deterministic category -> Amazon productType map. Falls back to the universal PRODUCT
// type, which accepts a minimal common attribute set. Extend as needed per PUT issues.
const CATEGORY_PRODUCT_TYPE: Record<string, string> = {
  fasteners: 'HARDWARE_HANDLE',
  bolts: 'HARDWARE_HANDLE',
  screws: 'HARDWARE_HANDLE',
  nuts: 'HARDWARE_HANDLE',
  washers: 'HARDWARE_HANDLE',
  tools: 'TOOLS',
  'hand tools': 'TOOLS',
  'power tools': 'POWER_TOOL',
  hardware: 'HARDWARE_HANDLE',
}

function resolveProductType(product: any): string {
  const names = [product.categories?.name, product.categories?.parent_name]
    .filter(Boolean)
    .map((n: string) => n.toLowerCase())
  for (const n of names) {
    if (CATEGORY_PRODUCT_TYPE[n]) return CATEGORY_PRODUCT_TYPE[n]
  }
  return 'PRODUCT'
}

// SP-API attribute value envelope: every attribute is an array of { value, marketplace_id }.
function attr(value: unknown) {
  return [{ value, marketplace_id: MARKETPLACE_ID }]
}

function moneyAttr(amount: number) {
  return [{ value: Number(amount.toFixed(2)), currency: CURRENCY, marketplace_id: MARKETPLACE_ID }]
}

function buildImageAttributes(product: any): Record<string, unknown> {
  const images = (product.product_images || []).filter((img: any) => img.image_url)
  const primary = images.find((img: any) => img.is_primary) || images[0]
  const others = images.filter((img: any) => img.id !== primary?.id).slice(0, 8)
  const out: Record<string, unknown> = {}
  if (primary) out.main_product_image_locator = [{ media_location: primary.image_url, marketplace_id: MARKETPLACE_ID }]
  others.forEach((img: any, i: number) => {
    out[`other_product_image_locator_${i + 1}`] = [{ media_location: img.image_url, marketplace_id: MARKETPLACE_ID }]
  })
  return out
}

// purchasable_offer carries list price + optional sale (discounted) price schedule.
function buildPurchasableOffer(listPrice: number, salePrice: number | null) {
  const schedule: any[] = [{ value_with_tax: Number(listPrice.toFixed(2)) }]
  const offer: any = {
    marketplace_id: MARKETPLACE_ID,
    currency: CURRENCY,
    our_price: [{ schedule }],
  }
  if (salePrice != null && salePrice < listPrice) {
    offer.discounted_price = [{ schedule: [{ value_with_tax: Number(salePrice.toFixed(2)) }] }]
  }
  return [offer]
}

function buildFulfillmentAvailability(inStock: boolean) {
  return [{ fulfillment_channel_code: 'DEFAULT', quantity: inStock ? 10 : 0 }]
}

function buildCommonAttributes(product: any, brandName: string): Record<string, unknown> {
  const description = (product.description || product.name || '').slice(0, 2000)
  const bullets = buildProductHighlights(product).slice(0, 5)
  const common: Record<string, unknown> = {
    condition_type: attr('new_new'),
    product_description: attr(description),
    supplier_declared_dg_hz_regulation: attr('not_applicable'),
    ...buildImageAttributes(product),
  }
  if (brandName) common.brand = attr(brandName)
  if (brandName) common.manufacturer = attr(brandName)
  if (bullets.length) common.bullet_point = bullets.map(b => ({ value: b, marketplace_id: MARKETPLACE_ID }))
  if (product.material) common.material = attr(product.material)
  return common
}

export function productToAmazonListings(product: any): AmazonListing[] {
  const productType = resolveProductType(product)
  const brandName = product.brands?.name || ''
  const common = buildCommonAttributes(product, brandName)
  const hasVariants = product.has_variants && product.product_variants?.length > 0
  const productActive = product.is_active !== false
  const parentSku = product.sku

  if (hasVariants) {
    return product.product_variants
      .filter((v: any) => v.price != null)
      .map((v: any) => {
        const price = Number(v.price)
        const mrp = v.mrp ? Number(v.mrp) : (product.mrp ? Number(product.mrp) : null)
        const listPrice = mrp || price
        const salePrice = mrp && mrp > price ? price : null
        const inStock = productActive && v.stock_status !== 'Out of Stock'

        const attributes: Record<string, unknown> = {
          ...common,
          item_name: attr(`${product.name} - ${v.variant_name}`),
          list_price: moneyAttr(listPrice),
          purchasable_offer: buildPurchasableOffer(listPrice, salePrice),
          fulfillment_availability: buildFulfillmentAvailability(inStock),
          // Variation relationship: child SKUs share the parent product's SKU.
          child_parent_sku_relationship: [{
            child_relationship_type: 'variation',
            parent_sku: parentSku,
            marketplace_id: MARKETPLACE_ID,
          }],
          variation_theme: [{ name: 'SIZE_NAME', marketplace_id: MARKETPLACE_ID }],
        }
        const gtin = v.gtin || product.gtin
        const mpn = v.mpn || product.mpn
        if (gtin) attributes.externally_assigned_product_identifier = [{ type: 'ean', value: gtin, marketplace_id: MARKETPLACE_ID }]
        if (mpn) attributes.part_number = attr(mpn)
        if (v.variant_name) attributes.size = attr(v.variant_name)

        return { sku: v.sku, productType, requirements: 'LISTING' as const, attributes }
      })
  }

  const price = Number(product.base_price)
  const mrp = product.mrp ? Number(product.mrp) : null
  const listPrice = mrp || price
  const salePrice = mrp && mrp > price ? price : null
  const inStock = productActive && product.stock_status !== 'Out of Stock'

  const attributes: Record<string, unknown> = {
    ...common,
    item_name: attr(product.name),
    list_price: moneyAttr(listPrice),
    purchasable_offer: buildPurchasableOffer(listPrice, salePrice),
    fulfillment_availability: buildFulfillmentAvailability(inStock),
  }
  if (product.gtin) attributes.externally_assigned_product_identifier = [{ type: 'ean', value: product.gtin, marketplace_id: MARKETPLACE_ID }]
  if (product.mpn) attributes.part_number = attr(product.mpn)
  if (product.size) attributes.size = attr(product.size)

  return [{ sku: product.sku, productType, requirements: 'LISTING', attributes }]
}

// The product's canonical link (used by the status table / debugging).
export function productLink(product: any, sku?: string): string {
  const base = `${BASE_URL}/products/${product.slug}`
  return sku ? `${base}?sku=${encodeURIComponent(sku)}` : base
}
