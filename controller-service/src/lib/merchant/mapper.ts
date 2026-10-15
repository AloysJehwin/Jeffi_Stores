import { buildProductHighlights, buildProductDetails } from '@/lib/shared/google-merchant-helpers'
import { clipTitle, hasIdentifiers, listedPrices } from './item-rules'

// Merchant API v1 ProductInput (products_v1). Attributes live under productAttributes; prices are
// {amountMicros, currencyCode}; the Content API channel/targetCountry become contentLanguage + feedLabel.
export const CONTENT_LANGUAGE = 'en'
export const FEED_LABEL = 'IN'
const COUNTRY = 'IN'
const CURRENCY = 'INR'

function buildOfferId(sku: string): string {
  return sku.replace(/[^a-zA-Z0-9_:.-]/g, '_')
}

export function toPrice(amount: number): { amountMicros: string; currencyCode: string } {
  return { amountMicros: String(Math.round(amount * 1_000_000)), currencyCode: CURRENCY }
}

function buildShipping(price: number) {
  return [{ country: COUNTRY, service: 'Standard', price: toPrice(price) }]
}

function buildAdditionalImages(product: any, primaryId?: string): Array<{ link: string }> {
  return (product.product_images || [])
    .filter((img: any) => img.id !== primaryId && img.image_url)
    .slice(0, 10)
    .map((img: any) => ({ link: img.image_url }))
}

function buildDetails(product: any): Array<{ sectionName: string; attributeName: string; attributeValue: string }> {
  return buildProductDetails(product).map(d => ({
    sectionName: d.section,
    attributeName: d.attribute,
    attributeValue: d.value,
  }))
}

function buildPrices(selling: number, mrp: number | null) {
  const { price, salePrice } = listedPrices(selling, mrp)
  return {
    price: toPrice(price),
    salePrice: salePrice != null ? toPrice(salePrice) : undefined,
  }
}

const MAX_OFFER_ID = 50

// Problems Google would reject an item for that only the merchant can fix in the product data.
export function gmcItemProblem(item: any): string | null {
  const a = item.productAttributes || {}
  if (!a.title?.trim()) return 'Missing product name'
  if (!item.offerId) return 'Missing SKU'
  if (item.offerId.length > MAX_OFFER_ID) return `SKU is longer than ${MAX_OFFER_ID} characters`
  if (!a.imageLink) return 'Missing product image'
  if (!/^https?:\/\//i.test(a.imageLink)) return 'Product image is not a full http(s) URL'
  if (!(Number(a.price?.amountMicros) > 0)) return 'Missing or zero price'
  return null
}

const availability = (active: boolean, stockStatus: unknown) =>
  active && stockStatus !== 'Out of Stock' ? 'IN_STOCK' : 'OUT_OF_STOCK'

const gtins = (gtin: unknown) => (gtin ? [String(gtin)] : undefined)

// baseUrl is the store's public origin (see catalogBaseUrl); links must match the site verified
// in Merchant Center.
export function productToGmcItems(product: any, baseUrl: string): any[] {
  if (product.is_digital) return []
  const base = baseUrl.replace(/\/+$/, '')
  const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
  const imageLink = primaryImage?.image_url || ''
  const additionalImages = buildAdditionalImages(product, primaryImage?.id)
  const brandName = product.brands?.name || ''
  const description = (product.description || product.name || '').slice(0, 5000)
  const highlights = buildProductHighlights(product)
  const details = buildDetails(product)
  const hasVariants = product.has_variants && product.product_variants?.length > 0
  const productActive = product.is_active !== false

  const cogs = (cost: any) => {
    const n = Number(cost)
    return n > 0 ? toPrice(n) : undefined
  }

  const input = (offerId: string, attributes: Record<string, unknown>) => ({
    offerId,
    contentLanguage: CONTENT_LANGUAGE,
    feedLabel: FEED_LABEL,
    productAttributes: { ...common, ...attributes },
  })

  const common = {
    description,
    imageLink,
    additionalImageLinks: additionalImages.map(i => i.link),
    brand: brandName || undefined,
    gtins: gtins(product.gtin),
    mpn: product.mpn || undefined,
    identifierExists: hasIdentifiers(product.gtin, product.mpn, brandName),
    condition: 'NEW',
    ageGroup: 'ADULT',
    material: product.material || undefined,
    shipping: buildShipping(0),
    productHighlights: highlights.length ? highlights : undefined,
    productDetails: details.length ? details : undefined,
    isBundle: false,
  }

  if (hasVariants) {
    return product.product_variants
      .filter((v: any) => v.price != null)
      .map((v: any) => {
        const mrp = v.mrp ? Number(v.mrp) : product.mrp ? Number(product.mrp) : null
        return input(buildOfferId(v.sku), {
          title: clipTitle(`${product.name} - ${v.variant_name}`),
          link: `${base}/products/${product.slug}?sku=${encodeURIComponent(v.sku)}`,
          ...buildPrices(Number(v.price), mrp),
          availability: availability(productActive, v.stock_status),
          itemGroupId: buildOfferId(product.sku),
          size: v.variant_name || undefined,
          gtins: gtins(v.gtin || product.gtin),
          mpn: v.mpn || product.mpn || undefined,
          identifierExists: hasIdentifiers(v.gtin || product.gtin, v.mpn || product.mpn, brandName),
          costOfGoodsSold: cogs(v.cost_price ?? product.cost_price),
        })
      })
  }

  const mrp = product.mrp ? Number(product.mrp) : null
  return [
    input(buildOfferId(product.sku), {
      title: clipTitle(product.name || ''),
      link: `${base}/products/${product.slug}`,
      ...buildPrices(Number(product.base_price), mrp),
      availability: availability(productActive, product.stock_status),
      size: product.size || undefined,
      costOfGoodsSold: cogs(product.cost_price),
    }),
  ]
}
