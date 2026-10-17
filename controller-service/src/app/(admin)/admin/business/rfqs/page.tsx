export const dynamic = 'force-dynamic'

import { listKey } from '@/lib/admin/list-key'
import { Suspense } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { TabLinks } from '@/components/admin/channels/ui'
import { Kpi, PageBody, PageHeader, TableSkeleton } from '@/components/admin/kit'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { redirect } from 'next/navigation'
import { queryMany } from '@/lib/shared/db'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { adminCookieName } from '@/lib/auth/admin-cookie'
import BusinessRfqsTable from './_components/BusinessRfqsTable'
import RfqTrendChart, { type RfqTrendPoint } from './_components/RfqTrendChart'
import RfqsOverview from './_components/RfqsOverview'

const PAGE_SIZE = 25

interface RFQRow {
  id: string
  rfq_number: string
  status: string
  notes: string | null
  item_count: string
  created_at: string
  company_name: string
  first_name: string
  last_name: string | null
  email: string
}

const STATUS_LABELS: Record<string, string> = {
  all: 'All',
  pending: 'Pending',
  reviewed: 'Reviewed',
  negotiating: 'Negotiating',
  offer_accepted: 'Offer Accepted',
  converted: 'Converted',
  rejected: 'Rejected',
}

type SP = { [key: string]: string | undefined }

interface StatusCountRow {
  status: string
  count: string
}

// Streamed stats: one GROUP BY status count query + one grouped-by-month query.
// Mirrors the orders page gradient summary card + stat tiles, with an RFQ trend
// alongside. Mobile-first: tiles stack 2-up then widen; the trend scrolls.
async function BusinessRFQsStats() {
  const [statusRows, trendRows] = await Promise.all([
    queryMany<StatusCountRow>(`SELECT status, COUNT(*)::text AS count FROM business_rfqs GROUP BY status`),
    queryMany<{ month: string; count: string }>(
      `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, COUNT(*)::text AS count
       FROM business_rfqs
       WHERE created_at >= date_trunc('month', now()) - interval '11 months'
       GROUP BY 1
       ORDER BY 1`
    ),
  ])

  const byStatus = Object.fromEntries(statusRows.map(r => [r.status, parseInt(r.count, 10) || 0]))
  const total = statusRows.reduce((sum, r) => sum + (parseInt(r.count, 10) || 0), 0)
  const pending = byStatus.pending || 0
  const inReview = (byStatus.reviewed || 0) + (byStatus.negotiating || 0)
  const offerAccepted = byStatus.offer_accepted || 0
  const converted = byStatus.converted || 0
  const rejected = byStatus.rejected || 0

  const trend: RfqTrendPoint[] = buildMonthlyTrend(trendRows)

  const tiles = [
    { label: 'Total', value: total },
    { label: 'Pending', value: pending },
    { label: 'In Review', value: inReview },
    { label: 'Offer Accepted', value: offerAccepted },
    { label: 'Converted', value: converted },
    { label: 'Rejected', value: rejected },
  ]

  return (
    <div className="animate-fade-in grid grid-cols-1 gap-4 xl:grid-cols-3 lg:min-h-56">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:col-span-2">
        {tiles.map((t, i) => (
          <Kpi key={t.label} label={t.label} value={t.value.toLocaleString('en-IN')} highlight={i === 0} />
        ))}
      </div>
      <RfqTrendChart data={trend} />
    </div>
  )
}

// Pads the grouped-by-month rows to a continuous 12-month window ending this
// month, so sparse months render as zero bars rather than gaps.
function buildMonthlyTrend(rows: { month: string; count: string }[]): RfqTrendPoint[] {
  const counts = new Map(rows.map(r => [r.month, parseInt(r.count, 10) || 0]))
  const out: RfqTrendPoint[] = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    out.push({ month: key, count: counts.get(key) || 0 })
  }
  return out
}

export default function BusinessRFQsPage({ searchParams }: { searchParams: Promise<SP> }) {
  // Auth gating + redirect must run BEFORE any list content renders, so an
  // unauthorized user never sees the shell. This wrapper resolves the auth
  // check (and host) then renders the static shell + keyed list Suspense.
  return <BusinessRFQsShell searchParams={searchParams} />
}

// Runs the auth check + redirect, then renders the static shell (header,
// search form, status tabs) instantly and streams the table below.
async function BusinessRFQsShell({ searchParams }: { searchParams: Promise<SP> }) {
  const resolvedSearchParams = await searchParams
  const cookieStore = await cookies()
  const token = cookieStore.get(await adminCookieName())
  const host = await getHost()
  if (!token) redirect(ap('/admin/login', host))
  const session = await verifyToken(token.value).catch(() => null)
  if (!session || !hasScope(session.role, session.scopes || [], 'business_rfqs:read'))
    redirect(ap('/admin/dashboard', host))

  const status = resolvedSearchParams.status
  const search = resolvedSearchParams.search

  const tabUrl = (p: number, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({ tab: 'list' })
    if (search) params.set('search', search)
    Object.entries(extra).forEach(([k, v]) => params.set(k, v))
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return ap(`/admin/business/rfqs${qs ? `?${qs}` : ''}`, host)
  }

  const key = listKey(resolvedSearchParams)
  // Overview by default; the list keeps its old filter URLs (status/search/page).
  const tab = resolvedSearchParams.tab
  const showList = tab === 'list' || (!tab && !!(status || search || resolvedSearchParams.page))

  return (
    <PageBody>
      <PageHeader title="Business RFQs" description="Review and respond to quote requests from business partners" />

      <TabLinks
        tabs={[
          { id: 'overview', label: 'Overview', href: ap('/admin/business/rfqs?tab=overview', host) },
          { id: 'list', label: 'All RFQs', href: tabUrl(1, status ? { status } : {}) },
        ]}
        value={showList ? 'list' : 'overview'}
      />

      {!showList ? (
        <Suspense fallback={null}>
          <RfqsOverview />
        </Suspense>
      ) : (
        <>
          <Suspense fallback={<StatsSkeleton />}>
            <BusinessRFQsStats />
          </Suspense>

          {/* Same GET form as before: tab=list, status carried, search submitted. */}
          <div className="flex flex-wrap items-center gap-2">
            <form method="get" className="relative min-w-[200px] flex-1">
              <input type="hidden" name="tab" value="list" />
              {status && <input type="hidden" name="status" value={status} />}
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
              <input
                type="search"
                name="search"
                defaultValue={search}
                placeholder="Search by RFQ number, company, email..."
                aria-label="Search"
                className="field-md w-full border border-border-default bg-surface-elevated pl-9 text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500/40"
              />
            </form>
            <div className="flex h-control max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-border-default bg-surface-elevated p-0.5">
              {['all', 'pending', 'reviewed', 'negotiating', 'offer_accepted', 'converted', 'rejected'].map(s => (
                <Link
                  key={s}
                  href={tabUrl(1, s === 'all' ? {} : { status: s })}
                  className={`flex h-full shrink-0 items-center rounded-md px-3 text-xs font-medium transition-colors ${
                    (status ?? 'all') === s ? 'bg-accent-500 text-white' : 'text-foreground-secondary hover:bg-surface-secondary hover:text-foreground'
                  }`}
                >
                  {STATUS_LABELS[s] ?? s}
                </Link>
              ))}
            </div>
          </div>

          {/* Table re-shimmers on filter/pagination change while the shell stays mounted */}
          <Suspense key={key} fallback={<TableSkeleton rows={8} cols={6} />}>
            <BusinessRFQsListContent resolvedSearchParams={resolvedSearchParams} host={host} />
          </Suspense>
        </>
      )}
    </PageBody>
  )
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 animate-pulse xl:grid-cols-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:col-span-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[84px] rounded-xl border border-border-default bg-surface-elevated" />
        ))}
      </div>
      <div className="h-full min-h-[180px] rounded-xl border border-border-default bg-surface-elevated" />
    </div>
  )
}

// Runs the FILTERED list + count query and renders the table + pagination.
async function BusinessRFQsListContent({ resolvedSearchParams, host }: { resolvedSearchParams: SP; host: string }) {
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))
  const status = resolvedSearchParams.status
  const search = resolvedSearchParams.search

  const conditions: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (status && status !== 'all') {
    conditions.push(`r.status = $${idx++}`)
    values.push(status)
  }
  if (search) {
    conditions.push(`(r.rfq_number ILIKE $${idx} OR bp.company_name ILIKE $${idx} OR u.email ILIKE $${idx})`)
    values.push(`%${search}%`)
    idx++
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const offset = (page - 1) * PAGE_SIZE

  const [rfqs, countRows] = await Promise.all([
    queryMany<RFQRow>(
      `SELECT r.id, r.rfq_number, r.status, r.notes, r.created_at,
              COUNT(ri.id)::text AS item_count,
              bp.company_name, u.first_name, u.last_name, u.email
       FROM business_rfqs r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN business_profiles bp ON bp.user_id = r.user_id
       LEFT JOIN business_rfq_items ri ON ri.rfq_id = r.id
       ${where}
       GROUP BY r.id, bp.company_name, u.first_name, u.last_name, u.email
       ORDER BY r.created_at DESC
       LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      values
    ),
    queryMany<{ count: string }>(
      `SELECT COUNT(DISTINCT r.id) AS count FROM business_rfqs r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN business_profiles bp ON bp.user_id = r.user_id
       ${where}`,
      values
    ),
  ])

  const total = parseInt(countRows[0]?.count || '0', 10)

  return (
    <BusinessRfqsTable
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      rfqs={rfqs.map(rfq => ({
        id: rfq.id,
        rfq_number: rfq.rfq_number,
        status: rfq.status,
        item_count: rfq.item_count,
        created_at: rfq.created_at,
        company_name: rfq.company_name,
        first_name: rfq.first_name,
        last_name: rfq.last_name,
        email: rfq.email,
        href: ap(`/admin/business/rfqs/${rfq.id}/view`, host),
      }))}
    />
  )
}
