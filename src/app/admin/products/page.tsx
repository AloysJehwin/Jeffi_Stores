import { Suspense } from 'react'
import Link from 'next/link'
import { cookies, headers } from 'next/headers'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { verifyToken } from '@/lib/jwt'
import { hasScope, isPlatformOwner } from '@/lib/scopes'
import { getFilteredProducts, getAllCategories, getAllBrands, getProductBreakdowns } from '@/lib/queries'
import { queryOne, queryMany } from '@/lib/db'
import DeactivateProductButton from '@/components/admin/DeactivateProductButton'
import FeaturedToggleButton from '@/components/admin/FeaturedToggleButton'
import ProductImage from '@/components/admin/ProductImage'
import AdminFilters from '@/components/admin/AdminFilters'
import AdvancedFilterPanel from '@/components/admin/AdvancedFilterPanel'
import Pagination from '@/components/admin/Pagination'
import ResponsiveList from '@/components/admin/ResponsiveList'
import MobileCard from '@/components/admin/MobileCard'
import DownloadAdButton from '@/components/admin/DownloadAdButton'
import CopySku from '@/components/ui/CopySku'
import ProductsTableClient from '@/components/admin/ProductsTableClient'
import SortableHeader from '@/components/admin/SortableHeader'
import { sortOptions } from '@/components/admin/sortOptions'
import DraftRowActions from '@/components/admin/DraftRowActions'

import AdminStatsSkeleton from '@/components/admin/AdminStatsSkeleton'
import AdminTableSkeleton from '@/components/admin/AdminTableSkeleton'
import ProductBreakdownChart from '@/components/admin/ProductBreakdownChart'
import { adminCookieName } from '@/lib/admin-cookie'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

type SP = { [key: string]: string | undefined }

async function ProductsListContent({ resolvedSearchParams, isSuperAdmin, canWrite }: { resolvedSearchParams: SP; isSuperAdmin: boolean; canWrite: boolean }) {
  const host = await getHost()
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))
  const sort = resolvedSearchParams.sort
  const dir = resolvedSearchParams.dir as 'asc' | 'desc' | undefined

  const [{ products, total }, allProductsForStats] = await Promise.all([
    getFilteredProducts({
      category_id: resolvedSearchParams.category_id,
      brand_id: resolvedSearchParams.brand_id,
      is_active: resolvedSearchParams.is_active,
      stock: resolvedSearchParams.stock,
      search: resolvedSearchParams.search,
      is_featured: resolvedSearchParams.is_featured,
      has_variants: resolvedSearchParams.has_variants,
      price_min: resolvedSearchParams.price_min,
      price_max: resolvedSearchParams.price_max,
      gst_percentage: resolvedSearchParams.gst_percentage,
      condition: resolvedSearchParams.condition,
      grade: resolvedSearchParams.grade,
      is_digital: resolvedSearchParams.is_digital,
      is_bundle: resolvedSearchParams.is_bundle,
      is_cod_allowed: resolvedSearchParams.is_cod_allowed,
      shipping_class: resolvedSearchParams.shipping_class,
      is_oversized: resolvedSearchParams.is_oversized,
      country_of_origin: resolvedSearchParams.country_of_origin,
      fragile: resolvedSearchParams.fragile,
      hazardous: resolvedSearchParams.hazardous,
      perishable: resolvedSearchParams.perishable,
      serialized: resolvedSearchParams.serialized,
      page,
      limit: PAGE_SIZE,
      sort,
      dir,
    }),
    getFilteredProducts({}),
  ])

  // Featured count is the global count of featured products (used to enforce the
  // 6-featured limit in FeaturedToggleButton / ProductsTableClient).
  const featuredCount = allProductsForStats.products?.filter((p: any) => p.is_featured).length || 0

  const currentListUrl = (() => {
    const params = new URLSearchParams()
    if (resolvedSearchParams.category_id) params.set('category_id', resolvedSearchParams.category_id)
    if (resolvedSearchParams.brand_id) params.set('brand_id', resolvedSearchParams.brand_id)
    if (resolvedSearchParams.is_active) params.set('is_active', resolvedSearchParams.is_active)
    if (resolvedSearchParams.stock) params.set('stock', resolvedSearchParams.stock)
    if (resolvedSearchParams.search) params.set('search', resolvedSearchParams.search)
    if (sort) params.set('sort', sort)
    if (dir) params.set('dir', dir)
    if (page > 1) params.set('page', String(page))
    const qs = params.toString()
    return `/admin/products${qs ? `?${qs}` : ''}`
  })()

  const buildUrl = (p: number) => {
    const params = new URLSearchParams()
    if (resolvedSearchParams.category_id) params.set('category_id', resolvedSearchParams.category_id)
    if (resolvedSearchParams.brand_id) params.set('brand_id', resolvedSearchParams.brand_id)
    if (resolvedSearchParams.is_active) params.set('is_active', resolvedSearchParams.is_active)
    if (resolvedSearchParams.stock) params.set('stock', resolvedSearchParams.stock)
    if (resolvedSearchParams.search) params.set('search', resolvedSearchParams.search)
    if (sort) params.set('sort', sort)
    if (dir) params.set('dir', dir)
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return ap(`/admin/products${qs ? `?${qs}` : ''}`, host)
  }

  return (
    <ResponsiveList
      items={products || []}
      getKey={(product: any) => product.id}
      minWidth="lg"
      emptyState={
        <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center text-foreground-muted">
          No products found.
        </div>
      }
      pagination={<Pagination page={page} total={total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />}
      renderCard={(product: any) => {
        const stock = product.has_variants ? Number(product.variant_inventory_total) : Number(product.inventory_quantity ?? 0)
        const listedStock = product.has_variants ? Number(product.variant_stock_total) : null
        const stockStatus: string = product.stock_status || 'In Stock'
        const isOut = stock === 0 || stockStatus === 'Out of Stock'
        const isLow = !isOut && (stockStatus === 'Low Stock' || (product.has_variants && stock > 0 && stock <= 3))
        return (
          <MobileCard accent={product.is_featured}>
            <div className="flex items-start gap-3 mb-3">
              <div className="flex-shrink-0 h-12 w-12">
                <ProductImage
                  thumbnailUrl={product.product_images?.find((img: any) => img.is_primary)?.thumbnail_url || product.product_images?.[0]?.thumbnail_url}
                  altText={product.name}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{product.name}</div>
                <div className="text-xs text-foreground-muted inline-flex items-center gap-1">{product.sku}{product.sku && <CopySku sku={product.sku} />}</div>
              </div>
              <span className={`flex-shrink-0 px-2 py-0.5 text-xs font-semibold rounded-full ${
                product.is_active
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                  : 'bg-surface-secondary text-foreground'
              }`}>
                {product.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="flex items-center justify-between mb-3">
              <div>
                {product.has_variants ? (
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-sm font-semibold text-primary-500">
                      From Rs. {Number(product.variant_min_price || 0).toLocaleString('en-IN')}
                    </span>
                    {product.variant_min_mrp && Number(product.variant_min_mrp) > Number(product.variant_min_price || 0) && (
                      <span className="text-xs text-foreground-muted line-through">
                        Rs. {Number(product.variant_min_mrp).toLocaleString('en-IN')}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-sm font-semibold text-primary-500">
                      Rs. {Number(product.base_price || 0).toLocaleString('en-IN')}
                    </span>
                    {product.mrp && Number(product.mrp) > Number(product.base_price || 0) && (
                      <span className="text-xs text-foreground-muted line-through">
                        Rs. {Number(product.mrp).toLocaleString('en-IN')}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-foreground-muted w-10">Inv</span>
                  <span className={`text-sm font-semibold ${isOut ? 'text-red-600 dark:text-red-400' : isLow ? 'text-orange-500 dark:text-orange-400' : 'text-foreground'}`}>{stock}</span>
                </div>
                {listedStock !== null && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-foreground-muted w-10">Listed</span>
                    <span className="text-sm text-foreground">{listedStock}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-foreground-muted w-10">Online</span>
                  <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-full ${
                    isOut ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                    : isLow ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
                    : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                  }`}>{isOut ? 'Out' : isLow ? 'Low' : 'In Stock'}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-foreground-muted">
              <span>{product.categories?.name || 'N/A'} / {product.brands?.name || 'N/A'}</span>
              <div className="flex items-center gap-3">
                <div className="hidden md:inline-flex items-center gap-3">
                  {canWrite && <FeaturedToggleButton productId={product.id} isFeatured={product.is_featured} featuredCount={featuredCount} />}
                  <Link href={ap(`/admin/products/edit/${product.id}?back=${encodeURIComponent(currentListUrl)}`, host)} className="text-accent-500 font-medium">Edit</Link>
                  {canWrite && <DeactivateProductButton productId={product.id} productName={product.name} isActive={product.is_active} />}
                </div>
                <DownloadAdButton productId={product.id} productName={product.name} />
              </div>
            </div>
          </MobileCard>
        )
      }}
      tableHead={
        <>
          <SortableHeader label="Product" column="name" options={sortOptions('text')} currentSort={sort} currentDir={dir} />
          <SortableHeader label="SKU" column="sku" options={sortOptions('text')} currentSort={sort} currentDir={dir} />
          <SortableHeader label="Category" column="category" options={sortOptions('text')} currentSort={sort} currentDir={dir} />
          <SortableHeader label="Brand" column="brand" options={sortOptions('text')} currentSort={sort} currentDir={dir} />
          <SortableHeader label="Price" column="price" options={sortOptions('number')} currentSort={sort} currentDir={dir} />
          <SortableHeader label="Stock" column="stock" options={sortOptions('number')} currentSort={sort} currentDir={dir} />
          <SortableHeader label="Status" column="status" options={sortOptions('text')} currentSort={sort} currentDir={dir} />
          <th className="px-4 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider">Actions</th>
        </>
      }
      tableBody={
        <ProductsTableClient products={products || []} featuredCount={featuredCount} backUrl={currentListUrl} isSuperAdmin={isSuperAdmin} canWrite={canWrite} />
      }
    />
  )
}

// Runs ONLY the aggregate stats query (all products) and renders the stat cards.
async function ProductsStats() {
  const host = await getHost()
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'products:write')
  const [stats, pendingDrafts, createDrafts] = await Promise.all([
    getProductBreakdowns(),
    // Edit-drafts: unpublished CHANGES staged against a live product (product_drafts).
    queryMany<{ product_id: string; name: string; sku: string; updated_at: string }>(
      `SELECT pd.product_id, p.name, p.sku, pd.updated_at
       FROM product_drafts pd
       JOIN products p ON p.id = pd.product_id
       WHERE p.is_draft = false
       ORDER BY pd.updated_at DESC
       LIMIT 10`
    ),
    // Create-drafts: brand-new products never published to the live list (is_draft = true).
    queryMany<{ id: string; name: string; sku: string; created_at: string }>(
      `SELECT id, name, sku, created_at FROM products WHERE is_draft = true ORDER BY created_at DESC LIMIT 20`
    ),
  ])

  const featuredCount = stats.featured
  const activeCount = stats.activeProducts
  const totalCount = stats.totalProducts
  const categoryCount = stats.categories
  const pendingDraftsCount = pendingDrafts.length + createDrafts.length

  return (
    <div className="animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6 lg:h-56">
        {/* Left: Catalog Value + the 4 product stats as tiles */}
        <div className="bg-gradient-to-r from-primary-500 to-accent-500 p-4 sm:p-6 rounded-lg shadow-sm flex flex-col justify-between text-white">
          <div>
            <p className="text-white/80 text-sm">Inventory Stock Value</p>
            <p className="text-3xl sm:text-4xl font-bold mt-1">
              Rs. {stats.inventoryValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:gap-3 mt-4">
            <div className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
              <p className="text-lg sm:text-2xl font-bold leading-none">{totalCount}</p>
              <p className="text-[10px] sm:text-xs text-white/80 mt-1">Total</p>
            </div>
            <div className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
              <p className="text-lg sm:text-2xl font-bold leading-none">{activeCount}</p>
              <p className="text-[10px] sm:text-xs text-white/80 mt-1">Active</p>
            </div>
            <div className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
              <p className="text-lg sm:text-2xl font-bold leading-none">{featuredCount}<span className="text-xs font-normal text-white/70">/6</span></p>
              <p className="text-[10px] sm:text-xs text-white/80 mt-1">Featured</p>
            </div>
            <div className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
              <p className="text-lg sm:text-2xl font-bold leading-none">{categoryCount}</p>
              <p className="text-[10px] sm:text-xs text-white/80 mt-1">Categories</p>
            </div>
          </div>
        </div>
        {/* Right: product breakdown chart */}
        <ProductBreakdownChart byCategory={stats.byCategory} byBrand={stats.byBrand} byStock={stats.byStock} byInventoryValue={stats.byInventoryValue} />
      </div>
      {pendingDraftsCount > 0 && (
        <details className="mb-6 group">
          <summary className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg cursor-pointer list-none flex items-center justify-between px-4 py-2.5 group-open:rounded-b-none">
            <span className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
              <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
              Pending Drafts ({pendingDraftsCount})
            </span>
            <span className="text-xs text-amber-600 dark:text-amber-400">Not yet published to the live list</span>
          </summary>
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-t-0 border-amber-300 dark:border-amber-700 rounded-b-lg overflow-hidden">
            <div className="divide-y divide-amber-100 dark:divide-amber-800/30">
              {/* Create-drafts: brand-new products not yet on the live list. Publish activates them. */}
              {createDrafts.map((d) => (
                canWrite ? (
                  <DraftRowActions
                    key={`new-${d.id}`}
                    entityId={d.id}
                    name={d.name}
                    subtitle={`${d.sku} — new product, not yet published`}
                    updatedAt={d.created_at}
                    editHref={ap(`/admin/products/edit/${d.id}`, host)}
                    publishPath={`/api/admin/products/${d.id}/publish`}
                    publishConfirm={`Publish "${d.name}" to the live product list?`}
                    discardPath={`/api/admin/products/${d.id}/draft`}
                    discardConfirm={`Delete the draft product "${d.name}"? This cannot be undone.`}
                    entityLabel="product"
                  />
                ) : (
                  <div key={`new-${d.id}`} className="px-4 py-2.5 flex items-center gap-2">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300 truncate">{d.name}</p>
                    <p className="text-xs text-amber-600 dark:text-amber-400 font-mono inline-flex items-center gap-1">{d.sku}{d.sku && <CopySku sku={d.sku} />}</p>
                    <span className="text-xs text-amber-600 dark:text-amber-400">new</span>
                  </div>
                )
              ))}
              {pendingDrafts.map((d) => (
                canWrite ? (
                  <DraftRowActions
                    key={d.product_id}
                    entityId={d.product_id}
                    name={d.name}
                    subtitle={d.sku}
                    updatedAt={d.updated_at}
                    editHref={ap(`/admin/products/edit/${d.product_id}`, host)}
                    publishPath={`/api/admin/products/${d.product_id}/publish`}
                    discardPath={`/api/admin/products/${d.product_id}/draft`}
                    entityLabel="product"
                  />
                ) : (
                  <div key={d.product_id} className="px-4 py-2.5 flex items-center gap-2">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300 truncate">{d.name}</p>
                    <p className="text-xs text-amber-600 dark:text-amber-400 font-mono inline-flex items-center gap-1">{d.sku}{d.sku && <CopySku sku={d.sku} />}</p>
                  </div>
                )
              ))}
            </div>
          </div>
        </details>
      )}
    </div>
  )
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const host = await getHost()

  // Read admin role for super_admin-only features (e.g. delete product)
  const cookieStore = await cookies()
  const token = cookieStore.get(await adminCookieName())
  let isSuperAdmin = false
  if (token) {
    try {
      const payload = await verifyToken(token.value) as any
      isSuperAdmin = isPlatformOwner(payload?.role || '')
    } catch {}
  }

  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'products:write')

  const [categories, brands] = await Promise.all([
    getAllCategories(),
    getAllBrands(),
  ])

  const allCats: any[] = categories || []
  const mainCats = allCats.filter((c: any) => !c.parent_category_id)
  const categoryOptions = mainCats.flatMap((cat: any) => {
    const subs = allCats.filter((c: any) => c.parent_category_id === cat.id)
    return [
      { value: cat.id, label: cat.name, group: cat.name },
      ...subs.map((sub: any) => ({ value: sub.id, label: sub.name, group: cat.name, indent: true })),
    ]
  })

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Products</h1>
          <p className="text-foreground-secondary mt-1 text-sm">Manage your product inventory</p>
        </div>
        {canWrite && (
        <div className="hidden md:block">
          <Link
            href={ap('/admin/products/add', host)}
            className="bg-accent-500 hover:bg-accent-600 text-white px-5 py-2.5 rounded-lg font-semibold transition-colors text-center text-sm sm:text-base"
          >
            Add New Product
          </Link>
        </div>
        )}
      </div>

      <Suspense fallback={<AdminStatsSkeleton cards={4} banner={false} />}>
        <ProductsStats />
      </Suspense>

      <AdminFilters
        filters={[
          { name: 'category_id', label: 'Category', options: categoryOptions },
          { name: 'brand_id', label: 'Brand', options: (brands || []).map((b: any) => ({ value: b.id, label: b.name })) },
          { name: 'is_active', label: 'Status', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }] },
          { name: 'stock', label: 'Stock', options: [{ value: 'low', label: 'Low Stock' }, { value: 'out', label: 'Out of Stock' }] },
        ]}
        searchPlaceholder="Search by name or SKU..."
        searchParam="search"
        suggestType="products"
        advancedContent={<AdvancedFilterPanel fields={[
          { name: 'is_featured', label: 'Featured', type: 'boolean', section: 'Product Type' },
          { name: 'has_variants', label: 'Has Variants', type: 'boolean', section: 'Product Type' },
          { name: 'is_digital', label: 'Digital Product', type: 'boolean', section: 'Product Type' },
          { name: 'is_bundle', label: 'Bundle', type: 'boolean', section: 'Product Type' },
          { name: 'condition', label: 'Condition', type: 'toggle', section: 'Product Type', options: [{ value: 'new', label: 'New' }, { value: 'used', label: 'Used' }, { value: 'refurbished', label: 'Refurbished' }] },
          { name: ['price_min', 'price_max'], label: 'Price Range', type: 'range', section: 'Pricing & Tax', unit: '₹' },
          { name: 'gst_percentage', label: 'GST %', type: 'multi-select', section: 'Pricing & Tax', options: [{ value: '0', label: '0%' }, { value: '5', label: '5%' }, { value: '12', label: '12%' }, { value: '18', label: '18%' }, { value: '28', label: '28%' }] },
          { name: 'is_cod_allowed', label: 'COD Allowed', type: 'boolean', section: 'Pricing & Tax' },
          { name: 'shipping_class', label: 'Shipping Class', type: 'multi-select', section: 'Logistics', options: [{ value: 'standard', label: 'Standard' }, { value: 'express', label: 'Express' }, { value: 'freight', label: 'Freight' }] },
          { name: 'is_oversized', label: 'Oversized', type: 'boolean', section: 'Logistics' },
          { name: 'country_of_origin', label: 'Country of Origin', type: 'value-help', section: 'Logistics', placeholder: 'Any country' },
          { name: 'fragile', label: 'Fragile', type: 'boolean', section: 'Product Flags' },
          { name: 'hazardous', label: 'Hazardous', type: 'boolean', section: 'Product Flags' },
          { name: 'perishable', label: 'Perishable', type: 'boolean', section: 'Product Flags' },
          { name: 'serialized', label: 'Serialized', type: 'boolean', section: 'Product Flags' },
          { name: 'grade', label: 'Grade', type: 'value-help', section: 'Specifications', placeholder: 'Any grade' },
          { name: 'compliance_standard', label: 'Compliance Standard', type: 'value-help', section: 'Specifications', placeholder: 'Any standard' },
          { name: 'safety_rating', label: 'Safety Rating', type: 'value-help', section: 'Specifications', placeholder: 'Any rating' },
        ]} mode="content" forceExpanded />}
      />

      <ProductsListSection searchParams={searchParams} isSuperAdmin={isSuperAdmin} canWrite={canWrite} />
    </div>
  )
}

// Resolves searchParams (no DB — near-instant) then keys the table Suspense
// on the query string so filter/pagination changes re-trigger the shimmer
// while the stats + filters above stay mounted.
async function ProductsListSection({ searchParams, isSuperAdmin, canWrite }: { searchParams: Promise<SP>; isSuperAdmin: boolean; canWrite: boolean }) {
  const resolvedSearchParams = await searchParams
  const key = JSON.stringify(resolvedSearchParams)
  return (
    <Suspense key={key} fallback={<AdminTableSkeleton rows={8} cols={8} />}>
      <ProductsListContent resolvedSearchParams={resolvedSearchParams} isSuperAdmin={isSuperAdmin} canWrite={canWrite} />
    </Suspense>
  )
}
