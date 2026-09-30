import { notFound } from 'next/navigation'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { queryMany, queryOne } from '@/lib/shared/db'
import {
  VARIANT_MIN_PRICE_INCL_GST_SQL,
  VARIANT_MIN_PRICE_EX_GST_SQL,
  VARIANT_MIN_MRP_SQL,
  VARIANT_STOCK_TOTAL_SQL,
} from '@/lib/queries'
import { getFeatureFlags, getStoreIdentity } from '@/lib/catalog/site-controls'
import { pickUnitPrice } from '@/lib/catalog/pricing'
import type { Metadata } from 'next'
import CompareChangeButton from '@/components/visitor/CompareChangeButton'
import CompareAddButton from '@/components/visitor/CompareAddButton'
import CopySku from '@/components/ui/CopySku'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const identity = await getStoreIdentity()
  return { title: `Compare Products | ${identity.name}` }
}

async function getProductsByIds(ids: string[], gstEnabled: boolean) {
  if (!ids.length) return []
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
  const MIN_PRICE_SQL = gstEnabled ? VARIANT_MIN_PRICE_INCL_GST_SQL : VARIANT_MIN_PRICE_EX_GST_SQL
  return queryMany(
    `
    SELECT p.*,
      json_build_object('id', b.id, 'name', b.name) AS brands,
      json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
      COALESCE(
        (SELECT json_agg(pi ORDER BY pi.display_order)
         FROM product_images pi WHERE pi.product_id = p.id),
        '[]'::json
      ) AS product_images,
      ${MIN_PRICE_SQL} AS variant_min_price,
      ${VARIANT_MIN_MRP_SQL} AS variant_min_mrp,
      ${VARIANT_STOCK_TOTAL_SQL} AS variant_stock_total
    FROM products p
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.id IN (${placeholders}) AND p.is_active = true
  `,
    ids
  )
}

async function getDefaultCompareIds(seedId?: string): Promise<string[]> {
  // If a seed product is provided, get same-category products first
  if (seedId) {
    const seed = await queryOne<{ category_id: string }>(
      `SELECT category_id FROM products WHERE id = $1 AND is_active = true`,
      [seedId]
    )
    if (seed?.category_id) {
      const related = await queryMany<{ id: string }>(
        `SELECT p.id FROM products p
         WHERE p.is_active = true AND p.category_id = $1 AND p.id != $2
         ORDER BY p.created_at DESC LIMIT 3`,
        [seed.category_id, seedId]
      )
      const ids = [seedId, ...related.map((r: any) => r.id)]
      if (ids.length >= 2) return ids.slice(0, 4)
    }
  }
  // Fallback: most recently added active products
  const recent = await queryMany<{ id: string }>(
    `SELECT id FROM products WHERE is_active = true ORDER BY created_at DESC LIMIT 4`,
    []
  )
  return recent.map((r: any) => r.id)
}

const SPEC_ROWS: { label: string; key: (p: any) => string | null }[] = [
  { label: 'Brand', key: p => p.brands?.name ?? null },
  { label: 'Category', key: p => p.categories?.name ?? null },
  { label: 'Material', key: p => p.material ?? null },
  { label: 'Finish', key: p => p.finish ?? null },
  { label: 'Variant Type', key: p => p.variant_type ?? null },
  { label: 'Sub-Variant', key: p => p.sub_variant_type ?? null },
  { label: 'Condition', key: p => p.condition ?? null },
  { label: 'Color', key: p => p.color ?? null },
  { label: 'Weight', key: p => (p.weight != null ? `${p.weight} ${p.weight_unit ?? 'kg'}` : null) },
  { label: 'Net Weight', key: p => (p.net_weight_grams != null ? `${p.net_weight_grams} g` : null) },
  { label: 'Volume', key: p => (p.volume_ml != null ? `${p.volume_ml} ml` : null) },
  {
    label: 'Package Dims',
    key: p => {
      const parts = [p.length_cm, p.breadth_cm, p.height_cm].filter((v: any) => v != null)
      if (!parts.length) return null
      return parts.join(' × ') + ` ${p.length_unit ?? 'cm'}`
    },
  },
  { label: 'Package Type', key: p => p.package_type ?? null },
  { label: 'Origin', key: p => p.country_of_origin ?? null },
  {
    label: 'Warranty',
    key: p =>
      p.warranty_months != null
        ? `${p.warranty_months} month${p.warranty_months !== 1 ? 's' : ''}${p.warranty_type ? ` (${p.warranty_type})` : ''}`
        : null,
  },
  { label: 'Compliance', key: p => p.compliance_standard ?? null },
  { label: 'Safety Rating', key: p => p.safety_rating ?? null },
  { label: 'Certifications', key: p => (p.certifications as string[] | null)?.join(', ') || null },
  {
    label: 'Hazards',
    key: p =>
      [p.fragile && 'Fragile', p.hazardous && 'Hazardous', p.flammable && 'Flammable'].filter(Boolean).join(', ') ||
      null,
  },
  { label: 'HSN Code', key: p => p.hsn_code ?? null },
  { label: 'GST', key: p => (p.gst_percentage != null ? `${parseFloat(String(p.gst_percentage))}%` : null) },
  { label: 'MPN', key: p => p.mpn ?? null },
  { label: 'GTIN / EAN', key: p => p.gtin ?? null },
  { label: 'SKU', key: p => p.sku ?? null },
  { label: 'Barcode', key: p => p.barcode ?? null },
  { label: 'ISBN', key: p => p.isbn ?? null },
  { label: 'ASIN', key: p => p.asin ?? null },
]

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; seed?: string }>
}) {
  const { ids: idsParam, seed } = await searchParams
  let ids = (idsParam ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 4)

  if (ids.length < 2) {
    const fallbackIds = await getDefaultCompareIds(seed || undefined)
    if (fallbackIds.length >= 2) {
      redirect(`/compare?ids=${fallbackIds.join(',')}`)
    }
    // No products in DB at all
    return (
      <div className="bg-surface min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-foreground-muted">No products available to compare.</p>
          <Link href="/products" className="text-accent-500 hover:underline text-sm">
            Browse Products
          </Link>
        </div>
      </div>
    )
  }

  const { gstEnabled } = await getFeatureFlags()
  const rawProducts = await getProductsByIds(ids, gstEnabled)
  // Preserve order from URL
  const products = ids.map(id => rawProducts.find((p: any) => p.id === id)).filter(Boolean) as any[]

  if (products.length < 2) notFound()

  const colCount = products.length

  return (
    <div className="bg-surface min-h-screen">
      {/* Breadcrumb */}
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4">
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/" className="text-foreground-muted hover:text-accent-500">
              Home
            </Link>
            <span className="text-foreground-muted">/</span>
            <Link href="/products" className="text-foreground-muted hover:text-accent-500">
              Products
            </Link>
            <span className="text-foreground-muted">/</span>
            <span className="text-foreground font-medium">Compare</span>
          </nav>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 sm:py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-foreground">Product Comparison</h1>
          {products.length < 4 && (
            <CompareAddButton currentIds={ids} categoryId={(products[0] as any)?.category_id ?? null} />
          )}
        </div>

        <div className="bg-surface-elevated rounded-xl border border-border-default shadow-sm overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-border-default">
                {/* Label column */}
                <th className="w-36 sm:w-44 p-4 text-left text-xs font-semibold text-foreground-muted uppercase tracking-wide bg-surface-secondary" />
                {products.map((p: any, i: number) => {
                  const img = p.product_images?.find((x: any) => x.is_primary) || p.product_images?.[0]
                  const price =
                    p.has_variants && p.variant_min_price
                      ? Number(p.variant_min_price)
                      : pickUnitPrice(
                          {
                            inclusive: Number(p.base_price),
                            exGst: p.price_ex_gst != null ? Number(p.price_ex_gst) : undefined,
                          },
                          gstEnabled
                        )
                  const rawMrp = p.mrp ? Number(p.mrp) : p.variant_min_mrp ? Number(p.variant_min_mrp) : null
                  const gstRate = Number(p.gst_percentage ?? 0)
                  const mrp = !gstEnabled && rawMrp != null && gstRate > 0 ? rawMrp / (1 + gstRate / 100) : rawMrp
                  const inStock = p.has_variants
                    ? Number(p.variant_stock_total ?? 0) > 0
                    : p.stock_status !== 'Out of Stock'

                  return (
                    <th key={p.id} className="p-4 text-left align-top">
                      <div className="space-y-2">
                        {/* Image */}
                        <div className="w-full aspect-square max-w-[120px] mx-auto rounded-lg border border-border-default bg-surface-secondary overflow-hidden">
                          {img ? (
                            <img
                              src={img.thumbnail_url || img.image_url}
                              alt={p.name}
                              className="w-full h-full object-contain p-2"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <svg
                                className="w-10 h-10 text-foreground-muted"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={1}
                                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                />
                              </svg>
                            </div>
                          )}
                        </div>
                        {/* Name */}
                        <Link
                          href={`/products/${p.slug}`}
                          className="block text-sm font-semibold text-foreground hover:text-accent-500 leading-snug line-clamp-2"
                        >
                          {p.name}
                        </Link>
                        {/* Price */}
                        <div>
                          <span className="text-base font-bold text-primary-600 dark:text-primary-400">
                            {p.has_variants ? 'From ' : ''}₹
                            {price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                          {mrp && mrp > price && (
                            <span className="ml-1.5 text-xs text-foreground-muted line-through">
                              ₹{mrp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </span>
                          )}
                        </div>
                        {/* Stock */}
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${inStock ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${inStock ? 'bg-green-500' : 'bg-red-500'}`} />
                          {inStock ? 'In Stock' : 'Out of Stock'}
                        </span>
                        {/* Change button (client) */}
                        <CompareChangeButton productId={p.id} currentIds={ids} categoryId={p.category_id} />
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {SPEC_ROWS.map(({ label, key }, rowIdx) => {
                const values = products.map((p: any) => key(p))
                if (values.every(v => v == null)) return null
                const base = values[0]
                const hasDiff = values.some(v => v !== base)

                return (
                  <tr
                    key={label}
                    className={`border-b border-border-default last:border-0 ${rowIdx % 2 === 0 ? 'bg-surface' : 'bg-surface-elevated'}`}
                  >
                    <td className="p-4 text-xs font-semibold text-foreground-muted uppercase tracking-wide bg-surface-secondary align-top whitespace-nowrap">
                      {label}
                    </td>
                    {products.map((p: any, colIdx: number) => {
                      const val = key(p)
                      const isDiff = hasDiff && colIdx > 0 && val !== base
                      return (
                        <td
                          key={p.id}
                          className={`p-4 text-sm text-foreground align-top ${isDiff ? 'bg-amber-50 dark:bg-amber-900/10' : ''}`}
                        >
                          {val ?? <span className="text-foreground-muted">—</span>}
                          {label === 'SKU' && val && <CopySku sku={String(val)} className="ml-1" />}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-6 text-center">
          <Link href="/products" className="text-sm text-accent-500 hover:underline">
            ← Back to Products
          </Link>
        </div>
      </div>
    </div>
  )
}
