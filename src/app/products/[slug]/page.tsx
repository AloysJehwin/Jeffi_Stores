import { notFound } from 'next/navigation'
import Link from 'next/link'
import { cache } from 'react'
import type { Metadata } from 'next'
import { queryOne, queryMany } from '@/lib/db'
import { VARIANT_MIN_PRICE_INCL_GST_SQL, VARIANT_MIN_MRP_SQL, VARIANT_STOCK_TOTAL_SQL } from '@/lib/queries'
import ProductDetailClient from '@/components/visitor/ProductDetailClient'
import ProductReviews from '@/components/visitor/ProductReviews'
import ProductCard from '@/components/visitor/ProductCard'
import TrackRecentlyViewed from '@/components/visitor/TrackRecentlyViewed'
import RecentlyViewed from '@/components/visitor/RecentlyViewed'
import PdpCompareSection from '@/components/visitor/PdpCompareSection'

const getProductBySlug = cache(async (slug: string) => {
  return queryOne(`
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
      ${VARIANT_MIN_PRICE_INCL_GST_SQL} AS variant_min_price,
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
  `, [slug])
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const product = await getProductBySlug(slug)
  if (!product) return { title: 'Product Not Found' }

  const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
  const displayPrice = product.has_variants && product.variant_min_price
    ? product.variant_min_price
    : (product.base_price || 0)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistoress.com'

  return {
    title: `${product.name} | Jeffi Stores`,
    description: product.description?.slice(0, 160) || `Buy ${product.name} at Jeffi Stores`,
    openGraph: {
      title: product.name,
      description: product.description?.slice(0, 160) || `Buy ${product.name} at Jeffi Stores`,
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
          availability: v.stock_status !== 'Out of Stock'
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
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
          availability: product.stock_status !== 'Out of Stock'
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
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
    offers: hasVariants
      ? { '@type': 'AggregateOffer', offerCount: offers.length, offers }
      : offers[0],
  }
}

const DIMENSION_SUFFIX = /[\s\-]+(M\d+(\.\d+)?|[A-Z]?\d+(\.\d+)?[A-Z]*|[A-Z]{1,3}\d+(\.\d+)?)(\s+(M\d+(\.\d+)?|[A-Z]{1,3}\d+(\.\d+)?|[\d.]+[A-Z]*))*\s*$/i

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
    ${VARIANT_MIN_PRICE_INCL_GST_SQL} AS variant_min_price,
    ${VARIANT_MIN_MRP_SQL} AS variant_min_mrp
  `

  const currentStem = nameStem(productName)

  const parentRow = await queryMany(
    `SELECT parent_category_id FROM categories WHERE id = $1`,
    [categoryId]
  )
  const parentId = parentRow[0]?.parent_category_id

  if (!parentId) {
    const sameCatRaw = await queryMany(`
      SELECT ${cols}
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN brands b ON p.brand_id = b.id
      WHERE p.category_id = $1 AND p.is_active = true AND p.id != $2
      LIMIT 20
    `, [categoryId, productId])
    return deduplicateByNameStem(sameCatRaw, currentStem).slice(0, 4)
  }

  const onePer = await queryMany(`
    SELECT DISTINCT ON (p.category_id) ${cols}
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE c.parent_category_id = $1
      AND p.is_active = true
      AND p.id != $2
    ORDER BY p.category_id, RANDOM()
  `, [parentId, productId])

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

  const fillRaw = await queryMany(`
    SELECT ${cols}
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE c.parent_category_id = $1
      AND p.is_active = true
      AND p.id NOT IN (${idList})
    ORDER BY RANDOM()
    LIMIT ${needed * 3}
  `, [parentId, ...[...seenIds]])

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

  const extraRaw = await queryMany(`
    SELECT ${cols}
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE c.parent_category_id = $1
      AND p.is_active = true
      AND p.id NOT IN (${allIdList})
    ORDER BY RANDOM()
    LIMIT ${stillNeeded}
  `, [parentId, ...[...allIds]])

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

  const relatedProducts = await getRelatedProducts(product.id, product.category_id, product.name)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistoress.com'
  const jsonLd = buildProductJsonLd(product, baseUrl)
  const skuParam = typeof resolvedSearchParams.sku === 'string' ? resolvedSearchParams.sku : undefined

  const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
  const hasVariants = product.has_variants && product.product_variants?.length > 0
  const displayPrice = hasVariants && product.variant_min_price
    ? product.variant_min_price
    : (product.base_price || 0)
  const mrp = product.mrp
    ? Number(product.mrp)
    : (product.variant_min_mrp ? Number(product.variant_min_mrp) : null)
  const mrpDiscount = mrp && mrp > Number(displayPrice)
    ? Math.round(((mrp - Number(displayPrice)) / mrp) * 100)
    : 0

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
          product.has_variants
            ? Number(product.variant_stock_total ?? 0) > 0
            : product.stock_status !== 'Out of Stock'
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

      <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
        {/* Product Details */}
        <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden mb-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-8 p-4 sm:p-6 lg:p-8 lg:items-start">
            <ProductDetailClient product={product} initialSkuParam={skuParam} />
          </div>
        </div>

        {/* Specifications card */}
        {(() => {
          const p = product as any
          const primarySpecs = [
            p.brands            && { label: 'Brand',              value: p.brands.name },
            p.sku               && { label: 'SKU',                value: p.sku },
            p.material          && { label: 'Material',           value: p.material },
            p.finish            && { label: 'Finish',             value: p.finish },
            p.color             && { label: 'Color',              value: p.color },
            p.size              && { label: 'Size',               value: p.size },
            p.variant_type      && { label: 'Variant Type',       value: p.variant_type },
            p.sub_variant_type  && { label: 'Sub-Variant Type',   value: p.sub_variant_type },
            p.dimensions        && { label: 'Dimensions',         value: `${p.dimensions} cm` },
            p.weight != null    && { label: 'Weight',             value: p.weight_unit ? `${p.weight} ${p.weight_unit}` : `${p.weight} kg` },
            p.weight_grams      && { label: 'Net Weight',         value: `${p.weight_grams} g` },
            p.net_weight_grams  && { label: 'Net Weight',         value: `${p.net_weight_grams} g` },
            p.volume_ml         && { label: 'Volume',             value: `${p.volume_ml} ml` },
            (p.length_cm || p.breadth_cm || p.height_cm) && {
              label: 'Package Dimensions',
              value: [p.length_cm, p.breadth_cm, p.height_cm].filter((v: any) => v != null).join(' × ') + (p.length_unit ? ` ${p.length_unit}` : ' cm'),
            },
            p.package_type      && { label: 'Package Type',      value: p.package_type },
            p.country_of_origin && { label: 'Origin',            value: p.country_of_origin },
            p.brand_part_number && { label: 'Part Number',       value: p.brand_part_number },
            p.warranty_months   && { label: 'Warranty',          value: `${p.warranty_months} month${p.warranty_months > 1 ? 's' : ''}${p.warranty_type ? ` (${p.warranty_type})` : ''}` },
            p.compliance_standard && { label: 'Compliance',      value: p.compliance_standard },
            p.safety_rating     && { label: 'Safety Rating',     value: p.safety_rating },
            p.barcode           && { label: 'Barcode',           value: p.barcode },
            p.isbn              && { label: 'ISBN',              value: p.isbn },
            p.asin              && { label: 'ASIN',              value: p.asin },
            (p.age_min || p.age_max) && {
              label: 'Age Range',
              value: p.age_min && p.age_max ? `${p.age_min}–${p.age_max} years` : p.age_min ? `${p.age_min}+ years` : `Up to ${p.age_max} years`,
            },
            p.target_gender && p.target_gender !== 'unisex' && { label: 'For', value: p.target_gender.charAt(0).toUpperCase() + p.target_gender.slice(1) },
          ].filter(Boolean) as { label: string; value: string }[]

          const generalSpecs = [
            p.categories        && { label: 'Category',          value: p.categories.name },
            p.mpn               && { label: 'MPN',               value: p.mpn },
            p.gtin              && { label: 'GTIN / EAN',        value: p.gtin },
            p.hsn_code          && { label: 'HSN Code',          value: p.hsn_code },
            p.gst_percentage != null && { label: 'GST',          value: `${parseFloat(String(p.gst_percentage))}%` },
            p.currency          && { label: 'Currency',          value: p.currency },
          ].filter(Boolean) as { label: string; value: string }[]

          const hazards = [p.fragile && 'Fragile', p.hazardous && 'Hazardous', p.flammable && 'Flammable'].filter(Boolean) as string[]
          const certList = (p.certifications as string[] | null) ?? []
          const audienceList = (p.target_audience as string[] | null) ?? []

          if (primarySpecs.length === 0 && generalSpecs.length === 0 && hazards.length === 0 && certList.length === 0 && audienceList.length === 0) return null

          return (
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-6 sm:p-8 mb-8">
              <h2 className="text-xl font-bold text-foreground mb-6">Specifications</h2>

              {/* Hazard badges */}
              {hazards.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-6">
                  {p.fragile && <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300">⚠ Fragile</span>}
                  {p.hazardous && <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300">☢ Hazardous</span>}
                  {p.flammable && <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300">🔥 Flammable</span>}
                </div>
              )}

              {primarySpecs.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-5 mb-6">
                  {primarySpecs.map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-xs text-foreground-muted mb-0.5">{label}</p>
                      <p className="font-semibold text-foreground text-sm">{value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Certifications */}
              {certList.length > 0 && (
                <div className="mb-6">
                  <p className="text-xs text-foreground-muted mb-2">Certifications</p>
                  <div className="flex flex-wrap gap-2">
                    {certList.map((c: string, i: number) => (
                      <span key={i} className="px-2 py-1 rounded-md text-xs font-medium bg-surface-secondary border border-border-default text-foreground">{c}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Target audience */}
              {audienceList.length > 0 && (
                <div className="mb-6">
                  <p className="text-xs text-foreground-muted mb-2">Target Audience</p>
                  <div className="flex flex-wrap gap-2">
                    {audienceList.map((a: string, i: number) => (
                      <span key={i} className="px-2 py-1 rounded-md text-xs font-medium bg-surface-secondary border border-border-default text-foreground">{a}</span>
                    ))}
                  </div>
                </div>
              )}

              {generalSpecs.length > 0 && (
                <>
                  {(primarySpecs.length > 0 || certList.length > 0 || audienceList.length > 0) && <div className="border-t border-border-default mb-6" />}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-5">
                    {generalSpecs.map(({ label, value }) => (
                      <div key={label}>
                        <p className="text-xs text-foreground-muted mb-0.5">{label}</p>
                        <p className="font-semibold text-foreground text-sm">{value}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        })()}

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
        {relatedProducts.length >= 1 && (() => {
          const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
          const displayPrice = product.has_variants && product.variant_min_price
            ? Number(product.variant_min_price)
            : Number(product.base_price)
          const mrp = product.mrp ? Number(product.mrp) : (product.variant_min_mrp ? Number(product.variant_min_mrp) : null)
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
                const rPrice = rp.has_variants && rp.variant_min_price ? Number(rp.variant_min_price) : Number(rp.base_price)
                const rMrp = rp.mrp ? Number(rp.mrp) : (rp.variant_min_mrp ? Number(rp.variant_min_mrp) : null)
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
            <p className="text-foreground-secondary leading-relaxed whitespace-pre-line">
              {product.description}
            </p>
          </div>
        )}

        {/* Product Reviews */}
        <ProductReviews productId={product.id} productName={product.name} />

        {/* Recently Viewed */}
        <RecentlyViewed excludeId={product.id} />

        {/* Related Products */}
        {relatedProducts.length >= 4 && (
          <div className="mt-10">
            <h2 className="text-2xl font-bold text-foreground mb-6">Related Products</h2>
            <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {relatedProducts.map((relatedProduct: any) => {
                const relatedPrimaryImage = relatedProduct.product_images?.find((img: any) => img.is_primary) || relatedProduct.product_images?.[0]
                const relatedHasVariants = relatedProduct.has_variants
                const relatedDisplayPrice = relatedHasVariants && relatedProduct.variant_min_price
                  ? Number(relatedProduct.variant_min_price)
                  : Number(relatedProduct.base_price)
                const relatedMrp = relatedProduct.mrp
                  ? Number(relatedProduct.mrp)
                  : (relatedProduct.variant_min_mrp ? Number(relatedProduct.variant_min_mrp) : null)
                const relatedInclPrice = relatedHasVariants && relatedProduct.variant_min_price
                  ? Number(relatedProduct.variant_min_price)
                  : Number(relatedProduct.base_price)
                const relatedMrpDiscount = relatedMrp && relatedMrp > relatedInclPrice
                  ? Math.round(((relatedMrp - relatedInclPrice) / relatedMrp) * 100)
                  : 0
                const relatedStock = relatedHasVariants
                  ? Number(relatedProduct.variant_stock_total ?? 0)
                  : (relatedProduct.stock_status !== 'Out of Stock' ? 1 : 0)

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
