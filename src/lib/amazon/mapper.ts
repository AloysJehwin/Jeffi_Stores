import { buildProductHighlights } from '@/lib/google-merchant-helpers'
import { MARKETPLACE_ID } from './client'

// Amazon SP-API mapper — analog of src/lib/merchant/mapper.ts (Google).
//
// The big divergence from Google's flat feed: Amazon requires, per SKU, a `productType`
// plus an `attributes` object that must validate against that productType's schema. The
// attribute shapes here were resolved against a live VALIDATION_PREVIEW round for
// HARDWARE_HANDLE on amazon.in; see the required-attribute set below. Refine using the
// `issues` array returned by validateProductForAmazon / putListingsItem.

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistoress.com'
const CURRENCY = 'INR'

// Jeffi Stores business contact — used for the India Legal Metrology (LMPC) contact-info
// attributes Amazon.in requires (manufacturer/importer/packer), as a single free-text string.

export interface AmazonListing {
  sku: string
  productType: string
  requirements: 'LISTING' | 'LISTING_OFFER_ONLY'
  attributes: Record<string, unknown>
}

// Deterministic category -> Amazon productType map (full-create path). Confirmed-live types
// where noted; others resolved by reasoning (verify via getDefinitionsProductType). Falls back
// to HARDWARE_HANDLE (proven listable) — NEVER PRODUCT, which cannot be created.
const CATEGORY_PRODUCT_TYPE: Record<string, string> = {
  // Confirmed live (productType keyword search):
  bolts: 'BOLTS', bolt: 'BOLTS',
  screws: 'SCREWS', screw: 'SCREWS',
  'machine screws': 'SCREWS', 'self tapping screws': 'SCREWS',
  washers: 'WASHER', washer: 'WASHER',
  screwdrivers: 'SCREWDRIVER', screwdriver: 'SCREWDRIVER',
  'drilling machines': 'DRILL', 'drilling machine': 'DRILL', drill: 'DRILL',
  spanners: 'WRENCH', spanner: 'WRENCH', wrenches: 'WRENCH', wrench: 'WRENCH',
  // Resolved by reasoning (verify):
  nuts: 'NUTS', nut: 'NUTS',
  'spirit levels': 'LEVEL', 'spirit level': 'LEVEL', levels: 'LEVEL',
  'cable lugs': 'WIRE_TERMINAL_AND_CONNECTOR', 'cable lug': 'WIRE_TERMINAL_AND_CONNECTOR',
  lugs: 'WIRE_TERMINAL_AND_CONNECTOR', lug: 'WIRE_TERMINAL_AND_CONNECTOR',
  terminals: 'WIRE_TERMINAL_AND_CONNECTOR', terminal: 'WIRE_TERMINAL_AND_CONNECTOR',
  'nut spinners': 'SCREWDRIVER', 'nut spinner': 'SCREWDRIVER', 'nut drivers': 'SCREWDRIVER',
  // Tools / auto:
  tools: 'HARDWARE_HANDLE', 'hand tools': 'HARDWARE_HANDLE', 'power tools': 'POWER_TOOL',
  belts: 'POWER_TRANSMISSION_BELT', 'v belts': 'POWER_TRANSMISSION_BELT', 'fan belts': 'POWER_TRANSMISSION_BELT',
  // Generic:
  hardware: 'HARDWARE_HANDLE', fasteners: 'HARDWARE_HANDLE',
}

// Non-PRODUCT fallback (PRODUCT is not listable for full-create).
const FALLBACK_PRODUCT_TYPE = 'HARDWARE_HANDLE'

function resolveProductType(product: any): string {
  const names = [product.categories?.name, product.categories?.parent_name]
    .filter(Boolean)
    .map((n: string) => n.toLowerCase().trim())
  for (const n of names) {
    if (CATEGORY_PRODUCT_TYPE[n]) return CATEGORY_PRODUCT_TYPE[n]
  }
  return FALLBACK_PRODUCT_TYPE
}

// SP-API scalar attribute envelope: array of { value, marketplace_id }.
function attr(value: unknown) {
  return [{ value, marketplace_id: MARKETPLACE_ID }]
}

// --- Measurement & count (Amazon requires units; parent rows are often empty, so we use
// plausible small-fastener defaults that validate and can be enriched later). ---

function buildItemWeight(product: any) {
  const kg = Number(product.weight) > 0 ? Number(product.weight) : 0.05
  return [{ value: Number(kg.toFixed(3)), unit: 'kilograms', marketplace_id: MARKETPLACE_ID }]
}

// Parse the first two positive numbers from the free-text dimensions/size as length x width (mm).
function parseDimsMm(dims?: string): { length: number; width: number } {
  const nums = String(dims || '').match(/[\d.]+/g)?.map(Number).filter(n => n > 0) || []
  return { length: nums[0] ?? 25, width: nums[1] ?? 10 }
}

function buildItemLengthWidth(product: any) {
  const { length, width } = parseDimsMm(product.dimensions || product.size)
  return [{
    length: { value: length, unit: 'millimeters' },
    width: { value: width, unit: 'millimeters' },
    marketplace_id: MARKETPLACE_ID,
  }]
}

function buildUnitCount() {
  return [{ value: 1, type: { value: 'count', language_tag: 'en_IN' }, marketplace_id: MARKETPLACE_ID }]
}

function buildItemTypeName(product: any) {
  const name = product.categories?.name || 'Fastener'
  return [{ value: String(name), language_tag: 'en_IN', marketplace_id: MARKETPLACE_ID }]
}

// --- Identity cluster: EITHER a real barcode OR the GTIN-exemption flag. Never both, never
// merchant_suggested_asin (we create new listings). ---
function buildProductIdentity(product: any, variant?: any): Record<string, unknown> {
  const gtin = variant?.gtin || product.gtin
  if (gtin) {
    const raw = String(gtin).replace(/\D/g, '')
    const type = raw.length === 12 ? 'upc' : 'ean'
    return { externally_assigned_product_identifier: [{ type, value: raw, marketplace_id: MARKETPLACE_ID }] }
  }
  return { supplier_declared_has_product_identifier_exemption: [{ value: true, marketplace_id: MARKETPLACE_ID }] }
}

function buildModelNumber(product: any, variant?: any): Record<string, unknown> {
  const model = variant?.mpn || product.mpn || variant?.sku || product.sku
  return model ? { model_number: attr(String(model)) } : {}
}

// India LMPC contact-info blocks. The schema expects `value` as a single free-text string
// (full name + address + pincode), plus a language_tag. Manufacturer/importer/packer all
// reuse the store contact for a domestic reseller.
const STORE_CONTACT_TEXT =
  "Jeffi Stores, Sanjay Gandhi Chowk, Opposite Arihant Complex, Station Road, Raipur, " +
  "Chhattisgarh 492001, India. Phone: +919685354099. Email: admin@jeffistores.in"

function contactInfoAttr() {
  return [{ value: STORE_CONTACT_TEXT, language_tag: 'en_IN', marketplace_id: MARKETPLACE_ID }]
}

// external_product_information carries the HSN code on the India marketplace.
function externalProductInfoAttr(product: any) {
  const hsn = String(product.hsn_code || '').replace(/\D/g, '')
  if (hsn.length < 4) return undefined
  return [{ entity: 'HSN', value: hsn.slice(0, 8), marketplace_id: MARKETPLACE_ID }]
}

function buildColorAndComponents(product: any): Record<string, unknown> {
  const out: Record<string, unknown> = { included_components: attr('Handle') }
  if (product.color) out.color = attr(product.color)
  return out
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

// purchasable_offer: our_price[].schedule[].value_with_tax (number). currency + marketplace_id
// are selectors on the offer object. A discounted_price schedule must be dated.
function buildPurchasableOffer(listPrice: number, salePrice: number | null) {
  const offer: any = {
    marketplace_id: MARKETPLACE_ID,
    currency: CURRENCY,
    our_price: [{ schedule: [{ value_with_tax: Number(listPrice.toFixed(2)) }] }],
  }
  if (salePrice != null && salePrice < listPrice) {
    const now = new Date()
    const end = new Date(now.getTime() + 365 * 24 * 3600 * 1000)
    offer.discounted_price = [{
      schedule: [{
        value_with_tax: Number(salePrice.toFixed(2)),
        start_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        end_at: end.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      }],
    }]
  }
  return [offer]
}

function buildFulfillmentAvailability(inStock: boolean) {
  return [{ fulfillment_channel_code: 'DEFAULT', quantity: inStock ? 10 : 0 }]
}

// Variation blocks (Amazon needs an explicit parent listing + parentage_level on children).
function parentVariationAttrs(): Record<string, unknown> {
  return {
    parentage_level: [{ value: 'parent', marketplace_id: MARKETPLACE_ID }],
    variation_theme: [{ name: 'SIZE_NAME', marketplace_id: MARKETPLACE_ID }],
  }
}

function childVariationAttrs(parentSku: string): Record<string, unknown> {
  return {
    parentage_level: [{ value: 'child', marketplace_id: MARKETPLACE_ID }],
    child_parent_sku_relationship: [{
      parent_sku: parentSku,
      child_relationship_type: 'variation',
      marketplace_id: MARKETPLACE_ID,
    }],
    variation_theme: [{ name: 'SIZE_NAME', marketplace_id: MARKETPLACE_ID }],
  }
}

// Attributes shared by every SKU (parent + children + simple).
function buildCommonAttributes(product: any, brandName: string): Record<string, unknown> {
  const description = (product.description || product.name || '').slice(0, 2000)
  const bullets = buildProductHighlights(product).slice(0, 5)
  const common: Record<string, unknown> = {
    condition_type: attr('new_new'),
    product_description: attr(description),
    supplier_declared_dg_hz_regulation: attr('not_applicable'),
    batteries_required: attr(false),
    country_of_origin: attr(product.country_of_origin || 'IN'),
    item_type_name: buildItemTypeName(product),
    item_weight: buildItemWeight(product),
    item_length_width: buildItemLengthWidth(product),
    unit_count: buildUnitCount(),
    rtip_manufacturer_contact_information: contactInfoAttr(),
    importer_contact_information: contactInfoAttr(),
    packer_contact_information: contactInfoAttr(),
    ...buildColorAndComponents(product),
    ...buildImageAttributes(product),
  }
  const epi = externalProductInfoAttr(product)
  if (epi) common.external_product_information = epi
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
    const listings: AmazonListing[] = []

    // Parent listing: identity + common attrs + parentage; NO offer / list_price / availability.
    listings.push({
      sku: parentSku,
      productType,
      requirements: 'LISTING',
      attributes: {
        ...common,
        ...buildProductIdentity(product),
        ...buildModelNumber(product),
        item_name: attr(product.name),
        ...parentVariationAttrs(),
      },
    })

    // Child listings: one per priced variant.
    for (const v of product.product_variants) {
      if (v.price == null) continue
      const price = Number(v.price)
      const mrp = v.mrp ? Number(v.mrp) : (product.mrp ? Number(product.mrp) : null)
      const listPrice = mrp || price
      const salePrice = mrp && mrp > price ? price : null
      const inStock = productActive && v.stock_status !== 'Out of Stock'

      listings.push({
        sku: v.sku,
        productType,
        requirements: 'LISTING',
        attributes: {
          ...common,
          ...buildProductIdentity(product, v),
          ...buildModelNumber(product, v),
          item_name: attr(`${product.name} - ${v.variant_name}`),
          purchasable_offer: buildPurchasableOffer(listPrice, salePrice),
          fulfillment_availability: buildFulfillmentAvailability(inStock),
          ...(v.variant_name ? { size: attr(v.variant_name) } : {}),
          ...childVariationAttrs(parentSku),
        },
      })
    }

    return listings
  }

  // Simple product (no variants): one standalone listing with an offer, no variation attrs.
  const price = Number(product.base_price)
  const mrp = product.mrp ? Number(product.mrp) : null
  const listPrice = mrp || price
  const salePrice = mrp && mrp > price ? price : null
  const inStock = productActive && product.stock_status !== 'Out of Stock'

  return [{
    sku: product.sku,
    productType,
    requirements: 'LISTING',
    attributes: {
      ...common,
      ...buildProductIdentity(product),
      ...buildModelNumber(product),
      item_name: attr(product.name),
      purchasable_offer: buildPurchasableOffer(listPrice, salePrice),
      fulfillment_availability: buildFulfillmentAvailability(inStock),
      ...(product.size ? { size: attr(product.size) } : {}),
    },
  }]
}

// Offer-only listing on an EXISTING ASIN. Bypasses the "may not create new ASINs for brand"
// gate by attaching an offer to Amazon's existing detail page instead of creating one.
// requirements=LISTING_OFFER_ONLY + productType=PRODUCT (the root sales-terms type — this is
// the documented path and does NOT hit the "PRODUCT not listable" error, which only applies to
// requirements=LISTING). Minimal attribute set: merchant_suggested_asin, condition_type,
// purchasable_offer, fulfillment_availability. No dimensions/contact/hsn/images/variation.
export function productToAmazonOfferListing(
  product: any,
  asin: string,
  variant?: any,
): AmazonListing {
  const sku = variant?.sku || product.sku
  const price = variant?.price != null ? Number(variant.price) : Number(product.base_price)
  const mrp = variant?.mrp ? Number(variant.mrp) : (product.mrp ? Number(product.mrp) : null)
  const listPrice = mrp || price
  const salePrice = mrp && mrp > price ? price : null
  const productActive = product.is_active !== false
  const stock = variant?.stock_status ?? product.stock_status
  const inStock = productActive && stock !== 'Out of Stock'

  return {
    sku,
    productType: 'PRODUCT',
    requirements: 'LISTING_OFFER_ONLY',
    attributes: {
      merchant_suggested_asin: attr(asin),
      condition_type: attr('new_new'),
      purchasable_offer: buildPurchasableOffer(listPrice, salePrice),
      fulfillment_availability: buildFulfillmentAvailability(inStock),
    },
  }
}

// The product's canonical link (used by the status table / debugging).
export function productLink(product: any, sku?: string): string {
  const base = `${BASE_URL}/products/${product.slug}`
  return sku ? `${base}?sku=${encodeURIComponent(sku)}` : base
}
