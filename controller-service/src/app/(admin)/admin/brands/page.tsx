import { Suspense } from 'react'
import { buildWhere, normalizeQuery, type FilterQuery } from '@jeffi/list-filters'
import { listKey } from '@/lib/admin/list-key'
import { isListUrl, tabHref } from '@/lib/admin/filter-url'
import { Plus } from 'lucide-react'
import { TabAction } from '@/components/admin/channels/ui'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { queryMany, queryCount, queryOne } from '@/lib/shared/db'
import { BRANDS_ENTITY } from '@/lib/filters/entities/brands'
import { BRAND_ALIASES, BRAND_FIELDS, BRAND_SEARCH } from '@/lib/filters/fields/brands'
import { Kpi, KpiGrid, ListFilters, PageBody, PageHeader, TabLinks, TableSkeleton } from '@/components/admin/kit'
import BrochureButton from '@/components/admin/BrochureButton'
import DraftRowActions from '@/components/admin/DraftRowActions'
import { draftLockChips } from '@/lib/admin/draft-locks'
import BrandsTable from './_components/BrandsTable'
import GroupOverview from '../categories/_components/GroupOverview'
import { TabMemory } from '../products/_components/catalog-overview'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

type SP = { [key: string]: string | undefined }

async function getFilteredBrands(q: FilterQuery, opts: { page?: number; limit?: number } = {}) {
  const w = buildWhere(BRANDS_ENTITY, q)
  const limit = opts.limit || 25
  const offset = ((opts.page || 1) - 1) * limit
  const [brands, total] = await Promise.all([
    queryMany(`SELECT b.* FROM brands b ${w.where} ORDER BY b.name ASC LIMIT $${w.nextIdx} OFFSET $${w.nextIdx + 1}`, [
      ...w.params,
      limit,
      offset,
    ]),
    queryCount(`SELECT COUNT(*) FROM brands b ${w.where}`, w.params),
  ])
  return { brands, total }
}

async function AddBrandButton() {
  const host = await getHost()
  return <TabAction href={ap('/admin/brands/add', host)} icon={<Plus className="w-4 h-4" />} label="Add New Brand" />
}

/** KPIs over every brand the filters match. */
async function BrandsStats({ q }: { q: FilterQuery }) {
  const host = await getHost()
  const w = buildWhere(BRANDS_ENTITY, q)
  const [stats, pendingDrafts, createDrafts] = await Promise.all([
    queryOne<{ total: number; active: number }>(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE b.is_active)::int AS active FROM brands b ${w.where}`,
      w.params
    ),
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

  const totalBrands = stats?.total ?? 0
  const activeBrands = stats?.active ?? 0
  const inactiveBrands = totalBrands - activeBrands
  const pendingDraftsCount = pendingDrafts.length + createDrafts.length
  const locks = await draftLockChips('brand', [...createDrafts.map(d => d.id), ...pendingDrafts.map(d => d.brand_id)])

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
                  lock={locks[d.id]}
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
                  lock={locks[d.brand_id]}
                />
              ))}
            </div>
          </div>
        </details>
      )}
    </div>
  )
}

async function BrandsListContent({ resolvedSearchParams }: { resolvedSearchParams: SP }) {
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))
  const q = normalizeQuery(BRANDS_ENTITY, resolvedSearchParams)
  const { brands, total } = await getFilteredBrands(q, { page, limit: PAGE_SIZE })
  const currentListUrl = tabHref('/admin/brands', 'list', resolvedSearchParams, BRAND_FIELDS, { aliases: BRAND_ALIASES })

  return (
    <BrandsTable
      brands={brands as any[]}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      isActive={q.active}
      search={q.search}
      backUrl={page > 1 ? `${currentListUrl}&page=${page}` : currentListUrl}
    />
  )
}

export default async function BrandsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  const host = await getHost()
  const tab = isListUrl(sp, BRAND_FIELDS, { aliases: BRAND_ALIASES }) ? 'list' : 'overview'
  const href = (t: string) => ap(tabHref('/admin/brands', t, sp, BRAND_FIELDS, { aliases: BRAND_ALIASES }), host)
  const q = normalizeQuery(BRANDS_ENTITY, sp)
  return (
    <PageBody>
      <PageHeader title="Brands" description="Manage product brands" />

      <div className="mb-6">
        <TabLinks
          tabs={[
            { id: 'overview', label: 'Overview', href: href('overview') },
            { id: 'list', label: 'Brands', href: href('list') },
          ]}
          value={tab}
          scroll={false}
          actions={
            <>
              <BrochureButton mode="brand" />
              <Suspense fallback={null}>
                <AddBrandButton />
              </Suspense>
            </>
          }
        />
      </div>
      <Suspense fallback={null}>
        <TabMemory storageKey="brand" tab={tab} explicit={typeof sp.tab === 'string'} />
      </Suspense>

      {tab === 'overview' ? (
        <Suspense fallback={null}>
          <GroupOverview dim="brand" />
        </Suspense>
      ) : (
        <>
          <Suspense key={JSON.stringify(q)} fallback={<KpiRowSkeleton />}>
            <BrandsStats q={q} />
          </Suspense>

          <ListFilters
            entity="brands"
            fields={BRAND_FIELDS}
            aliases={BRAND_ALIASES}
            search={BRAND_SEARCH}
            noun="Brands"
            tab="list"
            exportable
          />

          <BrandsListSection resolvedSearchParams={sp} />
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

// Keys the table Suspense on the query string so filter/pagination changes re-trigger the shimmer
// while the stats + filters above stay mounted.
function BrandsListSection({ resolvedSearchParams }: { resolvedSearchParams: SP }) {
  const key = listKey(resolvedSearchParams)
  return (
    <Suspense key={key} fallback={<TableSkeleton rows={8} cols={5} />}>
      <BrandsListContent resolvedSearchParams={resolvedSearchParams} />
    </Suspense>
  )
}
