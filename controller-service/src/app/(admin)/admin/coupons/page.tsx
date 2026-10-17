import { Suspense } from 'react'
import { listKey } from '@/lib/admin/list-key'
import { Plus } from 'lucide-react'
import { TabAction } from '@/components/admin/channels/ui'
import { headers } from 'next/headers'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, queryCount } from '@/lib/shared/db'
import CouponsTable, { type CouponRow } from './_components/CouponsTable'
import { DataToolbar, Kpi, KpiGrid, PageBody, PageHeader, TableSkeleton } from '@/components/admin/kit'
import DraftRowActions from '@/components/admin/DraftRowActions'
import { resolveListTab } from '@/lib/overviews/marketing'
import OverviewTabs from './_components/OverviewTabs'
import CouponsOverview from './_components/CouponsOverview'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

const COUPON_SORT_COLS: Record<string, string> = {
  code: 'code',
  type: 'discount_type',
  value: 'discount_value',
  min_purchase: 'min_purchase_amount',
  usage: 'times_used',
  valid_until: 'valid_until',
  status: 'is_active',
}

async function getFilteredCoupons(filters: {
  is_active?: string
  search?: string
  campaign?: string
  page?: number
  sort?: string
  dir?: string
}) {
  const conditions: string[] = []
  const params: unknown[] = []
  let i = 1

  // Never-published drafts live only in the Drafts section, never the live list.
  conditions.push(`is_draft = false`)

  if (filters.is_active === 'true' || filters.is_active === 'false') {
    conditions.push(`is_active = $${i++}`)
    params.push(filters.is_active === 'true')
  }
  if (filters.search) {
    conditions.push(`(code ILIKE $${i} OR description ILIKE $${i})`)
    params.push(`%${filters.search}%`)
    i++
  }
  if (filters.campaign === '__manual__') {
    conditions.push(`(auto_generated = false OR auto_generated IS NULL)`)
  } else if (filters.campaign) {
    conditions.push(`generated_for_campaign = $${i++}`)
    params.push(filters.campaign)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = PAGE_SIZE
  const offset = ((filters.page || 1) - 1) * limit

  const safeCol = filters.sort && COUPON_SORT_COLS[filters.sort] ? COUPON_SORT_COLS[filters.sort] : 'created_at'
  const safeDir = filters.dir === 'asc' ? 'ASC' : 'DESC'
  const orderBy = `ORDER BY ${safeCol} ${safeDir}`

  const [coupons, total] = await Promise.all([
    queryMany(`SELECT * FROM coupons ${where} ${orderBy} LIMIT $${i} OFFSET $${i + 1}`, [...params, limit, offset]),
    queryCount(`SELECT COUNT(*) FROM coupons ${where}`, params),
  ])

  return { coupons, total }
}

const LIST_KEYS = ['is_active', 'search', 'campaign', 'page', 'sort', 'dir'] as const

export default async function CouponsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const sp = await searchParams
  const tab = resolveListTab(sp, LIST_KEYS)
  const host = await getHost()
  return (
    <PageBody>
      <PageHeader title="Coupons" description="Manage discount coupons" />

      <OverviewTabs
        basePath={ap('/admin/coupons', host)}
        active={tab}
        sp={sp}
        listLabel="Coupons"
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
          <Suspense fallback={<KpiRowSkeleton />}>
            <CouponsStats />
          </Suspense>

          <DataToolbar
            search={{ placeholder: 'Search by code or description...', param: 'search', suggestType: 'coupons' }}
            filters={[
              {
                name: 'is_active',
                label: 'Status',
                options: [
                  { value: 'true', label: 'Active' },
                  { value: 'false', label: 'Inactive' },
                ],
              },
              {
                name: 'campaign',
                label: 'Source',
                options: [
                  { value: '__manual__', label: 'Manual' },
                  { value: 'winback_90', label: 'Winback 90d' },
                  { value: 'winback_180', label: 'Winback 180d' },
                ],
              },
            ]}
          />

          <CouponsListSection searchParams={searchParams} />
        </>
      )}
    </PageBody>
  )
}

function KpiRowSkeleton() {
  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6 animate-pulse">
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
  return (
    <span className="hidden md:inline-flex">
      <TabAction href={ap('/admin/coupons/add', host)} icon={<Plus className="w-4 h-4" />} label="Add New Coupon" />
    </span>
  )
}

async function CouponsStats() {
  const host = await getHost()
  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'coupons:write')
  const [allStats, editDrafts, createDrafts] = await Promise.all([
    getFilteredCoupons({}),
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

  const totalCoupons = allStats.total
  const activeCoupons = (allStats.coupons as { is_active: boolean }[]).filter(c => c.is_active).length
  const expiredCoupons = (allStats.coupons as { valid_until: string | null; is_active: boolean }[]).filter(
    c => c.valid_until && new Date(c.valid_until) < new Date()
  ).length
  const campaignCoupons = (allStats.coupons as { auto_generated: boolean }[]).filter(c => c.auto_generated).length

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

// Resolves searchParams (no DB — near-instant) then keys the table Suspense
// on the query string so filter/pagination changes re-trigger the shimmer
// while the stats + filters above stay mounted.
async function CouponsListSection({ searchParams }: { searchParams: Promise<{ [key: string]: string | undefined }> }) {
  const resolvedSearchParams = await searchParams
  const key = listKey(resolvedSearchParams)
  return (
    <Suspense key={key} fallback={<TableSkeleton rows={8} cols={7} />}>
      <CouponsListContent resolvedSearchParams={resolvedSearchParams} />
    </Suspense>
  )
}

async function CouponsListContent({
  resolvedSearchParams,
}: {
  resolvedSearchParams: { [key: string]: string | undefined }
}) {
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))
  const sort = resolvedSearchParams.sort
  const dir = resolvedSearchParams.dir as 'asc' | 'desc' | undefined
  const campaign = resolvedSearchParams.campaign

  const { coupons, total } = await getFilteredCoupons({
    is_active: resolvedSearchParams.is_active,
    search: resolvedSearchParams.search,
    campaign,
    page,
    sort,
    dir,
  })

  const currentListUrl = (() => {
    const params = new URLSearchParams({ tab: 'list' })
    if (resolvedSearchParams.is_active) params.set('is_active', resolvedSearchParams.is_active)
    if (resolvedSearchParams.search) params.set('search', resolvedSearchParams.search)
    if (campaign) params.set('campaign', campaign)
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
      query={{ is_active: resolvedSearchParams.is_active, search: resolvedSearchParams.search, campaign, sort, dir }}
      backUrl={currentListUrl}
    />
  )
}
