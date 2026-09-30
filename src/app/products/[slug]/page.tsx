import { notFound } from 'next/navigation'
import Link from 'next/link'
import { cache } from 'react'
import type { Metadata } from 'next'
import { queryOne, queryMany } from '@/lib/db'
import {
  VARIANT_MIN_PRICE_INCL_GST_SQL,
  VARIANT_MIN_PRICE_EX_GST_SQL,
  VARIANT_MIN_MRP_SQL,
  VARIANT_STOCK_TOTAL_SQL,
} from '@/lib/queries'
import { getFeatureFlags, getStoreIdentity } from '@/lib/site-controls'
import { pickUnitPrice } from '@/lib/pricing'
import ProductDetailClient from '@/components/visitor/ProductDetailClient'
import ProductSpecifications from '@/components/visitor/pdp/ProductSpecifications'
import ProductReviews from '@/components/visitor/ProductReviews'
import ProductCard from '@/components/visitor/ProductCard'
import TrackRecentlyViewed from '@/components/visitor/TrackRecentlyViewed'
import RecentlyViewed from '@/components/visitor/RecentlyViewed'
import FeaturedForYou from '@/components/visitor/FeaturedForYou'
import PdpCompareSection from '@/components/visitor/PdpCompareSection'
import ProductPitchLine from '@/components/on-device/ProductPitchLine'
import { cardPropsFor } from '@/lib/product-cards'
import FrequentlyBoughtTogether from '@/components/visitor/pdp/FrequentlyBoughtTogether'
import CustomersAlsoViewed from '@/components/visitor/pdp/CustomersAlsoViewed'
import { getApprovedReviewSummary } from '@/lib/review-summary'
import { PDP_REVIEWS_ID } from '@/components/visitor/pdp/pdp'

const getProductBySlug = cache(async (slug: string) => {
  const { gstEnabled } = await getFeatureFlags()
  const MIN_PRICE_SQL = gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL
  return queryOne(
    `
    SELECT p.*,
      json_build_object('id', c.id, 'name', c.name, 'slug', c.slug,
        'return_allowed',          COALESCE(c.return_allowed,          pc.return_allowed,          true),
        'return_window_days',      COALESCE(c.return_window_days,      pc.return_window_days,      7),
        'replacement_allowed',     COALESCE(c.replacement_allowed,     pc.replacement_allowed,     true),
        'replacement_window_days', COALESCE(c.replacement_window_days, pc.replacement_window_days, 7)
      ) AS categories,
      json_build_object('id', b.id, 'name', b.name, 'slug', b.slug,
        'return_allowed', b.return_allowed, 'return_window_days', b.return_window_days,
        'replacement_allowed', b.replacement_allowed, 'replacement_window_days', b.replacement_window_days
      ) AS brands,
      COALESCE(
        (SELECT json_agg(pi ORDER BY pi.display_order)
         FROM product_images pi WHERE pi.product_id = p.id),
        '[]'::json
      ) AS product_images,
      COALESCE(
        (SELECT json_agg(
           jsonb_build_object(
             'id', pv.id, 'variant_name', pv.variant_name, 'sku', pv.sku,
             'price', pv.price, 'mrp', pv.mrp, 'price_ex_gst', pv.price_ex_gst,
             'stock_status', pv.stock_status,
             'pricing_type', pv.pricing_type, 'unit', pv.unit, 'numeric_value', pv.numeric_value,
             'sub_variant_type', pv.sub_variant_type, 'sell_unit_id', pv.sell_unit_id,
             'variant_type', pv.variant_type,
             'variant_images', COALESCE(
               (SELECT json_agg(vi ORDER BY vi.display_order)
                FROM variant_images vi WHERE vi.variant_id = pv.id),
               '[]'::json
             ),
             'sub_variants', COALESCE(
               (SELECT json_agg(sv ORDER BY sv.sub_variant_name)
                FROM product_sub_variants sv WHERE sv.variant_id = pv.id AND sv.is_active = true),
               '[]'::json
             )
           ) ORDER BY pv.variant_name
         )
         FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
        '[]'::json
      ) AS product_variants,
      ${MIN_PRICE_SQL} AS variant_min_price,
      ${VARIANT_MIN_MRP_SQL} AS variant_min_mrp,
      ${VARIANT_STOCK_TOTAL_SQL} AS variant_stock_total,
      COALESCE(
        (SELECT json_agg(
           json_build_object(
             'id', pu.id, 'variant_id', pu.variant_id, 'sub_variant_id', pu.sub_variant_id, 'unit', pu.unit,
             'factor', pu.factor, 'is_base', pu.is_base,
             'is_purchase_default', pu.is_purchase_default, 'display_label', pu.display_label,
             'dimension', pu.dimension, 'min_qty', pu.min_qty, 'max_qty', pu.max_qty, 'qty_step', pu.qty_step
           ) ORDER BY pu.is_base DESC
         )
         FROM product_units pu WHERE pu.product_id = p.id
        ),
        '[]'::json
      ) AS product_units
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN categories pc ON c.parent_category_id = pc.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.slug = $1 AND p.is_active = true
  `,
    [slug]
  )
})

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const [product, identity] = await Promise.all([getProductBySlug(slug), getStoreIdentity()])
  if (!product) return { title: 'Product Not Found' }

  const { gstEnabled } = await getFeatureFlags()
  const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
  const displayPrice =
    product.has_variants && product.variant_min_price
      ? product.variant_min_price
      : pickUnitPrice({ inclusive: product.base_price || 0, exGst: product.price_ex_gst }, gstEnabled)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistoress.com'

  return {
    title: `${product.name} | ${identity.name}`,
    description: product.description?.slice(0, 160) || `Buy ${product.name} at ${identity.name}`,
    openGraph: {
      title: product.name,
      description: product.description?.slice(0, 160) || `Buy ${product.name} at ${identity.name}`,
      url: `${baseUrl}/products/${product.slug}`,
      images: primaryImage ? [{ url: primaryImage.image_url, alt: product.name }] : [],
      type: 'website',
    },
    other: {
      'product:price:amount': String(Number(displayPrice)),
      'product:price:currency': 'INR',
    },
  }
}

function buildProductJsonLd(product: any, baseUrl: string) {
  const images = (product.product_images || []).map((img: any) => img.image_url)
  const hasVariants = product.has_variants && product.product_variants?.length > 0

  const offers = hasVariants
    ? product.product_variants.map((v: any) => {
        const price = v.price
        return {
          '@type': 'Offer',
          name: v.variant_name,
          sku: v.sku,
          ...(v.mpn && { mpn: v.mpn }),
          ...(v.gtin && { gtin: v.gtin }),
          price: price != null ? Number(price) : undefined,
          priceCurrency: 'INR',
          availability:
            v.stock_status !== 'Out of Stock' ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          itemCondition: 'https://schema.org/NewCondition',
          url: `${baseUrl}/products/${product.slug}?sku=${encodeURIComponent(v.sku)}`,
        }
      })
    : [
        {
          '@type': 'Offer',
          sku: product.sku,
          price: Number(product.base_price),
          priceCurrency: 'INR',
          availability:
            product.stock_status !== 'Out of Stock' ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          itemCondition: 'https://schema.org/NewCondition',
          url: `${baseUrl}/products/${product.slug}`,
        },
      ]

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description || undefined,
    sku: product.sku,
    ...(product.mpn && { mpn: product.mpn }),
    ...(product.gtin && { gtin: product.gtin }),
    image: images.length > 0 ? images : undefined,
    ...(product.brands && { brand: { '@type': 'Brand', name: product.brands.name } }),
    ...(product.categories && { category: product.categories.name }),
    offers: hasVariants ? { '@type': 'AggregateOffer', offerCount: offers.length, offers } : offers[0],
  }
}

const DIMENSION_SUFFIX =
  /[\s\-]+(M\d+(\.\d+)?|[A-Z]?\d+(\.\d+)?[A-Z]*|[A-Z]{1,3}\d+(\.\d+)?)(\s+(M\d+(\.\d+)?|[A-Z]{1,3}\d+(\.\d+)?|[\d.]+[A-Z]*))*\s*$/i

function nameStem(name: string): string {
  return name.trim().replace(DIMENSION_SUFFIX, '').toLowerCase().trim()
}

function deduplicateByNameStem(products: any[], excludeStem: string): any[] {
  const seen = new Set<string>([excludeStem])
  const result: any[] = []
  for (const p of products) {
    const stem = nameStem(p.name)
    if (!seen.has(stem)) {
      seen.add(stem)
      result.push(p)
    }
  }
  return result
}

async function getRelatedProducts(productId: string, categoryId: string, productName: string) {
  const { gstEnabled } = await getFeatureFlags()
  const MIN_PRICE_SQL = gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL
  const cols = `
    p.*,
    json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
    json_build_object('id', b.id, 'name', b.name) AS brands,
    COALESCE(
      (SELECT json_agg(pi ORDER BY pi.display_order)
       FROM product_images pi WHERE pi.product_id = p.id),
      '[]'::json
    ) AS product_images,
    ${VARIANT_STOCK_TOTAL_SQL} AS variant_stock_total,
    ${MIN_PRICE_SQL} AS variant_min_price,
    ${VARIANT_MIN_MRP_SQL} AS variant_min_mrp
  `

  const currentStem = nameStem(productName)

  const parentRow = await queryMany(`SELECT parent_category_id FROM categories WHERE id = $1`, [categoryId])
  const parentId = parentRow[0]?.parent_category_id

  if (!parentId) {
    const sameCatRaw = await queryMany(
      `
      SELECT ${cols}
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      WHERE p.category_id = $1 AND p.is_active = true AND p.id != $2
      LIMIT 20
    `,
      [categoryId, productId]
    )
    return deduplicateByNameStem(sameCatRaw, currentStem).slice(0, 4)
  }

  const onePer = await queryMany(
    `
    SELECT DISTINCT ON (p.category_id) ${cols}
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE c.parent_category_id = $1
      AND p.is_active = true
      AND p.id != $2
    ORDER BY p.category_id, RANDOM()
  `,
    [parentId, productId]
  )

  const currentCatFirst = [
    ...onePer.filter((p: any) => p.category_id === categoryId),
    ...onePer.filter((p: any) => p.category_id !== categoryId),
  ]

  const deduped = deduplicateByNameStem(currentCatFirst, currentStem)

  if (deduped.length >= 4) return deduped.slice(0, 4)

  const seenIds = new Set<string>([productId, ...deduped.map((p: any) => p.id)])
  const seenStems = new Set<string>([currentStem, ...deduped.map((p: any) => nameStem(p.name))])
  const needed = 4 - deduped.length
  const idList = [...seenIds].map((_, i) => `$${i + 2}`).join(', ')

  const fillRaw = await queryMany(
    `
    SELECT ${cols}
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE c.parent_category_id = $1
      AND p.is_active = true
      AND p.id NOT IN (${idList})
    ORDER BY RANDOM()
    LIMIT ${needed * 3}
  `,
    [parentId, ...[...seenIds]]
  )

  const fill: any[] = []
  for (const p of fillRaw) {
    const stem = nameStem(p.name)
    if (!seenStems.has(stem)) {
      seenStems.add(stem)
      fill.push(p)
      if (fill.length >= needed) break
    }
  }

  if (deduped.length + fill.length >= 4) return [...deduped, ...fill].slice(0, 4)

  const allIds = new Set<string>([productId, ...deduped.map((p: any) => p.id), ...fill.map((p: any) => p.id)])
  const allIdList = [...allIds].map((_, i) => `$${i + 2}`).join(', ')
  const stillNeeded = 4 - deduped.length - fill.length

  const extraRaw = await queryMany(
    `
    SELECT ${cols}
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE c.parent_category_id = $1
      AND p.is_active = true
      AND p.id NOT IN (${allIdList})
    ORDER BY RANDOM()
    LIMIT ${stillNeeded}
  `,
    [parentId, ...[...allIds]]
  )

  return [...deduped, ...fill, ...extraRaw].slice(0, 4)
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { slug } = await params
  const resolvedSearchParams = await searchParams
  const product = await getProductBySlug(slug)

  if (!product) {
    notFound()
  }

  const { gstEnabled } = await getFeatureFlags()

  const [relatedProducts, deliverySettings, reviewSummary] = await Promise.all([
    getRelatedProducts(product.id, product.category_id, product.name),
    // Use the authoritative delivery setting (same one checkout uses), not the
    // stale separate 'free_shipping_threshold' key.
    (await import('@/lib/delivery-settings')).getDeliverySettings(),
    getApprovedReviewSummary(product.id),
  ])
  const freeShippingThreshold = deliverySettings.freeThreshold
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistoress.com'
  const jsonLd = buildProductJsonLd(product, baseUrl)
  const skuParam = typeof resolvedSearchParams.sku === 'string' ? resolvedSearchParams.sku : undefined

  const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
  const hasVariants = product.has_variants && product.product_variants?.length > 0
  const displayPrice =
    hasVariants && product.variant_min_price
      ? product.variant_min_price
      : pickUnitPrice({ inclusive: product.base_price || 0, exGst: product.price_ex_gst }, gstEnabled)
  const rawMrp = product.mrp ? Number(product.mrp) : product.variant_min_mrp ? Number(product.variant_min_mrp) : null
  // When GST is off, displayPrice is ex-GST. Rebase the (inclusive) MRP to the same
  // ex-GST basis before computing the discount and before passing it to any card so the
  // discount % and struck-through MRP stay consistent with the shown price.
  const gstRate = Number(product.gst_percentage ?? 0)
  const mrp = !gstEnabled && rawMrp != null && gstRate > 0 ? rawMrp / (1 + gstRate / 100) : rawMrp
  const mrpDiscount = mrp && mrp > Number(displayPrice) ? Math.round(((mrp - Number(displayPrice)) / mrp) * 100) : 0

  return (
    <div className="bg-surface min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <TrackRecentlyViewed
        id={product.id}
        name={product.name}
        slug={product.slug}
        price={Number(displayPrice)}
        mrp={mrp}
        brand={product.brands?.name || null}
        inStock={
          product.has_variants ? Number(product.variant_stock_total ?? 0) > 0 : product.stock_status !== 'Out of Stock'
        }
        image={primaryImage?.thumbnail_url || primaryImage?.image_url || null}
      />
      {/* Breadcrumb */}
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4">
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/" className="text-foreground-muted hover:text-accent-500 whitespace-nowrap">
              Home
            </Link>
            <span className="text-foreground-muted">/</span>
            <Link href="/products" className="text-foreground-muted hover:text-accent-500 whitespace-nowrap">
              Products
            </Link>
            {product.categories && (
              <>
                <span className="text-foreground-muted">/</span>
                <Link
                  href={`/categories/${product.categories.slug}`}
                  className="text-foreground-muted hover:text-accent-500 whitespace-nowrap hidden sm:inline"
                >
                  {product.categories.name}
                </Link>
                <span className="text-foreground-muted sm:hidden">...</span>
              </>
            )}
            <span className="text-foreground-muted hidden sm:inline">/</span>
            <span className="text-foreground font-medium truncate hidden sm:inline">{product.name}</span>
          </nav>
        </div>
      </div>

      <div className="container mx-auto px-4 pt-4 sm:pt-6 lg:pt-8 pb-20">
        {/* Product Details */}
        <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden mb-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-8 p-4 sm:p-6 lg:p-8 lg:items-start">
            <ProductDetailClient
              product={product}
              initialSkuParam={skuParam}
              freeShippingThreshold={freeShippingThreshold}
              reviewSummary={reviewSummary}
            />
          </div>
        </div>

        <FrequentlyBoughtTogether
          current={cardPropsFor([product], gstEnabled)[0]}
          launchDate={product.launch_date}
          discontinueDate={product.discontinue_date}
        />

        <ProductSpecifications product={product} />

        {/* Features & Use Cases (AI-enriched) */}
        {(() => {
          const p = product as any
          const hasFeatures = p.ai_features?.length > 0
          const hasUseCases = p.ai_use_cases?.length > 0
          const hasWhoUses = p.ai_who_uses_it
          const hasApplication = p.ai_application

          if (!hasFeatures && !hasUseCases && !hasWhoUses && !hasApplication) return null

          return (
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-6 sm:p-8 mb-8">
              <h2 className="text-xl font-bold text-foreground mb-6">Features &amp; Use Cases</h2>
              <div className="space-y-6">
                {hasFeatures && (
                  <div>
                    <p className="text-xs text-foreground-muted mb-2 uppercase tracking-wide">Key Features</p>
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-1.5">
                      {(p.ai_features as string[]).map((f: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {hasUseCases && (
                  <>
                    {hasFeatures && <div className="border-t border-border-default" />}
                    <div>
                      <p className="text-xs text-foreground-muted mb-2 uppercase tracking-wide">Use Cases</p>
                      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-1.5">
                        {(p.ai_use_cases as string[]).map((u: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
                            {u}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}
                {(hasWhoUses || hasApplication) && (
                  <>
                    {(hasFeatures || hasUseCases) && <div className="border-t border-border-default" />}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-5">
                      {hasWhoUses && (
                        <div>
                          <p className="text-xs text-foreground-muted mb-0.5">Who Uses It</p>
                          <p className="font-semibold text-foreground text-sm">{p.ai_who_uses_it}</p>
                        </div>
                      )}
                      {hasApplication && (
                        <div>
                          <p className="text-xs text-foreground-muted mb-0.5">Application</p>
                          <p className="font-semibold text-foreground text-sm">{p.ai_application}</p>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )
        })()}

        {/* Inline Compare Section */}
        {relatedProducts.length >= 1 &&
          (() => {
            const primaryImage =
              product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
            const displayPrice =
              product.has_variants && product.variant_min_price
                ? Number(product.variant_min_price)
                : Number(pickUnitPrice({ inclusive: product.base_price, exGst: product.price_ex_gst }, gstEnabled))
            const rawMrp = product.mrp
              ? Number(product.mrp)
              : product.variant_min_mrp
                ? Number(product.variant_min_mrp)
                : null
            // When GST is off, displayPrice is ex-GST — rebase the inclusive MRP to match.
            const gstRate = Number(product.gst_percentage ?? 0)
            const mrp = !gstEnabled && rawMrp != null && gstRate > 0 ? rawMrp / (1 + gstRate / 100) : rawMrp
            return (
              <PdpCompareSection
                currentProduct={{
                  id: product.id,
                  name: product.name,
                  slug: product.slug,
                  price: displayPrice,
                  mrp,
                  image: primaryImage?.thumbnail_url || primaryImage?.image_url || null,
                  brandName: product.brands?.name || null,
                  categoryId: product.category_id || null,
                  material: product.material ?? null,
                  finish: product.finish ?? null,
                  variant_type: product.variant_type ?? null,
                  condition: product.condition ?? null,
                  color: product.color ?? null,
                  weight: product.weight ?? null,
                  weight_unit: product.weight_unit ?? null,
                  net_weight_grams: product.net_weight_grams ?? null,
                  volume_ml: product.volume_ml ?? null,
                  country_of_origin: product.country_of_origin ?? null,
                  warranty_months: product.warranty_months ?? null,
                  warranty_type: product.warranty_type ?? null,
                  compliance_standard: product.compliance_standard ?? null,
                  safety_rating: product.safety_rating ?? null,
                  certifications: (product.certifications as string[] | null) ?? null,
                  fragile: product.fragile ?? null,
                  hazardous: product.hazardous ?? null,
                  flammable: product.flammable ?? null,
                  hsn_code: product.hsn_code ?? null,
                  gst_percentage: product.gst_percentage ?? null,
                }}
                relatedProducts={relatedProducts.slice(0, 2).map((rp: any) => {
                  const rImg = rp.product_images?.find((img: any) => img.is_primary) || rp.product_images?.[0]
                  const rPrice =
                    rp.has_variants && rp.variant_min_price
                      ? Number(rp.variant_min_price)
                      : Number(pickUnitPrice({ inclusive: rp.base_price, exGst: rp.price_ex_gst }, gstEnabled))
                  const rRawMrp = rp.mrp ? Number(rp.mrp) : rp.variant_min_mrp ? Number(rp.variant_min_mrp) : null
                  // When GST is off, rPrice is ex-GST — rebase the inclusive MRP to match.
                  const rGstRate = Number(rp.gst_percentage ?? 0)
                  const rMrp = !gstEnabled && rRawMrp != null && rGstRate > 0 ? rRawMrp / (1 + rGstRate / 100) : rRawMrp
                  return {
                    id: rp.id,
                    name: rp.name,
                    slug: rp.slug,
                    price: rPrice,
                    mrp: rMrp,
                    image: rImg?.thumbnail_url || rImg?.image_url || null,
                    brandName: rp.brands?.name || null,
                    categoryId: rp.category_id || null,
                    material: rp.material ?? null,
                    finish: rp.finish ?? null,
                    variant_type: rp.variant_type ?? null,
                    condition: rp.condition ?? null,
                    color: rp.color ?? null,
                    weight: rp.weight ?? null,
                    weight_unit: rp.weight_unit ?? null,
                    net_weight_grams: rp.net_weight_grams ?? null,
                    volume_ml: rp.volume_ml ?? null,
                    country_of_origin: rp.country_of_origin ?? null,
                    warranty_months: rp.warranty_months ?? null,
                    warranty_type: rp.warranty_type ?? null,
                    compliance_standard: rp.compliance_standard ?? null,
                    safety_rating: rp.safety_rating ?? null,
                    certifications: (rp.certifications as string[] | null) ?? null,
                    fragile: rp.fragile ?? null,
                    hazardous: rp.hazardous ?? null,
                    flammable: rp.flammable ?? null,
                    hsn_code: rp.hsn_code ?? null,
                    gst_percentage: rp.gst_percentage ?? null,
                  }
                })}
              />
            )
          })()}

        {/* Description */}
        {product.description && (
          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-6 sm:p-8 mb-8">
            <h2 className="text-2xl font-bold text-foreground mb-4">Product Description</h2>
            <p className="text-foreground-secondary leading-relaxed whitespace-pre-line">{product.description}</p>
            <ProductPitchLine
              productName={product.name}
              brand={product.brands?.name || null}
              category={product.categories?.name || null}
            />
          </div>
        )}

        {/* Product Reviews */}
        <div id={PDP_REVIEWS_ID} className="scroll-mt-16 lg:scroll-mt-20">
          <ProductReviews productId={product.id} productName={product.name} />
        </div>

        <CustomersAlsoViewed productId={product.id} />

        {/* Recently Viewed */}
        <RecentlyViewed excludeId={product.id} minItems={2} />

        {/* Personalised picks */}
        <FeaturedForYou />

        {/* Related Products */}
        {relatedProducts.length >= 4 && (
          <div className="mt-10">
            <h2 className="text-2xl font-bold text-foreground mb-6">Related Products</h2>
            <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {relatedProducts.map((relatedProduct: any) => {
                const relatedPrimaryImage =
                  relatedProduct.product_images?.find((img: any) => img.is_primary) ||
                  relatedProduct.product_images?.[0]
                const relatedHasVariants = relatedProduct.has_variants
                const relatedDisplayPrice =
                  relatedHasVariants && relatedProduct.variant_min_price
                    ? Number(relatedProduct.variant_min_price)
                    : Number(
                        pickUnitPrice(
                          { inclusive: relatedProduct.base_price, exGst: relatedProduct.price_ex_gst },
                          gstEnabled
                        )
                      )
                const relatedRawMrp = relatedProduct.mrp
                  ? Number(relatedProduct.mrp)
                  : relatedProduct.variant_min_mrp
                    ? Number(relatedProduct.variant_min_mrp)
                    : null
                // When GST is off, displayPrice is ex-GST. Rebase the (inclusive) MRP to the
                // same ex-GST basis before computing the discount so the % and struck-through
                // MRP stay consistent with the shown price.
                const relatedGstRate = Number(relatedProduct.gst_percentage ?? 0)
                const relatedMrp =
                  !gstEnabled && relatedRawMrp != null && relatedGstRate > 0
                    ? relatedRawMrp / (1 + relatedGstRate / 100)
                    : relatedRawMrp
                const relatedMrpDiscount =
                  relatedMrp && relatedMrp > relatedDisplayPrice
                    ? Math.round(((relatedMrp - relatedDisplayPrice) / relatedMrp) * 100)
                    : 0
                const relatedStock = relatedHasVariants
                  ? Number(relatedProduct.variant_stock_total ?? 0)
                  : relatedProduct.stock_status !== 'Out of Stock'
                    ? 1
                    : 0

                return (
                  <ProductCard
                    key={relatedProduct.id}
                    id={relatedProduct.id}
                    name={relatedProduct.name}
                    slug={relatedProduct.slug}
                    hasVariants={relatedHasVariants}
                    displayPrice={relatedDisplayPrice}
                    mrp={relatedMrp}
                    mrpDiscount={relatedMrpDiscount}
                    effectiveStock={relatedStock}
                    primaryImage={relatedPrimaryImage || null}
                    brandName={relatedProduct.brands?.name || null}
                    categoryName={relatedProduct.categories?.name || null}
                    discountPct={Number(relatedProduct.discount_pct ?? 0)}
                    extraDeliveryDays={Number(relatedProduct.extra_delivery_days ?? 0)}
                    handlingDays={Number(relatedProduct.handling_days ?? 2)}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
