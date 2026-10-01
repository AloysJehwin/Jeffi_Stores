import { Suspense } from 'react'
import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { queryMany, queryCount } from '@/lib/shared/db'
import AdminFilters from '@/components/admin/AdminFilters'
import Pagination from '@/components/admin/Pagination'
import BrandTableRow from '@/components/admin/BrandTableRow'
import AdminStatsSkeleton from '@/components/admin/AdminStatsSkeleton'
import AdminTableSkeleton from '@/components/admin/AdminTableSkeleton'
import BrochureButton from '@/components/admin/BrochureButton'
import DraftRowActions from '@/components/admin/DraftRowActions'
import BrandsMobileList from './_components/BrandsMobileList'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

async function getFilteredBrands(filters: { is_active?: string; search?: string; page?: number; limit?: number }) {
  const conditions: string[] = []
  const params: any[] = []
  let i = 1

  // Never-published drafts live only in the Drafts section, never the live list.
  conditions.push(`is_draft = false`)

  if (filters.is_active === 'true' || filters.is_active === 'false') {
    conditions.push(`is_active = $${i++}`)
    params.push(filters.is_active === 'true')
  }
  if (filters.search) {
    conditions.push(`name ILIKE $${i}`)
    params.push(`%${filters.search}%`)
    i++
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filters.limit || 25
  const offset = ((filters.page || 1) - 1) * limit

  const [brands, total] = await Promise.all([
    queryMany(`SELECT * FROM brands ${where} ORDER BY name ASC LIMIT $${i} OFFSET $${i + 1}`, [
      ...params,
      limit,
      offset,
    ]),
    queryCount(`SELECT COUNT(*) FROM brands ${where}`, params),
  ])

  return { brands, total }
}

async function AddBrandButton() {
  const host = await getHost()
  return (
    <div className="hidden md:block">
      <Link
        href={ap('/admin/brands/add', host)}
        className="inline-flex items-center justify-center h-11 bg-accent-500 hover:bg-accent-600 text-white px-5 rounded-lg font-semibold transition-colors text-center text-sm sm:text-base"
      >
        Add New Brand
      </Link>
    </div>
  )
}

async function BrandsStats() {
  const host = await getHost()
  const [allStats, pendingDrafts, createDrafts] = await Promise.all([
    getFilteredBrands({}),
    // Edit-drafts: unpublished CHANGES staged against a live brand (brand_drafts).
    queryMany<{ brand_id: string; name: string; updated_at: string }>(
      `SELECT bd.brand_id, b.name, bd.updated_at
       FROM brand_drafts bd
       JOIN brands b ON b.id = bd.brand_id
       ORDER BY bd.updated_at DESC
       LIMIT 20`
    ),
    // Create-drafts: brand-new brands never published to the live list (is_draft = true).
    queryMany<{ id: string; name: string; created_at: string }>(
      `SELECT id, name, created_at FROM brands WHERE is_draft = true ORDER BY created_at DESC LIMIT 20`
    ),
  ])

  const totalBrands = allStats.total
  const activeBrands = allStats.brands?.filter((b: any) => b.is_active).length || 0
  const inactiveBrands = totalBrands - activeBrands
  const pendingDraftsCount = pendingDrafts.length + createDrafts.length

  return (
    <div className="animate-fade-in">
      <div className="grid grid-cols-3 gap-4 sm:gap-6 mb-6">
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Total Brands</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground mt-2">{totalBrands}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Active</p>
          <p className="text-2xl sm:text-3xl font-bold text-green-600 mt-2">{activeBrands}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Inactive</p>
          <p className="text-2xl sm:text-3xl font-bold text-orange-600 mt-2">{inactiveBrands}</p>
        </div>
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
              {/* Create-drafts: brand-new brands not yet on the live list. Publish activates them. */}
              {createDrafts.map(d => (
                <DraftRowActions
                  key={`new-${d.id}`}
                  entityId={d.id}
                  name={d.name}
                  subtitle="New brand — not yet published"
                  updatedAt={d.created_at}
                  editHref={ap(`/admin/brands/edit/${d.id}`, host)}
                  publishPath={`/api/admin/brands/${d.id}`}
                  publishMethod="PATCH"
                  publishBody={{ is_draft: false, is_active: true }}
                  publishConfirm={`Publish "${d.name}" to the live brand list?`}
                  discardPath={`/api/brands/${d.id}`}
                  discardConfirm={`Delete the draft brand "${d.name}"? This cannot be undone.`}
                  entityLabel="brand"
                />
              ))}
              {pendingDrafts.map(d => (
                <DraftRowActions
                  key={d.brand_id}
                  entityId={d.brand_id}
                  name={d.name}
                  updatedAt={d.updated_at}
                  editHref={ap(`/admin/brands/edit/${d.brand_id}`, host)}
                  publishPath={`/api/admin/brands/${d.brand_id}/publish`}
                  discardPath={`/api/admin/brands/${d.brand_id}/draft`}
                  entityLabel="brand"
                />
              ))}
            </div>
          </div>
        </details>
      )}
    </div>
  )
}

async function BrandsListContent({
  resolvedSearchParams,
}: {
  resolvedSearchParams: { [key: string]: string | undefined }
}) {
  const host = await getHost()
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))

  const { brands, total } = await getFilteredBrands({
    is_active: resolvedSearchParams.is_active,
    search: resolvedSearchParams.search,
    page,
    limit: PAGE_SIZE,
  })

  const buildUrl = (p: number) => {
    const params = new URLSearchParams()
    if (resolvedSearchParams.is_active) params.set('is_active', resolvedSearchParams.is_active)
    if (resolvedSearchParams.search) params.set('search', resolvedSearchParams.search)
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return ap(`/admin/brands${qs ? `?${qs}` : ''}`, host)
  }

  const currentListUrl = (() => {
    const params = new URLSearchParams()
    if (resolvedSearchParams.is_active) params.set('is_active', resolvedSearchParams.is_active)
    if (resolvedSearchParams.search) params.set('search', resolvedSearchParams.search)
    if (page > 1) params.set('page', String(page))
    const qs = params.toString()
    return `/admin/brands${qs ? `?${qs}` : ''}`
  })()

  return (
    <>
      <div className="md:hidden space-y-3">
        {brands && brands.length > 0 ? (
          <BrandsMobileList brands={brands} backUrl={currentListUrl} />
        ) : (
          <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center text-foreground-muted">
            No brands found. Add your first brand to get started.
          </div>
        )}
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />
      </div>

      <div className="hidden md:block bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border-default">
            <thead className="bg-surface-secondary">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  Brand
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  Slug
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  Website
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {brands && brands.length > 0 ? (
                brands.map((brand: any) => <BrandTableRow key={brand.id} brand={brand} backUrl={currentListUrl} />)
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-foreground-muted">
                    No brands found. Add your first brand to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="hidden md:block px-6 py-3 border border-border-default border-t-0 rounded-b-lg bg-surface-elevated">
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />
      </div>
    </>
  )
}

export default function BrandsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | undefined }> }) {
  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Brands</h1>
          <p className="text-foreground-secondary mt-1 text-sm">Manage product brands</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <BrochureButton mode="brand" />
          <Suspense
            fallback={
              <span className="hidden md:inline-flex items-center justify-center h-11 bg-accent-500 text-white px-5 rounded-lg font-semibold text-center text-sm sm:text-base opacity-80">
                Add New Brand
              </span>
            }
          >
            <AddBrandButton />
          </Suspense>
        </div>
      </div>

      <Suspense fallback={<AdminStatsSkeleton cards={3} gridClass="grid-cols-3" />}>
        <BrandsStats />
      </Suspense>

      <AdminFilters
        filters={[
          {
            name: 'is_active',
            label: 'Status',
            options: [
              { value: 'true', label: 'Active' },
              { value: 'false', label: 'Inactive' },
            ],
          },
        ]}
        searchPlaceholder="Search by name..."
        suggestType="brands"
        searchParam="search"
      />

      <BrandsListSection searchParams={searchParams} />
    </div>
  )
}

// Resolves searchParams (no DB — near-instant) then keys the table Suspense
// on the query string so filter/pagination changes re-trigger the shimmer
// while the stats + filters above stay mounted.
async function BrandsListSection({ searchParams }: { searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const resolvedSearchParams = await searchParams
  const key = JSON.stringify(resolvedSearchParams)
  return (
    <Suspense key={key} fallback={<AdminTableSkeleton rows={8} cols={5} />}>
      <BrandsListContent resolvedSearchParams={resolvedSearchParams} />
    </Suspense>
  )
}
