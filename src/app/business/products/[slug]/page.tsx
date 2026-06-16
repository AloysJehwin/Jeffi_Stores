import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import Link from 'next/link'
import { cache } from 'react'
import type { Metadata } from 'next'
import { queryOne, queryMany } from '@/lib/db'
import { VARIANT_MIN_PRICE_SQL, VARIANT_MIN_MRP_SQL, VARIANT_STOCK_TOTAL_SQL } from '@/lib/queries'
import { mrpDiscountPct } from '@/lib/pricing'
import { bp } from '@/lib/business-path'
import ProductDetailClient from '@/components/business/ProductDetailClient'
import ProductReviews from '@/components/visitor/ProductReviews'
import ProductCard from '@/components/business/ProductCard'
import TrackRecentlyViewed from '@/components/visitor/TrackRecentlyViewed'
import RecentlyViewed from '@/components/visitor/RecentlyViewed'

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
             'wholeprice_ex_gst', pv.wholeprice_ex_gst, 'stock_quantity', pv.stock_quantity,
             'pricing_type', pv.pricing_type, 'unit', pv.unit, 'numeric_value', pv.numeric_value,
             'sub_variant_type', pv.sub_variant_type,
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
      COALESCE(
        (SELECT json_agg(
           json_build_object(
             'id', pu.id, 'variant_id', pu.variant_id, 'unit', pu.unit,
             'factor', pu.factor, 'is_base', pu.is_base, 'is_sell_default', pu.is_sell_default,
             'is_purchase_default', pu.is_purchase_default, 'display_label', pu.display_label,
             'dimension', pu.dimension
           ) ORDER BY pu.is_sell_default DESC, pu.is_base DESC
         )
         FROM product_units pu WHERE pu.product_id = p.id
        ),
        '[]'::json
      ) AS product_units,
      ${VARIANT_MIN_PRICE_SQL} AS variant_min_price,
      ${VARIANT_MIN_MRP_SQL} AS variant_min_mrp,
      ${VARIANT_STOCK_TOTAL_SQL} AS variant_stock_total
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
  params: { slug: string }
}): Promise<Metadata> {
  const product = await getProductBySlug(params.slug)
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
          availability: v.stock_quantity > 0
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
          availability: product.stock_quantity > 0
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
    ${VARIANT_MIN_PRICE_SQL} AS variant_min_price,
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
  params: { slug: string }
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  const product = await getProductBySlug(params.slug)

  if (!product) {
    notFound()
  }

  const host = (await headers()).get('host') ?? ''

  const relatedProducts = await getRelatedProducts(product.id, product.category_id, product.name)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistoress.com'
  const jsonLd = buildProductJsonLd(product, baseUrl)
  const skuParam = typeof searchParams.sku === 'string' ? searchParams.sku : undefined

  const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
  const hasVariants = product.has_variants && product.product_variants?.length > 0
  const displayPrice = hasVariants && product.variant_min_price
    ? product.variant_min_price
    : (product.base_price || 0)
  const mrp = product.mrp
    ? Number(product.mrp)
    : (product.variant_min_mrp ? Number(product.variant_min_mrp) : null)
  const mrpDiscount = mrpDiscountPct(mrp, Number(displayPrice))

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
            : Number(product.stock_quantity ?? 0) > 0
        }
        image={primaryImage?.thumbnail_url || primaryImage?.image_url || null}
      />
      {/* Breadcrumb */}
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4">
          <nav className="flex items-center gap-2 text-sm">
            <Link href={bp('/business', host)} className="text-foreground-muted hover:text-accent-500 whitespace-nowrap">
              Home
            </Link>
            <span className="text-foreground-muted">/</span>
            <Link href={bp('/business/products', host)} className="text-foreground-muted hover:text-accent-500 whitespace-nowrap">
              Products
            </Link>
            {product.categories && (
              <>
                <span className="text-foreground-muted">/</span>
                <Link
                  href={bp('/business/categories/' + product.categories.slug, host)}
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
        <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden mb-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-8 p-4 sm:p-6 lg:p-8 lg:items-start">
            <ProductDetailClient product={product} initialSkuParam={skuParam} />
          </div>

          {/* Description */}
          {product.description && (
            <div className="border-t border-border-default p-4 sm:p-6 lg:p-8">
              <h2 className="text-2xl font-bold text-foreground mb-4">Product Description</h2>
              <p className="text-foreground-secondary leading-relaxed whitespace-pre-line">
                {product.description}
              </p>
            </div>
          )}
        </div>

        {/* Product Reviews */}
        <ProductReviews productId={product.id} productName={product.name} />

        {/* Recently Viewed */}
        <RecentlyViewed excludeId={product.id} basePath={bp('/business/products', host)} />

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
                  : Number(relatedProduct.stock_quantity ?? 0)

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
                    categoryId={relatedProduct.categories?.id || null}
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
