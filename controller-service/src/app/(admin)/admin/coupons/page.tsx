import { Suspense } from 'react'
import { canonicalQuery, normalizeQuery, type FilterQuery } from '@jeffi/list-filters'
import { listKey } from '@/lib/admin/list-key'
import { isListUrl, tabHref } from '@/lib/admin/filter-url'
import { Plus } from 'lucide-react'
import { TabAction } from '@/components/admin/channels/ui'
import { headers } from 'next/headers'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'
import { getCouponsSummary, queryCoupons } from '@/lib/queries/coupons'
import { COUPONS_ENTITY } from '@/lib/filters/entities/coupons'
import { COUPON_ALIASES, COUPON_FIELDS, COUPON_SEARCH } from '@/lib/filters/fields/coupons'
import CouponsTable, { type CouponRow } from './_components/CouponsTable'
import { Kpi, KpiGrid, ListFilters, PageBody, PageHeader, TableSkeleton } from '@/components/admin/kit'
import DraftRowActions from '@/components/admin/DraftRowActions'
import OverviewTabs from './_components/OverviewTabs'
import CouponsOverview from './_components/CouponsOverview'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

type SP = { [key: string]: string | undefined }

export default async function CouponsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  const tab = isListUrl(sp, COUPON_FIELDS, { aliases: COUPON_ALIASES }) ? 'list' : 'overview'
  const host = await getHost()
  const href = (t: string) => ap(tabHref('/admin/coupons', t, sp, COUPON_FIELDS, { aliases: COUPON_ALIASES }), host)
  const q = normalizeQuery(COUPONS_ENTITY, sp)
  return (
    <PageBody>
      <PageHeader title="Coupons" description="Manage discount coupons" />

      <OverviewTabs
        basePath={ap('/admin/coupons', host)}
        active={tab}
        sp={sp}
        listLabel="Coupons"
        hrefs={{ overview: href('overview'), list: href('list') }}
        actions={
          <Suspense fallback={null}>
            <AddCouponButton />
          </Suspense>
        }
      />

      {tab === 'overview' ? (
        <Suspense fallback={null}>
          <CouponsOverview />
        </Suspense>
      ) : (
        <>
          <Suspense key={JSON.stringify(q)} fallback={<KpiRowSkeleton />}>
            <CouponsStats q={q} />
          </Suspense>

          <ListFilters
            entity="coupons"
            fields={COUPON_FIELDS}
            aliases={COUPON_ALIASES}
            search={COUPON_SEARCH}
            noun="Coupons"
            tab="list"
            exportable
          />

          <CouponsListSection resolvedSearchParams={sp} />
        </>
      )}
    </PageBody>
  )
}

function KpiRowSkeleton() {
  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))] animate-pulse">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-[84px] rounded-xl border border-border-default bg-surface-elevated" />
      ))}
    </div>
  )
}

async function AddCouponButton() {
  const host = await getHost()
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'coupons:write')
  if (!canWrite) return null
  return <TabAction href={ap('/admin/coupons/add', host)} icon={<Plus className="w-4 h-4" />} label="Add New Coupon" />
}

/** KPIs over every coupon the filters match (not just the page shown). */
async function CouponsStats({ q }: { q: FilterQuery }) {
  const host = await getHost()
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'coupons:write')
  const [summary, editDrafts, createDrafts] = await Promise.all([
    getCouponsSummary(q),
    // Edit-drafts: unpublished CHANGES staged against a live coupon (coupon_drafts).
    queryMany<{ coupon_id: string; code: string; updated_at: string }>(
      `SELECT cd.coupon_id, c.code, cd.updated_at
       FROM coupon_drafts cd
       JOIN coupons c ON c.id = cd.coupon_id AND c.is_draft = false
       ORDER BY cd.updated_at DESC
       LIMIT 20`
    ),
    // Create-drafts: brand-new coupons never published to the live list (is_draft = true).
    // A new coupon edited before its first publish also has a coupon_drafts row — list it once.
    queryMany<{ id: string; code: string; created_at: string; staged: boolean }>(
      `SELECT c.id, COALESCE(cd.fields->>'code', c.code) AS code, c.created_at, cd.coupon_id IS NOT NULL AS staged
       FROM coupons c LEFT JOIN coupon_drafts cd ON cd.coupon_id = c.id
       WHERE c.is_draft = true ORDER BY c.created_at DESC LIMIT 20`
    ),
  ])
  const pendingDrafts = editDrafts
  const pendingDraftsCount = editDrafts.length + createDrafts.length

  const { total: totalCoupons, active: activeCoupons, expired: expiredCoupons, campaign: campaignCoupons } = summary

  return (
    <div className="animate-fade-in space-y-4">
      <KpiGrid>
        <Kpi label="Total" value={totalCoupons.toLocaleString('en-IN')} highlight />
        <Kpi label="Active" value={activeCoupons.toLocaleString('en-IN')} />
        <Kpi label="Expired" value={expiredCoupons.toLocaleString('en-IN')} />
        <Kpi label="From campaigns" value={campaignCoupons.toLocaleString('en-IN')} />
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
              {/* Create-drafts: brand-new coupons not yet on the live list. Publish activates them. */}
              {createDrafts.map(d =>
                canWrite ? (
                  <DraftRowActions
                    key={`new-${d.id}`}
                    entityId={d.id}
                    name={d.code}
                    subtitle="New coupon — not yet published"
                    updatedAt={d.created_at}
                    editHref={ap(`/admin/coupons/${d.id}/edit`, host)}
                    publishPath={d.staged ? `/api/admin/coupons/${d.id}/publish` : `/api/admin/coupons/${d.id}`}
                    publishMethod={d.staged ? undefined : 'PATCH'}
                    publishBody={d.staged ? undefined : { is_draft: false, is_active: true }}
                    publishConfirm={`Publish "${d.code}" to the live coupon list?`}
                    discardPath={`/api/admin/coupons/${d.id}`}
                    discardConfirm={`Delete the draft coupon "${d.code}"? This cannot be undone.`}
                    entityLabel="coupon"
                  />
                ) : (
                  <div key={`new-${d.id}`} className="px-4 py-2.5 flex items-center gap-2">
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400 font-mono truncate">
                      {d.code}
                    </p>
                    <span className="text-xs text-amber-600 dark:text-amber-400">new</span>
                  </div>
                )
              )}
              {pendingDrafts.map(d =>
                canWrite ? (
                  <DraftRowActions
                    key={d.coupon_id}
                    entityId={d.coupon_id}
                    name={d.code}
                    subtitle={null}
                    updatedAt={d.updated_at}
                    editHref={ap(`/admin/coupons/${d.coupon_id}/edit`, host)}
                    publishPath={`/api/admin/coupons/${d.coupon_id}/publish`}
                    discardPath={`/api/admin/coupons/${d.coupon_id}/draft`}
                    entityLabel="coupon"
                  />
                ) : (
                  <div key={d.coupon_id} className="px-4 py-2.5 flex items-center gap-2">
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400 font-mono truncate">
                      {d.code}
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

// Keys the table Suspense on the query string so filter/pagination changes re-trigger the shimmer
// while the stats + filters above stay mounted.
function CouponsListSection({ resolvedSearchParams }: { resolvedSearchParams: SP }) {
  const key = listKey(resolvedSearchParams)
  return (
    <Suspense key={key} fallback={<TableSkeleton rows={8} cols={7} />}>
      <CouponsListContent resolvedSearchParams={resolvedSearchParams} />
    </Suspense>
  )
}

async function CouponsListContent({ resolvedSearchParams }: { resolvedSearchParams: SP }) {
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))
  const sort = resolvedSearchParams.sort
  const dir = resolvedSearchParams.dir as 'asc' | 'desc' | undefined
  const q = normalizeQuery(COUPONS_ENTITY, resolvedSearchParams)

  const { coupons, total } = await queryCoupons(q, { page, limit: PAGE_SIZE, sort, dir })

  const currentListUrl = (() => {
    const params = new URLSearchParams(`tab=list&${canonicalQuery(q, COUPON_FIELDS)}`)
    if (sort) params.set('sort', sort)
    if (dir) params.set('dir', dir)
    if (page > 1) params.set('page', String(page))
    return `/admin/coupons?${params}`
  })()

  return (
    <CouponsTable
      coupons={coupons as CouponRow[]}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      query={{ ...q, sort, dir }}
      backUrl={currentListUrl}
    />
  )
}
