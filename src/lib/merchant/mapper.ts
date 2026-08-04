import {
  getGoogleProductCategory,
  buildProductType,
  buildProductHighlights,
  buildProductDetails,
  buildCustomLabels,
} from '@/lib/google-merchant-helpers'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistoress.com'
const TARGET_COUNTRY = 'IN'
const CONTENT_LANGUAGE = 'en'
const CHANNEL = 'online'

function buildOfferId(sku: string): string {
  return sku.replace(/[^a-zA-Z0-9_:.-]/g, '_')
}

function buildShipping(price: number) {
  return [{
    country: TARGET_COUNTRY,
    service: 'Standard',
    price: { value: '0', currency: 'INR' },
  }]
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

export function productToGmcItems(product: any): any[] {
  const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
  const imageLink = primaryImage?.image_url || ''
  const additionalImages = buildAdditionalImages(product, primaryImage?.id)
  const brandName = product.brands?.name || ''
  const description = (product.description || product.name || '').slice(0, 5000)
  const googleProductCategory = getGoogleProductCategory(product)
  const productType = buildProductType(product)
  const highlights = buildHighlights(product)
  const details = buildDetails(product)
  const hasVariants = product.has_variants && product.product_variants?.length > 0

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
    identifierExists: !!(product.mpn || product.gtin || brandName),
    condition: 'new',
    ageGroup: 'adult',
    material: product.material || undefined,
    shipping: buildShipping(0),
    shippingWeight: product.weight ? { value: String(product.weight), unit: 'kg' } : undefined,
    googleProductCategory: googleProductCategory || undefined,
    productTypes: productType ? [productType] : undefined,
    productHighlights: highlights.length ? highlights : undefined,
    productDetails: details.length ? details : undefined,
    isBundle: false,
    taxCategory: product.hsn_code || undefined,
  }

  if (hasVariants) {
    return product.product_variants
      .filter((v: any) => v.price != null)
      .map((v: any) => {
        const price = Number(v.price)
        const mrp = v.mrp ? Number(v.mrp) : (product.mrp ? Number(product.mrp) : null)
        const hasSale = mrp && mrp > price
        const [cl0, cl1, cl2, cl3, cl4] = buildCustomLabels(product, v.stock_status)

        return {
          ...common,
          offerId: buildOfferId(v.sku),
          title: `${product.name} - ${v.variant_name}`,
          link: `${BASE_URL}/products/${product.slug}?sku=${encodeURIComponent(v.sku)}`,
          price: { value: (hasSale ? price : (mrp || price)).toFixed(2), currency: 'INR' },
          salePrice: hasSale ? { value: price.toFixed(2), currency: 'INR' } : undefined,
          availability: v.stock_status !== 'Out of Stock' ? 'in stock' : 'out of stock',
          itemGroupId: buildOfferId(product.sku),
          sizes: v.variant_name ? [v.variant_name] : undefined,
          gtin: v.gtin || product.gtin || undefined,
          mpn: v.mpn || product.mpn || undefined,
          identifierExists: !!(v.mpn || product.mpn || v.gtin || product.gtin || brandName),
          customLabel0: cl0,
          customLabel1: cl1,
          customLabel2: cl2,
          customLabel3: cl3,
          customLabel4: cl4,
        }
      })
  }

  const price = Number(product.base_price)
  const mrp = product.mrp ? Number(product.mrp) : null
  const hasSale = mrp && mrp > price
  const [cl0, cl1, cl2, cl3, cl4] = buildCustomLabels(product)

  return [{
    ...common,
    offerId: buildOfferId(product.sku),
    title: product.name,
    link: `${BASE_URL}/products/${product.slug}`,
    price: { value: (hasSale ? price : (mrp || price)).toFixed(2), currency: 'INR' },
    salePrice: hasSale ? { value: price.toFixed(2), currency: 'INR' } : undefined,
    availability: product.stock_status !== 'Out of Stock' ? 'in stock' : 'out of stock',
    sizes: product.size ? [product.size] : undefined,
    customLabel0: cl0,
    customLabel1: cl1,
    customLabel2: cl2,
    customLabel3: cl3,
    customLabel4: cl4,
  }]
}
