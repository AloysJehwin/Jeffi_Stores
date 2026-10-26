import { Suspense } from 'react'
import { canonicalQuery, normalizeQuery, type FilterQuery } from '@jeffi/list-filters'
import { listKey } from '@/lib/admin/list-key'
import { pageUrls } from '@/lib/admin/page-urls'
import { Plus } from 'lucide-react'
import { TabAction } from '@/components/admin/channels/ui'
import { cookies, headers } from 'next/headers'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { verifyToken } from '@/lib/auth/jwt'
import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'
import {
  getFilteredProducts,
  getAllCategories,
  getAllBrands,
  getProductBreakdowns,
  getProductsSummary,
  getFeaturedProductCount,
} from '@/lib/queries'
import { queryOne, queryMany } from '@/lib/shared/db'
import CopySku from '@/components/ui/CopySku'
import ProductsTableClient from './ProductsTableClient'
import DraftRowActions from '@/components/admin/DraftRowActions'
import { Kpi, KpiGrid, ListFilters, PageBody, PageHeader, TableSkeleton } from '@/components/admin/kit'
import ProductBreakdownChart from '@/components/admin/ProductBreakdownChart'
import { adminCookieName } from '@/lib/auth/admin-cookie'
import { getSpecFilterFields } from '@/lib/catalog/product-attribute-filters'
import { PRODUCTS_ENTITY } from '@/lib/filters/entities/products'
import { PRODUCT_SEARCH, productFields } from '@/lib/filters/fields/products'
import { resolveListTab } from '@/lib/overviews/catalog'
import ProductsOverview from './_components/ProductsOverview'
import { TabLinks, TabMemory } from './_components/catalog-overview'

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

  const [{ products, total }, featuredCount] = await Promise.all([
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
    // Store-wide, not the page shown: it enforces the 6-featured limit in FeaturedToggleButton.
    getFeaturedProductCount(),
  ])

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
    <ProductsTableClient
      products={products || []}
      featuredCount={featuredCount}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      pageUrls={pageUrls(buildUrl)}
      backUrl={currentListUrl}
      isSuperAdmin={isSuperAdmin}
      canWrite={canWrite}
    />
  )
}

// Stat cards: counts follow the filters; stock value, featured and categories are store-wide.
async function ProductsStats({ q }: { q: FilterQuery }) {
  const host = await getHost()
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'products:write')
  const [stats, summary, pendingDrafts, createDrafts] = await Promise.all([
    getProductBreakdowns(),
    getProductsSummary(q),
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
  const activeCount = summary.active
  const totalCount = summary.total
  const categoryCount = stats.categories
  const pendingDraftsCount = pendingDrafts.length + createDrafts.length

  return (
    <div className="animate-fade-in space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-3">
          <KpiGrid>
            <Kpi
              label="Inventory stock value"
              value={`Rs. ${stats.inventoryValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              highlight
            />
            <Kpi label="Total products" value={totalCount.toLocaleString('en-IN')} />
            <Kpi label="Active" value={activeCount.toLocaleString('en-IN')} />
            <Kpi label="Featured" value={`${featuredCount}/6`} sub="Shown on the storefront home" />
            <Kpi label="Categories" value={categoryCount.toLocaleString('en-IN')} />
            <Kpi label="Inactive" value={(totalCount - activeCount).toLocaleString('en-IN')} />
          </KpiGrid>
          {pendingDraftsCount > 0 && (
            <details className="group rounded-xl border border-amber-500/40 bg-amber-500/5">
              <summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-2 px-4 h-11">
                <span className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
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
                <span className="text-xs text-foreground-muted">Not yet published to the live list</span>
              </summary>
              <div className="border-t border-amber-500/30 overflow-hidden">
                <div className="max-h-72 overflow-y-auto divide-y divide-amber-500/20">
                  {/* Create-drafts: brand-new products not yet on the live list. Publish activates them. */}
                  {createDrafts.map(d =>
                    canWrite ? (
                      <DraftRowActions
                        key={`new-${d.id}`}
                        entityId={d.id}
                        name={d.name}
                        subtitle={`${d.sku} — new product, not yet published`}
                        updatedAt={d.created_at}
                        editHref={ap(`/admin/products/${d.id}/edit`, host)}
                        publishPath={`/api/admin/products/${d.id}/publish`}
                        publishConfirm={`Publish "${d.name}" to the live product list?`}
                        discardPath={`/api/admin/products/${d.id}/draft`}
                        discardConfirm={`Delete the draft product "${d.name}"? This cannot be undone.`}
                        entityLabel="product"
                      />
                    ) : (
                      <div key={`new-${d.id}`} className="px-4 py-2.5 flex items-center gap-2">
                        <p className="min-w-0 text-sm font-medium text-foreground truncate">{d.name}</p>
                        <p className="text-xs text-foreground-muted font-mono inline-flex items-center gap-1">
                          {d.sku}
                          {d.sku && <CopySku sku={d.sku} />}
                        </p>
                        <span className="text-xs text-foreground-muted">new</span>
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
                        editHref={ap(`/admin/products/${d.product_id}/edit`, host)}
                        publishPath={`/api/admin/products/${d.product_id}/publish`}
                        discardPath={`/api/admin/products/${d.product_id}/draft`}
                        entityLabel="product"
                      />
                    ) : (
                      <div key={d.product_id} className="px-4 py-2.5 flex items-center gap-2">
                        <p className="min-w-0 text-sm font-medium text-foreground truncate">{d.name}</p>
                        <p className="text-xs text-foreground-muted font-mono inline-flex items-center gap-1">
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
        <ProductBreakdownChart
          byCategory={stats.byCategory}
          byBrand={stats.byBrand}
          byStock={stats.byStock}
          byInventoryValue={stats.byInventoryValue}
        />
      </div>
    </div>
  )
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const host = await getHost()
  const sp = await searchParams
  const tab = resolveListTab(sp)

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
    return [{ value: cat.id, label: cat.name }, ...subs.map((sub: any) => ({ value: sub.id, label: `— ${sub.name}` }))]
  })
  const fields = productFields(
    categoryOptions,
    (brands || []).map((b: any) => ({ value: b.id, label: b.name })),
    specFields
  )
  const q = normalizeQuery(PRODUCTS_ENTITY, sp)

  return (
    <PageBody>
      <PageHeader title="Products" description="Manage your product inventory" />

      <TabLinks
        base="/admin/products"
        active={tab}
        query={canonicalQuery(sp, fields)}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'list', label: 'Products' },
        ]}
        actions={
          canWrite && (
            <TabAction
              href={ap('/admin/products/add', host)}
              icon={<Plus className="w-4 h-4" />}
              label="Add New Product"
            />
          )
        }
      />
      <Suspense fallback={null}>
        <TabMemory storageKey="products" tab={tab} explicit={typeof sp.tab === 'string'} />
      </Suspense>

      {tab === 'overview' ? (
        <Suspense fallback={null}>
          <ProductsOverview fields={fields} />
        </Suspense>
      ) : (
        <>
          <Suspense key={JSON.stringify(q)} fallback={<KpiRowSkeleton />}>
            <ProductsStats q={q} />
          </Suspense>

          <ListFilters
            entity="products"
            fields={fields}
            search={PRODUCT_SEARCH}
            noun="Products"
            tab="list"
            exportable
          />

          <ProductsListSection searchParams={searchParams} isSuperAdmin={isSuperAdmin} canWrite={canWrite} />
        </>
      )}
    </PageBody>
  )
}

function KpiRowSkeleton() {
  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 animate-pulse">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-[84px] rounded-xl border border-border-default bg-surface-elevated" />
      ))}
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
  const key = listKey(resolvedSearchParams)
  return (
    <Suspense key={key} fallback={<TableSkeleton rows={8} cols={7} />}>
      <ProductsListContent
        resolvedSearchParams={resolvedSearchParams}
        isSuperAdmin={isSuperAdmin}
        canWrite={canWrite}
      />
    </Suspense>
  )
}
