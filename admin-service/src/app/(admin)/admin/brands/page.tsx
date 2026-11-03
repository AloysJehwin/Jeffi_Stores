import { Suspense } from 'react'
import { buildWhere, normalizeQuery, sortClause, type FilterQuery, type SortDef } from '@jeffi/list-filters'
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
import PageDrafts, { DraftsTabLabel } from '@/components/admin/drafts/PageDrafts'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

type SP = { [key: string]: string | undefined }

const BRAND_SORT: SortDef = {
  sorts: { name: 'b.name', slug: 'b.slug', website: 'b.website', status: '(NOT b.is_active)' },
  defaultSql: 'b.name ASC',
  tiebreak: 'b.id',
}

async function getFilteredBrands(q: FilterQuery, opts: { page?: number; limit?: number; sp?: SP } = {}) {
  const w = buildWhere(BRANDS_ENTITY, q)
  const limit = opts.limit || 25
  const offset = ((opts.page || 1) - 1) * limit
  const order = sortClause({ get: k => opts.sp?.[k] ?? null }, BRAND_SORT)
  const [brands, total] = await Promise.all([
    queryMany(`SELECT b.* FROM brands b ${w.where} ${order} LIMIT $${w.nextIdx} OFFSET $${w.nextIdx + 1}`, [
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
  const w = buildWhere(BRANDS_ENTITY, q)
  const stats = await queryOne<{ total: number; active: number }>(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE b.is_active)::int AS active FROM brands b ${w.where}`,
    w.params
  )

  const totalBrands = stats?.total ?? 0
  const activeBrands = stats?.active ?? 0
  const inactiveBrands = totalBrands - activeBrands

  return (
    <div className="animate-fade-in space-y-4">
      <KpiGrid>
        <Kpi label="Total brands" value={totalBrands.toLocaleString('en-IN')} highlight />
        <Kpi label="Active" value={activeBrands.toLocaleString('en-IN')} />
        <Kpi label="Inactive" value={inactiveBrands.toLocaleString('en-IN')} />
      </KpiGrid>
    </div>
  )
}

// Publish / discard rows for the Drafts tab.
async function BrandPendingDrafts() {
  const host = await getHost()
  const [pendingDrafts, createDrafts] = await Promise.all([
    // Edit-drafts: one row per draft (several admins can each hold one of the same brand).
    // A new brand edited through a draft before its first publish is listed here too.
    queryMany<{ id: string; brand_id: string; name: string; title: string | null; author: string | null; is_new: boolean; updated_at: string }>(
      `SELECT bd.id, bd.brand_id, COALESCE(NULLIF(bd.fields->>'name', ''), b.name) AS name, bd.title, b.is_draft AS is_new, bd.updated_at,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS author
       FROM brand_drafts bd
       JOIN brands b ON b.id = bd.brand_id
       LEFT JOIN admins ad ON ad.id = bd.author_admin_id LEFT JOIN users u ON u.id = ad.user_id
       ORDER BY bd.updated_at DESC
       LIMIT 200`
    ),
    // Create-drafts: brand-new brands never published to the live list (is_draft = true), edited in place.
    queryMany<{ id: string; name: string; created_at: string }>(
      `SELECT b.id, b.name, b.created_at FROM brands b
       WHERE b.is_draft = true AND NOT EXISTS (SELECT 1 FROM brand_drafts bd WHERE bd.brand_id = b.id)
       ORDER BY b.created_at DESC LIMIT 200`
    ),
  ])
  const pendingDraftsCount = pendingDrafts.length + createDrafts.length
  if (!pendingDraftsCount) return null
  const locks = await draftLockChips('brand', [...createDrafts.map(d => d.id), ...pendingDrafts.map(d => d.id)])

  return (
        <details open className="group rounded-xl border border-amber-500/40 bg-amber-500/5">
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
              Ready to publish ({pendingDraftsCount})
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
                  publishPath={`/api/admin/brands/${d.id}`}
                  publishMethod="PATCH"
                  publishBody={{ is_draft: false, is_active: true }}
                  publishConfirm={`Publish "${d.name}" to the live brand list?`}
                  discardPath={`/api/brands/${d.id}`}
                  discardConfirm={`Delete the draft brand "${d.name}"? This cannot be undone.`}
                  entityLabel="brand"
                  lock={locks[d.id]}
                />
              ))}
              {pendingDrafts.map(d => (
                <DraftRowActions
                  key={d.id}
                  entityId={d.brand_id}
                  name={d.title ? `${d.name} · ${d.title}` : d.name}
                  subtitle={[d.is_new ? 'New brand — not yet published' : null, d.author ? `Draft by ${d.author}` : null].filter(Boolean).join(' · ') || null}
                  updatedAt={d.updated_at}
                  editHref={ap(`/admin/brands/${d.brand_id}/edit?draft=${d.id}`, host)}
                  publishPath={`/api/admin/brands/${d.brand_id}/publish?draft=${d.id}`}
                  publishConfirm={d.is_new ? `Publish "${d.name}" to the live brand list?` : undefined}
                  discardPath={`/api/admin/brands/${d.brand_id}/draft?draft=${d.id}`}
                  entityLabel="brand"
                  lock={locks[d.id]}
                />
              ))}
            </div>
          </div>
        </details>
      
  )
}

async function BrandsListContent({ resolvedSearchParams }: { resolvedSearchParams: SP }) {
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))
  const q = normalizeQuery(BRANDS_ENTITY, resolvedSearchParams)
  const { brands, total } = await getFilteredBrands(q, { page, limit: PAGE_SIZE, sp: resolvedSearchParams })
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
  const tab = sp.tab === 'drafts' ? 'drafts' : isListUrl(sp, BRAND_FIELDS, { aliases: BRAND_ALIASES }) ? 'list' : 'overview'
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
            { id: 'drafts', label: <DraftsTabLabel type="brand" />, href: href('drafts') },
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
      ) : tab === 'drafts' ? (
        <PageDrafts type="brand">
          <Suspense fallback={null}>
            <BrandPendingDrafts />
          </Suspense>
        </PageDrafts>
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
