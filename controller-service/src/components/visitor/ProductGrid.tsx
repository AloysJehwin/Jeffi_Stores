'use client'

import { useState, Fragment, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import ProductCard from './ProductCard'
import SortDropdown from './SortDropdown'
import { pickUnitPrice } from '@/lib/catalog/pricing'
import { bp } from '@/lib/shared/business-path'
import { round2 } from '@/lib/catalog/gst'
import { ServerPagedItems } from '@/components/admin/kit/infinite'
import { onImgError, responsiveImg } from '@/lib/shared/image-url'

interface ProductItem {
  is_digital?: boolean
  id: string
  name: string
  slug: string
  base_price: number
  price_ex_gst: number | null
  mrp: number | null
  gst_percentage: number | null
  has_variants: boolean
  variant_min_price: number | null
  variant_min_mrp: number | null
  variant_stock_total: number
  stock_status: string
  discount_pct: number
  is_featured: boolean
  extra_delivery_days: number
  handling_days: number
  fragile?: boolean | null
  hazardous?: boolean | null
  flammable?: boolean | null
  grade?: string | null
  material?: string | null
  finish?: string | null
  compliance_standard?: string | null
  product_images?: { image_url: string; thumbnail_url?: string; is_primary?: boolean }[]
  brands?: { id: string; name: string } | null
  categories?: { id: string; name: string; slug: string } | null
}

interface CategoryBanner {
  id: string
  name: string
  slug: string
  products: {
    id: string
    name: string
    slug: string
    has_variants: boolean
    base_price: number
    price_ex_gst: number | null
    variant_min_price: number | null
    product_images?: { image_url: string; thumbnail_url?: string }[] | null
  }[]
}

interface Props {
  products: ProductItem[]
  gstEnabled: boolean
  categoryBanners?: CategoryBanner[]
  total?: number
  start?: number
  end?: number
  filterSlot?: React.ReactNode
  promoSlot?: React.ReactNode
  portal?: 'storefront' | 'business'
  // When provided, grid-view + non-grouped renders ServerPagedItems so pages 2..N
  // accumulate client-side instead of needing a page-number pager. Each item is a
  // server-rendered node; the page itself has already applied GST / discount maths.
  pagedItems?: { key: string; node: ReactNode }[]
  page?: number
  /** Where sort changes navigate (the listing's own path). */
  basePath?: string
  /** Overrides the product grid's column classes. */
  gridClassName?: string
}

const DEFAULT_GRID = 'grid grid-cols-2 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-6'
const CHIP_H = 'h-11 lg:h-9'

type ViewMode = 'grid' | 'table'

function resolve(product: ProductItem, gstEnabled: boolean) {
  const primaryImage = product.product_images?.find(i => i.is_primary) || product.product_images?.[0]
  const hasVariants = product.has_variants
  const displayPrice =
    hasVariants && product.variant_min_price
      ? Number(product.variant_min_price)
      : pickUnitPrice({ inclusive: product.base_price, exGst: product.price_ex_gst }, gstEnabled)
  const effectiveStock = hasVariants
    ? Number(product.variant_stock_total)
    : product.stock_status !== 'Out of Stock'
      ? 1
      : 0
  const rawMrp = hasVariants
    ? product.variant_min_mrp
      ? Number(product.variant_min_mrp)
      : null
    : product.mrp
      ? Number(product.mrp)
      : null
  const gstRate = Number(product.gst_percentage ?? 0)
  const mrp = !gstEnabled && rawMrp != null && gstRate > 0 ? round2(rawMrp / (1 + gstRate / 100)) : rawMrp
  const mrpDiscount = mrp && mrp > displayPrice ? Math.round(((mrp - displayPrice) / mrp) * 100) : 0
  return { primaryImage, hasVariants, displayPrice: Number(displayPrice), effectiveStock, mrp, mrpDiscount }
}

function StockBadge({ effectiveStock, stockStatus }: { effectiveStock: number; stockStatus: string }) {
  if (effectiveStock === 0 || stockStatus === 'Out of Stock')
    return (
      <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
        Out of Stock
      </span>
    )
  if (stockStatus === 'Low Stock')
    return (
      <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
        Low Stock
      </span>
    )
  return (
    <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
      In Stock
    </span>
  )
}

function CategoryBannerRow({
  banners,
  gstEnabled,
  slot = 0,
  productBase,
  categoryBase,
}: {
  banners: CategoryBanner[]
  gstEnabled: boolean
  slot?: number
  productBase: string
  categoryBase: string
}) {
  const visible = banners.slice(0, 4)
  if (visible.length === 0) return null
  // Each slot shows a different window of products per category (4 per slot)
  const WINDOW = 4
  return (
    <div className="col-span-full my-2">
      <div className="bg-surface-elevated rounded-2xl border border-border-default overflow-hidden p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-accent-500 text-[10px] font-black uppercase tracking-[0.2em] mb-0.5">Shop by Category</p>
            <h3 className="text-lg font-black text-foreground tracking-tight">Top Categories</h3>
          </div>
          <Link
            href={categoryBase}
            className="flex items-center gap-1 text-sm text-accent-500 hover:text-accent-400 font-semibold transition-colors"
          >
            All categories
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {visible.map(cat => (
            <div
              key={cat.id}
              className="bg-surface rounded-xl border border-border-default overflow-hidden hover:border-accent-500/40 hover:shadow-md transition-all duration-200"
            >
              <div className="px-3 pt-3 pb-2 flex items-center justify-between">
                <Link
                  href={`${categoryBase}/${cat.slug}`}
                  className="font-bold text-foreground hover:text-accent-500 transition-colors text-sm leading-tight truncate"
                >
                  {cat.name}
                </Link>
                <Link
                  href={`${categoryBase}/${cat.slug}`}
                  className="text-[10px] text-accent-500 hover:text-accent-400 font-semibold whitespace-nowrap ml-2 shrink-0"
                >
                  See all
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-1 p-2 pt-0">
                {(() => {
                  const start = cat.products.length > WINDOW ? (slot * WINDOW) % (cat.products.length - WINDOW + 1) : 0
                  const sliced = cat.products.slice(start, start + WINDOW)
                  return sliced.length === WINDOW ? sliced : cat.products.slice(0, WINDOW)
                })().map(p => {
                  const img = p.product_images?.[0]
                  const price =
                    p.has_variants && p.variant_min_price
                      ? Number(p.variant_min_price)
                      : pickUnitPrice(
                          { inclusive: Number(p.base_price), exGst: p.price_ex_gst ?? undefined },
                          gstEnabled
                        )
                  return (
                    <Link
                      key={p.id}
                      href={`${productBase}/${p.slug}`}
                      className="group bg-surface-secondary rounded-lg p-2 flex flex-col gap-1 hover:bg-surface transition-colors"
                    >
                      <div className="aspect-square overflow-hidden rounded-md bg-surface flex items-center justify-center">
                        {img ? (
                          <img
                            {...responsiveImg(img.thumbnail_url || img.image_url, '(min-width: 768px) 120px, 25vw')}
                            onError={onImgError}
                            alt={p.name}
                            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full bg-border-default/20 rounded-md" />
                        )}
                      </div>
                      <p className="text-[10px] font-medium text-foreground line-clamp-2 leading-tight">{p.name}</p>
                      <p className="text-[10px] font-bold text-accent-500">₹{price.toLocaleString('en-IN')}</p>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function TableRow({
  product,
  gstEnabled,
  stripe,
  productBase,
}: {
  product: ProductItem
  gstEnabled: boolean
  stripe: boolean
  productBase: string
}) {
  const { displayPrice, effectiveStock, mrp, mrpDiscount } = resolve(product, gstEnabled)
  const img = product.product_images?.find(i => i.is_primary) || product.product_images?.[0]
  const specs = [product.grade, product.material, product.finish].filter(Boolean) as string[]

  return (
    <a
      href={`${productBase}/${product.slug}`}
      className={`flex items-center gap-3 px-4 py-3 hover:bg-accent-50 dark:hover:bg-accent-900/10 transition-colors border-b border-border-default last:border-0 group ${stripe ? 'bg-surface-secondary/30' : ''}`}
    >
      <div className="w-10 h-10 shrink-0 rounded-lg bg-surface-secondary border border-border-default overflow-hidden">
        {img ? (
          <img
            {...responsiveImg(img.thumbnail_url || img.image_url, '40px')}
            onError={onImgError}
            alt={product.name}
            className="w-full h-full object-contain p-1"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-4 h-4 text-foreground-muted/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            </svg>
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate group-hover:text-accent-600 dark:group-hover:text-accent-400 transition-colors">
          {product.name}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {product.brands?.name && <span className="text-[10px] text-foreground-muted">{product.brands.name}</span>}
          {specs.map(s => (
            <span
              key={s}
              className="text-[10px] px-1.5 py-0.5 bg-surface-secondary rounded text-foreground-muted border border-border-default"
            >
              {s}
            </span>
          ))}
        </div>
      </div>
      <div className="shrink-0 text-right min-w-[80px]">
        <span className="text-sm font-bold text-foreground">
          ₹{displayPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        {mrp && mrp > displayPrice && (
          <div className="text-[10px] text-foreground-muted line-through">
            ₹{mrp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        )}
      </div>
      <div className="shrink-0 w-10 text-center">
        {mrpDiscount > 0 && (
          <span className="text-xs font-semibold text-accent-600 dark:text-accent-400">-{mrpDiscount}%</span>
        )}
      </div>
      <div className="shrink-0">
        <StockBadge effectiveStock={effectiveStock} stockStatus={product.stock_status} />
      </div>
      <svg
        className="w-3.5 h-3.5 text-foreground-muted shrink-0 group-hover:text-accent-500 transition-colors"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </a>
  )
}

// How often to inject a category banner row (every N cards). A multiple of both grid widths (2 and 3)
// so the rows between full-width inserts are always complete.
const BANNER_EVERY = 12
// A multiple of both grid widths (2 and 3 columns) and ahead of the first category banner row,
// so the full-width promo never leaves a hole in the row above it.
const PROMO_AFTER = 6

export default function ProductGrid({
  products,
  gstEnabled,
  categoryBanners = [],
  filterSlot,
  promoSlot,
  portal = 'storefront',
  pagedItems,
  page,
  total,
  basePath = '/products',
  gridClassName = DEFAULT_GRID,
}: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const router = useRouter()
  const searchParams = useSearchParams()
  const isBusiness = portal === 'business'
  const productBase = isBusiness ? bp('/business/products') : '/products'
  const categoryBase = isBusiness ? bp('/business/categories') : '/categories'

  // grouped = server sorted by category (sort=category param)
  const grouped = searchParams.get('sort') === 'category'

  function toggleGrouped() {
    const params = new URLSearchParams(searchParams.toString())
    if (grouped) {
      params.delete('sort')
      params.delete('order')
    } else {
      params.set('sort', 'category')
      params.delete('order')
    }
    params.delete('page')
    router.push(`?${params.toString()}`)
  }

  // Group the already-sorted products by category name for section headers
  const groups: { name: string; slug: string; items: ProductItem[] }[] = grouped
    ? (() => {
        const map = new Map<string, { slug: string; items: ProductItem[] }>()
        for (const p of products) {
          const key = p.categories?.name ?? 'Other'
          if (!map.has(key)) map.set(key, { slug: p.categories?.slug ?? '', items: [] })
          map.get(key)!.items.push(p)
        }
        return Array.from(map.entries()).map(([name, { slug, items }]) => ({ name, slug, items }))
      })()
    : [{ name: '', slug: '', items: products }]

  return (
    <div>
      {/* Single control bar: filters · group · view mode · sort. Sticks under the header on phones and tablets. */}
      <div className="sticky top-[calc(4rem+env(safe-area-inset-top,0px))] z-20 -mx-4 px-4 py-2 mb-4 bg-surface border-b border-border-default flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:static lg:mx-0 lg:px-0 lg:py-0 lg:mb-6 lg:bg-transparent lg:border-0 lg:overflow-visible lg:flex-wrap">
        {filterSlot}
        <button
          type="button"
          onClick={toggleGrouped}
          aria-pressed={grouped}
          className={`shrink-0 flex items-center gap-1.5 px-3 ${CHIP_H} rounded-lg text-xs font-medium border transition-colors ${grouped ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400' : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'}`}
        >
          <svg
            viewBox="0 0 16 16"
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinejoin="round"
          >
            <rect x="1" y="1" width="6" height="6" rx="1" />
            <rect x="9" y="1" width="6" height="6" rx="1" />
            <rect x="1" y="9" width="6" height="6" rx="1" />
            <rect x="9" y="9" width="6" height="6" rx="1" />
          </svg>
          <span className="sm:hidden">Group</span>
          <span className="hidden sm:inline">Group by Category</span>
        </button>
        <div className={`shrink-0 flex items-center ${CHIP_H} border border-border-default rounded-lg overflow-hidden`}>
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            title="Grid view"
            aria-label="Grid view"
            aria-pressed={viewMode === 'grid'}
            className={`px-3 lg:px-2.5 h-full transition-colors ${viewMode === 'grid' ? 'bg-accent-50 dark:bg-accent-900/20' : 'hover:bg-surface-secondary'}`}
          >
            <svg
              viewBox="0 0 16 16"
              className={`w-4 h-4 ${viewMode === 'grid' ? 'text-accent-500' : 'text-foreground-muted'}`}
              fill="currentColor"
            >
              <rect x="1" y="1" width="6" height="6" rx="1" />
              <rect x="9" y="1" width="6" height="6" rx="1" />
              <rect x="1" y="9" width="6" height="6" rx="1" />
              <rect x="9" y="9" width="6" height="6" rx="1" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            title="Table view"
            aria-label="Table view"
            aria-pressed={viewMode === 'table'}
            className={`px-3 lg:px-2.5 h-full border-l border-border-default transition-colors ${viewMode === 'table' ? 'bg-accent-50 dark:bg-accent-900/20' : 'hover:bg-surface-secondary'}`}
          >
            <svg
              viewBox="0 0 16 16"
              className={`w-4 h-4 ${viewMode === 'table' ? 'text-accent-500' : 'text-foreground-muted'}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <path d="M1 4h14M1 8h14M1 12h14M5 2v12M11 2v12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="hidden lg:flex ml-auto">
          <SortDropdown basePath={basePath} />
        </div>
      </div>

      {viewMode === 'table' ? (
        <div className="bg-surface-elevated border border-border-default rounded-xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-2.5 bg-surface-secondary border-b border-border-default">
            <div className="w-10 shrink-0" />
            <div className="flex-1 text-[10px] font-semibold text-foreground-muted uppercase tracking-wider">
              Product
            </div>
            <div className="shrink-0 min-w-[80px] text-right text-[10px] font-semibold text-foreground-muted uppercase tracking-wider">
              Price
            </div>
            <div className="shrink-0 w-10 text-center text-[10px] font-semibold text-foreground-muted uppercase tracking-wider">
              Off
            </div>
            <div className="shrink-0 text-[10px] font-semibold text-foreground-muted uppercase tracking-wider">
              Stock
            </div>
            <div className="shrink-0 w-3.5" />
          </div>
          {products.map((product, idx) => (
            <TableRow
              key={product.id}
              product={product}
              gstEnabled={gstEnabled}
              stripe={idx % 2 !== 0}
              productBase={productBase}
            />
          ))}
        </div>
      ) : pagedItems && !grouped && page != null && total != null ? (
        // Infinite-scroll grid: items are pre-rendered server-side; pages 2..N accumulate.
        // Table view and the grouped view fall back to the current-page products[] above.
        <ServerPagedItems
          items={pagedItems}
          page={page}
          total={total}
          noun="products"
          wrap="div"
          wrapClassName={gridClassName}
        />
      ) : (
        <div className="space-y-8">
          {groups.map((group, gi) => (
            <div key={group.name || gi}>
              {/* Category section header */}
              {grouped && group.name && (
                <div className="flex items-center gap-3 mb-4">
                  <Link
                    href={group.slug ? `${categoryBase}/${group.slug}` : productBase}
                    className="text-sm font-bold text-foreground hover:text-accent-500 transition-colors whitespace-nowrap"
                  >
                    {group.name}
                  </Link>
                  <div className="flex-1 h-px bg-border-default" />
                  <span className="text-xs text-foreground-muted whitespace-nowrap">{group.items.length} products</span>
                </div>
              )}
              {/* Grid with category banner rows injected every BANNER_EVERY products */}
              <div className={gridClassName}>
                {group.items.map((product, idx) => {
                  const { primaryImage, hasVariants, displayPrice, effectiveStock, mrp, mrpDiscount } = resolve(
                    product,
                    gstEnabled
                  )
                  const specs = [product.grade, product.material, product.finish, product.compliance_standard].filter(
                    Boolean
                  ) as string[]
                  const showPromo = !grouped && idx === PROMO_AFTER && promoSlot != null
                  const showBanner = !grouped && idx > 0 && idx % BANNER_EVERY === 0 && categoryBanners.length > 0
                  const bannerSlot = Math.floor(idx / BANNER_EVERY)
                  // Rotate which 4 categories we show in each banner row
                  const bannerStart = (bannerSlot * 2) % Math.max(categoryBanners.length, 1)
                  const rotatedBanners = [
                    ...categoryBanners.slice(bannerStart),
                    ...categoryBanners.slice(0, bannerStart),
                  ].slice(0, 4)

                  return (
                    <Fragment key={product.id}>
                      {showPromo && <div className="col-span-full">{promoSlot}</div>}
                      {showBanner && rotatedBanners.length > 0 && (
                        <CategoryBannerRow
                          banners={rotatedBanners}
                          gstEnabled={gstEnabled}
                          slot={bannerSlot}
                          productBase={productBase}
                          categoryBase={categoryBase}
                        />
                      )}
                      <div className="relative group">
                        <ProductCard
                          id={product.id}
                          name={product.name}
                          slug={product.slug}
                          hasVariants={hasVariants}
                          displayPrice={displayPrice}
                          mrp={mrp}
                          mrpDiscount={mrpDiscount}
                          effectiveStock={effectiveStock}
                          isDigital={!!product.is_digital}
                          primaryImage={primaryImage}
                          brandName={product.brands?.name ?? null}
                          categoryName={product.categories?.name ?? null}
                          categoryId={product.categories?.id ?? null}
                          discountPct={Number(product.discount_pct ?? 0)}
                          extraDeliveryDays={Number(product.extra_delivery_days ?? 0)}
                          handlingDays={Number(product.handling_days ?? 2)}
                          fragile={product.fragile}
                          hazardous={product.hazardous}
                          flammable={product.flammable}
                          portal={portal}
                        />
                        {specs.length > 0 && (
                          <div className="absolute bottom-0 left-0 right-0 pointer-events-none overflow-hidden rounded-b-lg">
                            <div className="translate-y-full group-hover:translate-y-0 transition-transform duration-200 bg-foreground dark:bg-surface-elevated px-3 py-2.5">
                              <div className="flex flex-wrap gap-x-3 gap-y-1">
                                {specs.map(s => (
                                  <span key={s} className="text-[11px] text-white dark:text-foreground">
                                    {s}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </Fragment>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
