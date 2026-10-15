import { buildProductHighlights, buildProductDetails } from '@/lib/shared/google-merchant-helpers'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistoress.com'
const TARGET_COUNTRY = 'IN'
const CONTENT_LANGUAGE = 'en'
const CHANNEL = 'online'

function buildOfferId(sku: string): string {
  return sku.replace(/[^a-zA-Z0-9_:.-]/g, '_')
}

function buildShipping(price: number) {
  return [
    {
      country: TARGET_COUNTRY,
      service: 'Standard',
      price: { value: '0', currency: 'INR' },
    },
  ]
}

function buildAdditionalImages(product: any, primaryId?: string): Array<{ link: string }> {
  return (product.product_images || [])
    .filter((img: any) => img.id !== primaryId && img.image_url)
    .slice(0, 10)
    .map((img: any) => ({ link: img.image_url }))
}

function buildHighlights(product: any): string[] {
  // Content API v2.1: productHighlights is an array of plain strings.
  return buildProductHighlights(product)
}

function buildDetails(product: any): Array<{ sectionName: string; attributeName: string; attributeValue: string }> {
  // Content API v2.1: attributeValue is a scalar string, NOT an object.
  return buildProductDetails(product).map(d => ({
    sectionName: d.section,
    attributeName: d.attribute,
    attributeValue: d.value,
  }))
}

// Google: identifierExists=true only when there is a GTIN, or an MPN together with a brand.
// A brand alone is not a unique identifier.
function hasIdentifiers(gtin: unknown, mpn: unknown, brand: string): boolean {
  return !!(gtin || (mpn && brand))
}

// price is the higher MRP only when it is a real markdown; otherwise the selling price
// (an MRP below the selling price, e.g. ex-GST, must never become the advertised price).
function buildPrices(selling: number, mrp: number | null) {
  const listed = mrp != null && mrp > selling ? mrp : selling
  const onSale = listed > selling
  return {
    price: { value: listed.toFixed(2), currency: 'INR' },
    salePrice: onSale ? { value: selling.toFixed(2), currency: 'INR' } : undefined,
  }
}

const MAX_TITLE = 150
const MAX_OFFER_ID = 50

function buildTitle(title: string): string {
  return title.length > MAX_TITLE ? title.slice(0, MAX_TITLE - 1).trimEnd() + '…' : title
}

// Problems Google would reject an item for that only the merchant can fix in the product data.
export function gmcItemProblem(item: any): string | null {
  if (!item.title?.trim()) return 'Missing product name'
  if (!item.offerId) return 'Missing SKU'
  if (item.offerId.length > MAX_OFFER_ID) return `SKU is longer than ${MAX_OFFER_ID} characters`
  if (!item.imageLink) return 'Missing product image'
  if (!/^https?:\/\//i.test(item.imageLink)) return 'Product image is not a full http(s) URL'
  if (!(Number(item.price?.value) > 0)) return 'Missing or zero price'
  return null
}

export function productToGmcItems(product: any): any[] {
  if (product.is_digital) return []
  const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
  const imageLink = primaryImage?.image_url || ''
  const additionalImages = buildAdditionalImages(product, primaryImage?.id)
  const brandName = product.brands?.name || ''
  const description = (product.description || product.name || '').slice(0, 5000)
  const highlights = buildHighlights(product)
  const details = buildDetails(product)
  const hasVariants = product.has_variants && product.product_variants?.length > 0
  const productActive = product.is_active !== false

  const cogs = (cost: any) => {
    const n = Number(cost)
    return n > 0 ? { value: n.toFixed(2), currency: 'INR' } : undefined
  }

  const common = {
    channel: CHANNEL,
    contentLanguage: CONTENT_LANGUAGE,
    targetCountry: TARGET_COUNTRY,
    description,
    imageLink,
    additionalImageLinks: additionalImages.map(i => i.link),
    brand: brandName || undefined,
    gtin: product.gtin || undefined,
    mpn: product.mpn || undefined,
    identifierExists: hasIdentifiers(product.gtin, product.mpn, brandName),
    condition: 'new',
    ageGroup: 'adult',
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

        return {
          ...common,
          offerId: buildOfferId(v.sku),
          title: buildTitle(`${product.name} - ${v.variant_name}`),
          link: `${BASE_URL}/products/${product.slug}?sku=${encodeURIComponent(v.sku)}`,
          ...buildPrices(Number(v.price), mrp),
          availability: !productActive
            ? 'out of stock'
            : v.stock_status !== 'Out of Stock'
              ? 'in stock'
              : 'out of stock',
          itemGroupId: buildOfferId(product.sku),
          sizes: v.variant_name ? [v.variant_name] : undefined,
          gtin: v.gtin || product.gtin || undefined,
          mpn: v.mpn || product.mpn || undefined,
          identifierExists: hasIdentifiers(v.gtin || product.gtin, v.mpn || product.mpn, brandName),
          costOfGoodsSold: cogs(v.cost_price ?? product.cost_price),
        }
      })
  }

  const mrp = product.mrp ? Number(product.mrp) : null

  return [
    {
      ...common,
      offerId: buildOfferId(product.sku),
      title: buildTitle(product.name || ''),
      link: `${BASE_URL}/products/${product.slug}`,
      ...buildPrices(Number(product.base_price), mrp),
      availability: !productActive
        ? 'out of stock'
        : product.stock_status !== 'Out of Stock'
          ? 'in stock'
          : 'out of stock',
      sizes: product.size ? [product.size] : undefined,
      costOfGoodsSold: cogs(product.cost_price),
    },
  ]
}
