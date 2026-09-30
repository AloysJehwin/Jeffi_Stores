export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import Link from 'next/link'
import { queryOne, queryMany } from '@/lib/db'
import { mrpDiscountPct, pickUnitPrice } from '@/lib/pricing'
import {
  VARIANT_MIN_PRICE_INCL_GST_SQL,
  VARIANT_MIN_PRICE_EX_GST_SQL,
  VARIANT_MIN_MRP_SQL,
  VARIANT_STOCK_TOTAL_SQL,
} from '@/lib/queries'
import { getFeatureFlags } from '@/lib/site-controls'
import { bp } from '@/lib/business-path'
import CategoryIcon from '@/components/visitor/CategoryIcon'
import Pagination from '@/components/ui/Pagination'
import ProductCard from '@/components/business/ProductCard'

const PAGE_SIZE = 24

async function getCategoryBySlug(slug: string) {
  return queryOne('SELECT * FROM categories WHERE slug = $1 AND is_active = true LIMIT 1', [slug])
}

async function getSubcategories(parentId: string) {
  return queryMany(
    'SELECT * FROM categories WHERE parent_category_id = $1 AND is_active = true ORDER BY display_order ASC',
    [parentId]
  )
}

async function getCategoryProducts(categoryId: string, subcategoryIds: string[], page: number) {
  const allCategoryIds = [categoryId, ...subcategoryIds]
  const offset = (page - 1) * PAGE_SIZE

  const { gstEnabled } = await getFeatureFlags()
  const MIN_PRICE_SQL = gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM products WHERE category_id = ANY($1) AND is_active = true`,
    [allCategoryIds]
  )
  const total = Number(countRow?.total ?? 0)

  const products = await queryMany(
    `
    SELECT p.*,
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
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.category_id = ANY($1) AND p.is_active = true
    ORDER BY p.created_at DESC
    LIMIT $2 OFFSET $3
  `,
    [allCategoryIds, PAGE_SIZE, offset]
  )

  return { products, total, totalPages: Math.ceil(total / PAGE_SIZE), gstEnabled }
}

export default async function BusinessCategoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { slug } = await params
  const resolvedSearchParams = await searchParams
  const category = await getCategoryBySlug(slug)

  if (!category) {
    notFound()
  }

  const hdrs = await headers()
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? ''

  const pageParam = typeof resolvedSearchParams.page === 'string' ? resolvedSearchParams.page : '1'
  const page = Math.max(1, parseInt(pageParam, 10) || 1)

  const subcategories = await getSubcategories(category.id)
  const { products, total, totalPages, gstEnabled } = await getCategoryProducts(
    category.id,
    subcategories.map(sub => sub.id),
    page
  )

  return (
    <div className="bg-surface min-h-screen">
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4">
          <nav className="flex items-center gap-2 text-sm mb-4">
            <Link href={bp('/business', host)} className="text-foreground-muted hover:text-accent-500">
              Home
            </Link>
            <span className="text-foreground-muted">/</span>
            <Link href={bp('/business/categories', host)} className="text-foreground-muted hover:text-accent-500">
              Categories
            </Link>
            <span className="text-foreground-muted">/</span>
            <span className="text-foreground font-medium">{category.name}</span>
          </nav>

          <h1 className="text-3xl md:text-4xl font-bold text-secondary-500 dark:text-foreground mb-2">
            {category.name}
          </h1>
          {category.description && <p className="text-foreground-secondary">{category.description}</p>}
        </div>
      </div>

      <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
        {subcategories.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-bold text-foreground mb-4">Subcategories</h2>
            <div className="grid grid-cols-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 sm:gap-3">
              {subcategories.map(subcategory => (
                <Link
                  key={subcategory.id}
                  href={bp('/business/categories/' + subcategory.slug, host)}
                  className="bg-surface-elevated rounded-xl shadow-sm border border-border-default p-2 sm:p-3 hover:shadow-md hover:border-accent-500 transition-all group h-full"
                >
                  <div className="flex flex-col items-center text-center gap-1.5">
                    <div className="w-9 h-9 sm:w-11 sm:h-11 bg-accent-100 rounded-lg flex items-center justify-center group-hover:bg-accent-200 transition-colors shrink-0">
                      <CategoryIcon
                        iconName={subcategory.icon_name}
                        categoryName={subcategory.name}
                        className="w-5 h-5 sm:w-6 sm:h-6 text-accent-600 group-hover:text-accent-700"
                      />
                    </div>
                    <h3 className="text-[11px] sm:text-xs font-semibold text-foreground group-hover:text-accent-600 dark:group-hover:text-accent-400 transition-colors leading-tight line-clamp-2 flex items-center justify-center min-h-[2rem]">
                      {subcategory.name}
                    </h3>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-foreground">Products ({total})</h2>
            {totalPages > 1 && (
              <p className="text-sm text-foreground-muted">
                Page {page} of {totalPages}
              </p>
            )}
          </div>

          {products.length > 0 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
                {products.map(product => {
                  const primaryImage =
                    product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
                  const hasVariants = product.has_variants
                  const displayPrice =
                    hasVariants && product.variant_min_price
                      ? Number(product.variant_min_price)
                      : pickUnitPrice(
                          {
                            inclusive: Number(product.base_price),
                            exGst: product.price_ex_gst != null ? Number(product.price_ex_gst) : undefined,
                          },
                          gstEnabled
                        )
                  const effectiveStock = hasVariants
                    ? Number(product.variant_stock_total)
                    : product.stock_status !== 'Out of Stock'
                      ? 1
                      : 0
                  const rawMrp = product.mrp
                    ? Number(product.mrp)
                    : product.variant_min_mrp
                      ? Number(product.variant_min_mrp)
                      : null
                  const gstRate = Number(product.gst_percentage ?? 0)
                  const mrp = !gstEnabled && rawMrp != null && gstRate > 0 ? rawMrp / (1 + gstRate / 100) : rawMrp
                  const mrpDiscount = mrpDiscountPct(mrp, displayPrice)

                  return (
                    <ProductCard
                      key={product.id}
                      id={product.id}
                      name={product.name}
                      slug={product.slug}
                      hasVariants={hasVariants}
                      displayPrice={Number(displayPrice)}
                      mrp={mrp}
                      mrpDiscount={mrpDiscount}
                      effectiveStock={effectiveStock}
                      primaryImage={primaryImage || null}
                      brandName={product.brands?.name || null}
                      categoryName={product.categories?.name || null}
                      categoryId={product.categories?.id || null}
                      extraDeliveryDays={Number(product.extra_delivery_days ?? 0)}
                      handlingDays={Number(product.handling_days ?? 2)}
                    />
                  )
                })}
              </div>
              <Pagination
                page={page}
                totalPages={totalPages}
                buildHref={p =>
                  p > 1 ? bp(`/business/categories/${slug}?page=${p}`, host) : bp(`/business/categories/${slug}`, host)
                }
              />
            </>
          ) : (
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-12 text-center">
              <svg
                className="mx-auto h-24 w-24 text-foreground-muted mb-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                />
              </svg>
              <h3 className="text-xl font-semibold text-foreground mb-2">No Products Yet</h3>
              <p className="text-foreground-secondary mb-6">
                We&apos;re working on adding products to this category. Check back soon!
              </p>
              <Link
                href={bp('/business/products', host)}
                className="inline-block bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
              >
                Browse All Products
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
