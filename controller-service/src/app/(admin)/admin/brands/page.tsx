import { Suspense } from 'react'
import { listKey } from '@/lib/admin/list-key'
import { Plus } from 'lucide-react'
import { TabAction } from '@/components/admin/channels/ui'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { queryMany, queryCount } from '@/lib/shared/db'
import { DataToolbar, Kpi, KpiGrid, PageBody, PageHeader, TableSkeleton } from '@/components/admin/kit'
import BrochureButton from '@/components/admin/BrochureButton'
import DraftRowActions from '@/components/admin/DraftRowActions'
import BrandsTable from './_components/BrandsTable'
import GroupOverview from '../categories/_components/GroupOverview'
import { TabLinks, TabMemory } from '../products/_components/catalog-overview'
import { resolveListTab } from '@/lib/overviews/catalog'

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
  return <TabAction href={ap('/admin/brands/add', host)} icon={<Plus className="w-4 h-4" />} label="Add New Brand" />
}

async function BrandsStats() {
  const host = await getHost()
  const [allStats, pendingDrafts, createDrafts] = await Promise.all([
    getFilteredBrands({}),
    // Edit-drafts: unpublished CHANGES staged against a live brand (brand_drafts).
    queryMany<{ brand_id: string; name: string; updated_at: string }>(
      `SELECT bd.brand_id, b.name, bd.updated_at
       FROM brand_drafts bd
       JOIN brands b ON b.id = bd.brand_id AND b.is_draft = false
       ORDER BY bd.updated_at DESC
       LIMIT 20`
    ),
    // Create-drafts: brand-new brands never published to the live list (is_draft = true).
    // A new brand edited before its first publish also has a brand_drafts row — list it once.
    queryMany<{ id: string; name: string; created_at: string; staged: boolean }>(
      `SELECT b.id, COALESCE(bd.fields->>'name', b.name) AS name, b.created_at, bd.brand_id IS NOT NULL AS staged
       FROM brands b LEFT JOIN brand_drafts bd ON bd.brand_id = b.id
       WHERE b.is_draft = true ORDER BY b.created_at DESC LIMIT 20`
    ),
  ])

  const totalBrands = allStats.total
  const activeBrands = allStats.brands?.filter((b: any) => b.is_active).length || 0
  const inactiveBrands = totalBrands - activeBrands
  const pendingDraftsCount = pendingDrafts.length + createDrafts.length

  return (
    <div className="animate-fade-in space-y-4">
      <KpiGrid>
        <Kpi label="Total brands" value={totalBrands.toLocaleString('en-IN')} highlight />
        <Kpi label="Active" value={activeBrands.toLocaleString('en-IN')} />
        <Kpi label="Inactive" value={inactiveBrands.toLocaleString('en-IN')} />
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
            <div className="divide-y divide-amber-500/20">
              {/* Create-drafts: brand-new brands not yet on the live list. Publish activates them. */}
              {createDrafts.map(d => (
                <DraftRowActions
                  key={`new-${d.id}`}
                  entityId={d.id}
                  name={d.name}
                  subtitle="New brand — not yet published"
                  updatedAt={d.created_at}
                  editHref={ap(`/admin/brands/${d.id}/edit`, host)}
                  publishPath={d.staged ? `/api/admin/brands/${d.id}/publish` : `/api/admin/brands/${d.id}`}
                  publishMethod={d.staged ? undefined : 'PATCH'}
                  publishBody={d.staged ? undefined : { is_draft: false, is_active: true }}
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
                  editHref={ap(`/admin/brands/${d.brand_id}/edit`, host)}
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
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))

  const { brands, total } = await getFilteredBrands({
    is_active: resolvedSearchParams.is_active,
    search: resolvedSearchParams.search,
    page,
    limit: PAGE_SIZE,
  })

  const currentListUrl = (() => {
    const params = new URLSearchParams()
    if (resolvedSearchParams.is_active) params.set('is_active', resolvedSearchParams.is_active)
    if (resolvedSearchParams.search) params.set('search', resolvedSearchParams.search)
    if (page > 1) params.set('page', String(page))
    const qs = params.toString()
    return `/admin/brands${qs ? `?${qs}` : ''}`
  })()

  return (
    <BrandsTable
      brands={brands as any[]}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      isActive={resolvedSearchParams.is_active}
      search={resolvedSearchParams.search}
      backUrl={currentListUrl}
    />
  )
}

export default async function BrandsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const sp = await searchParams
  const tab = resolveListTab(sp)
  return (
    <PageBody>
      <PageHeader title="Brands" description="Manage product brands" />

      <TabLinks
        base="/admin/brands"
        active={tab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'list', label: 'Brands' },
        ]}
        actions={
          <>
            <BrochureButton mode="brand" />
            <Suspense fallback={null}>
              <AddBrandButton />
            </Suspense>
          </>
        }
      />
      <Suspense fallback={null}>
        <TabMemory storageKey="brand" tab={tab} explicit={typeof sp.tab === 'string'} />
      </Suspense>

      {tab === 'overview' ? (
        <GroupOverview dim="brand" />
      ) : (
        <>
          <Suspense fallback={<KpiRowSkeleton />}>
            <BrandsStats />
          </Suspense>

          <DataToolbar
            search={{ placeholder: 'Search by name...', param: 'search', suggestType: 'brands' }}
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
          />

          <BrandsListSection searchParams={searchParams} />
        </>
      )}
    </PageBody>
  )
}

function KpiRowSkeleton() {
  return (
    <div className="grid gap-3 grid-cols-2 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1 md:grid-cols-3 xl:grid-cols-6 animate-pulse">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-[84px] rounded-xl border border-border-default bg-surface-elevated" />
      ))}
    </div>
  )
}

// Resolves searchParams (no DB — near-instant) then keys the table Suspense
// on the query string so filter/pagination changes re-trigger the shimmer
// while the stats + filters above stay mounted.
async function BrandsListSection({ searchParams }: { searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const resolvedSearchParams = await searchParams
  const key = listKey(resolvedSearchParams)
  return (
    <Suspense key={key} fallback={<TableSkeleton rows={8} cols={5} />}>
      <BrandsListContent resolvedSearchParams={resolvedSearchParams} />
    </Suspense>
  )
}
