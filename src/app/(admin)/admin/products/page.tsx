import { Suspense } from 'react'
import Link from 'next/link'
import { cookies, headers } from 'next/headers'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { verifyToken } from '@/lib/auth/jwt'
import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'
import { getFilteredProducts, getAllCategories, getAllBrands, getProductBreakdowns } from '@/lib/queries'
import { queryOne, queryMany } from '@/lib/shared/db'
import AdminFilters from '@/components/admin/AdminFilters'
import AdvancedFilterPanel from '@/components/admin/AdvancedFilterPanel'
import Pagination from '@/components/admin/Pagination'
import ResponsiveList from '@/components/admin/ResponsiveList'
import CopySku from '@/components/ui/CopySku'
import ProductsTableClient from './ProductsTableClient'
import ProductsMobileList from './_components/ProductsMobileList'
import SortableHeader from '@/components/admin/SortableHeader'
import { sortOptions } from '@/components/admin/sortOptions'
import DraftRowActions from '@/components/admin/DraftRowActions'

import AdminStatsSkeleton from '@/components/admin/AdminStatsSkeleton'
import AdminTableSkeleton from '@/components/admin/AdminTableSkeleton'
import ProductBreakdownChart from '@/components/admin/ProductBreakdownChart'
import { adminCookieName } from '@/lib/auth/admin-cookie'
import { ADMIN_PRODUCT_FILTER_FIELDS } from '@/lib/catalog/product-attribute-filters-shared'
import { getSpecFilterFields } from '@/lib/catalog/product-attribute-filters'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

type SP = { [key: string]: string | undefined }

async function ProductsListContent({
  resolvedSearchParams,
  isSuperAdmin,
  canWrite,
}: {
  resolvedSearchParams: SP
  isSuperAdmin: boolean
  canWrite: boolean
}) {
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
      attributes: resolvedSearchParams,
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

  const listParams = (p: number) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(resolvedSearchParams)) {
      if (k !== 'page' && k !== '_adv' && typeof v === 'string' && v) params.set(k, v)
    }
    if (p > 1) params.set('page', String(p))
    return params.toString()
  }
  const currentListUrl = `/admin/products${listParams(page) ? `?${listParams(page)}` : ''}`
  const buildUrl = (p: number) => ap(`/admin/products${listParams(p) ? `?${listParams(p)}` : ''}`, host)

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
      mobileList={
        <ProductsMobileList
          products={products || []}
          featuredCount={featuredCount}
          backUrl={currentListUrl}
          isSuperAdmin={isSuperAdmin}
          canWrite={canWrite}
        />
      }
      renderCard={() => null}
      tableHead={
        <>
          <SortableHeader
            label="Product"
            column="name"
            options={sortOptions('text')}
            currentSort={sort}
            currentDir={dir}
          />
          <SortableHeader label="SKU" column="sku" options={sortOptions('text')} currentSort={sort} currentDir={dir} />
          <SortableHeader
            label="Category"
            column="category"
            options={sortOptions('text')}
            currentSort={sort}
            currentDir={dir}
          />
          <SortableHeader
            label="Brand"
            column="brand"
            options={sortOptions('text')}
            currentSort={sort}
            currentDir={dir}
          />
          <SortableHeader
            label="Price"
            column="price"
            options={sortOptions('number')}
            currentSort={sort}
            currentDir={dir}
          />
          <SortableHeader
            label="Stock"
            column="stock"
            options={sortOptions('number')}
            currentSort={sort}
            currentDir={dir}
          />
          <SortableHeader
            label="Status"
            column="status"
            options={sortOptions('text')}
            currentSort={sort}
            currentDir={dir}
          />
          <th className="px-4 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider">
            Actions
          </th>
        </>
      }
      tableBody={
        <ProductsTableClient
          products={products || []}
          featuredCount={featuredCount}
          backUrl={currentListUrl}
          isSuperAdmin={isSuperAdmin}
          canWrite={canWrite}
        />
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
              <p className="text-lg sm:text-2xl font-bold leading-none">
                {featuredCount}
                <span className="text-xs font-normal text-white/70">/6</span>
              </p>
              <p className="text-[10px] sm:text-xs text-white/80 mt-1">Featured</p>
            </div>
            <div className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
              <p className="text-lg sm:text-2xl font-bold leading-none">{categoryCount}</p>
              <p className="text-[10px] sm:text-xs text-white/80 mt-1">Categories</p>
            </div>
          </div>
        </div>
        {/* Right: product breakdown chart */}
        <ProductBreakdownChart
          byCategory={stats.byCategory}
          byBrand={stats.byBrand}
          byStock={stats.byStock}
          byInventoryValue={stats.byInventoryValue}
        />
      </div>
      {pendingDraftsCount > 0 && (
        <details className="mb-6 group">
          <summary className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg cursor-pointer list-none flex items-center justify-between px-4 py-2.5 group-open:rounded-b-none">
            <span className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
              <svg
                className="w-4 h-4 transition-transform group-open:rotate-90"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Pending Drafts ({pendingDraftsCount})
            </span>
            <span className="text-xs text-amber-600 dark:text-amber-400">Not yet published to the live list</span>
          </summary>
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-t-0 border-amber-300 dark:border-amber-700 rounded-b-lg overflow-hidden">
            <div className="divide-y divide-amber-100 dark:divide-amber-800/30">
              {/* Create-drafts: brand-new products not yet on the live list. Publish activates them. */}
              {createDrafts.map(d =>
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
                    <p className="text-xs text-amber-600 dark:text-amber-400 font-mono inline-flex items-center gap-1">
                      {d.sku}
                      {d.sku && <CopySku sku={d.sku} />}
                    </p>
                    <span className="text-xs text-amber-600 dark:text-amber-400">new</span>
                  </div>
                )
              )}
              {pendingDrafts.map(d =>
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
                    <p className="text-xs text-amber-600 dark:text-amber-400 font-mono inline-flex items-center gap-1">
                      {d.sku}
                      {d.sku && <CopySku sku={d.sku} />}
                    </p>
                  </div>
                )
              )}
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
      const payload = (await verifyToken(token.value)) as any
      isSuperAdmin = isPlatformOwner(payload?.role || '')
    } catch {}
  }

  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'products:write')

  const [categories, brands, specFields] = await Promise.all([
    getAllCategories(),
    getAllBrands(),
    getSpecFilterFields(),
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
          {
            name: 'brand_id',
            label: 'Brand',
            options: (brands || []).map((b: any) => ({ value: b.id, label: b.name })),
          },
          {
            name: 'is_active',
            label: 'Status',
            options: [
              { value: 'true', label: 'Active' },
              { value: 'false', label: 'Inactive' },
            ],
          },
          {
            name: 'stock',
            label: 'Stock',
            options: [
              { value: 'low', label: 'Low Stock' },
              { value: 'out', label: 'Out of Stock' },
            ],
          },
        ]}
        searchPlaceholder="Search by name or SKU..."
        searchParam="search"
        suggestType="products"
        advancedContent={
          <AdvancedFilterPanel fields={[...ADMIN_PRODUCT_FILTER_FIELDS, ...specFields]} mode="content" forceExpanded />
        }
      />

      <ProductsListSection searchParams={searchParams} isSuperAdmin={isSuperAdmin} canWrite={canWrite} />
    </div>
  )
}

// Resolves searchParams (no DB — near-instant) then keys the table Suspense
// on the query string so filter/pagination changes re-trigger the shimmer
// while the stats + filters above stay mounted.
async function ProductsListSection({
  searchParams,
  isSuperAdmin,
  canWrite,
}: {
  searchParams: Promise<SP>
  isSuperAdmin: boolean
  canWrite: boolean
}) {
  const resolvedSearchParams = await searchParams
  const key = JSON.stringify(resolvedSearchParams)
  return (
    <Suspense key={key} fallback={<AdminTableSkeleton rows={8} cols={8} />}>
      <ProductsListContent
        resolvedSearchParams={resolvedSearchParams}
        isSuperAdmin={isSuperAdmin}
        canWrite={canWrite}
      />
    </Suspense>
  )
}
