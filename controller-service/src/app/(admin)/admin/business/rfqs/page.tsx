export const dynamic = 'force-dynamic'

import { listKey } from '@/lib/admin/list-key'
import { Suspense } from 'react'
import { normalizeQuery, type FilterQuery } from '@jeffi/list-filters'
import { Kpi, ListFilters, PageBody, PageHeader, TabLinks, TableSkeleton } from '@/components/admin/kit'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { redirect } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { adminCookieName } from '@/lib/auth/admin-cookie'
import { isListUrl, tabHref } from '@/lib/admin/filter-url'
import { getRfqMonthly, getRfqStatusCounts, listBusinessRfqs } from '@/lib/admin/business-rfqs'
import { RFQ_ENTITY } from '@/lib/filters/entities/business-rfqs'
import { RFQ_FIELDS, RFQ_SEARCH } from '@/lib/filters/fields/business-rfqs'
import BusinessRfqsTable from './_components/BusinessRfqsTable'
import RfqTrendChart, { type RfqTrendPoint } from './_components/RfqTrendChart'
import RfqsOverview from './_components/RfqsOverview'

const PAGE_SIZE = 25

type SP = { [key: string]: string | undefined }

// Status tiles and the 12-month trend over every RFQ the filters match.
async function BusinessRFQsStats({ q }: { q: FilterQuery }) {
  const [byStatus, trendRows] = await Promise.all([getRfqStatusCounts(q), getRfqMonthly(q)])

  const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0)
  const tiles = [
    { label: 'Total', value: total },
    { label: 'Pending', value: byStatus.pending || 0 },
    { label: 'In Review', value: (byStatus.reviewed || 0) + (byStatus.negotiating || 0) },
    { label: 'Offer Accepted', value: byStatus.offer_accepted || 0 },
    { label: 'Converted', value: byStatus.converted || 0 },
    { label: 'Rejected', value: byStatus.rejected || 0 },
  ]

  return (
    <div className="animate-fade-in grid grid-cols-1 gap-4 xl:grid-cols-3 lg:min-h-56">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:col-span-2">
        {tiles.map((t, i) => (
          <Kpi key={t.label} label={t.label} value={t.value.toLocaleString('en-IN')} highlight={i === 0} />
        ))}
      </div>
      <RfqTrendChart data={buildMonthlyTrend(trendRows)} />
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
  // unauthorized user never sees the shell.
  return <BusinessRFQsShell searchParams={searchParams} />
}

async function BusinessRFQsShell({ searchParams }: { searchParams: Promise<SP> }) {
  const resolvedSearchParams = await searchParams
  const cookieStore = await cookies()
  const token = cookieStore.get(await adminCookieName())
  const host = await getHost()
  if (!token) redirect(ap('/admin/login', host))
  const session = await verifyToken(token.value).catch(() => null)
  if (!session || !hasScope(session.role, session.scopes || [], 'business_rfqs:read'))
    redirect(ap('/admin/dashboard', host))

  // Overview by default; any list filter (or ?page) opens the list.
  const showList = isListUrl(resolvedSearchParams, RFQ_FIELDS)
  const href = (t: string) => ap(tabHref('/admin/business/rfqs', t, resolvedSearchParams, RFQ_FIELDS), host)
  const q = normalizeQuery(RFQ_ENTITY, resolvedSearchParams)

  return (
    <PageBody>
      <PageHeader title="Business RFQs" description="Review and respond to quote requests from business partners" />

      <TabLinks
        tabs={[
          { id: 'overview', label: 'Overview', href: href('overview') },
          { id: 'list', label: 'All RFQs', href: href('list') },
        ]}
        value={showList ? 'list' : 'overview'}
      />

      {!showList ? (
        <Suspense fallback={null}>
          <RfqsOverview />
        </Suspense>
      ) : (
        <>
          <Suspense key={JSON.stringify(q)} fallback={<StatsSkeleton />}>
            <BusinessRFQsStats q={q} />
          </Suspense>

          <ListFilters entity="business_rfqs" fields={RFQ_FIELDS} search={RFQ_SEARCH} noun="RFQs" tab="list" exportable />

          {/* Table re-shimmers on filter/pagination change while the shell stays mounted */}
          <Suspense key={listKey(resolvedSearchParams)} fallback={<TableSkeleton rows={8} cols={6} />}>
            <BusinessRFQsListContent q={q} page={resolvedSearchParams.page} host={host} />
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

async function BusinessRFQsListContent({ q, page: pageParam, host }: { q: FilterQuery; page?: string; host: string }) {
  const page = Math.max(1, parseInt(pageParam || '1', 10) || 1)
  const { rows: rfqs, total } = await listBusinessRfqs(q, page, PAGE_SIZE)

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
