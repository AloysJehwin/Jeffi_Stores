export const dynamic = 'force-dynamic'

import { listKey } from '@/lib/admin/list-key'
import { Suspense } from 'react'
import { normalizeQuery, type FilterQuery } from '@jeffi/list-filters'
import { Kpi, ListFilters, PageBody, PageHeader, SplitRow, TabLinks } from '@/components/admin/kit'
import { LoadingChart, LoadingTable, Sk } from '@/components/admin/kit/skeleton'
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
import PageDrafts, { DraftsTabLabel } from '@/components/admin/drafts/PageDrafts'
import { requireListAccess } from '@/lib/admin/list-access'

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
    <SplitRow
      at="xl"
      className="animate-fade-in"
      wide={
        <div className="grid grid-cols-2 auto-rows-fr gap-3 sm:grid-cols-3">
          {tiles.map((t, i) => (
            <Kpi key={t.label} label={t.label} value={t.value.toLocaleString('en-IN')} highlight={i === 0} />
          ))}
        </div>
      }
      narrow={<RfqTrendChart data={buildMonthlyTrend(trendRows)} />}
    />
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
  const showDrafts = resolvedSearchParams.tab === 'drafts'
  const showList = !showDrafts && isListUrl(resolvedSearchParams, RFQ_FIELDS)
  const href = (t: string) => ap(tabHref('/admin/business/rfqs', t, resolvedSearchParams, RFQ_FIELDS), host)
  const q = normalizeQuery(RFQ_ENTITY, resolvedSearchParams)

  return (
    <PageBody>
      <PageHeader title="Business RFQs" description="Review and respond to quote requests from business partners" />

      <TabLinks
        tabs={[
          { id: 'overview', label: 'Overview', href: href('overview') },
          { id: 'list', label: 'All RFQs', href: href('list') },
          { id: 'drafts', label: <DraftsTabLabel type="rfq_reply" label="Draft replies" />, href: ap('/admin/business/rfqs?tab=drafts', host) },
        ]}
        value={showDrafts ? 'drafts' : showList ? 'list' : 'overview'}
      />

      {showDrafts ? (
        <PageDrafts type="rfq_reply" />
      ) : !showList ? (
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
          <Suspense key={listKey(resolvedSearchParams)} fallback={<LoadingTable columns={['RFQ #', 'Company', 'Contact', 'Items', 'Status', 'Submitted', '']} />}>
            <BusinessRFQsListContent q={q} page={resolvedSearchParams.page} sp={resolvedSearchParams} host={host} />
          </Suspense>
        </>
      )}
    </PageBody>
  )
}

function StatsSkeleton() {
  return (
    <SplitRow
      at="xl"
      wide={
        <div className="grid grid-cols-2 auto-rows-fr gap-3 sm:grid-cols-3">
          {['Total', 'Pending', 'In Review', 'Offer Accepted', 'Converted', 'Rejected'].map(l => (
            <div key={l} className="flex flex-col gap-1 rounded-xl border border-border-default bg-surface-elevated p-3 sm:p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">{l}</p>
              <Sk className="mt-1 h-6 w-16" />
            </div>
          ))}
        </div>
      }
      narrow={<LoadingChart title="RFQs Received" height="h-32" />}
    />
  )
}

async function rfqPage(q: FilterQuery, page: number, sp: SP, host: string) {
  const { rows, total } = await listBusinessRfqs(q, page, PAGE_SIZE, { get: k => sp[k] ?? null })
  return {
    total,
    rows: rows.map(rfq => ({
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
    })),
  }
}

async function BusinessRFQsListContent({ q, page: pageParam, sp, host }: { q: FilterQuery; page?: string; sp: SP; host: string }) {
  const page = Math.max(1, parseInt(pageParam || '1', 10) || 1)
  const { rows: rfqs, total } = await rfqPage(q, page, sp, host)
  async function loadPage(p: number) {
    'use server'
    await requireListAccess('/admin/business/rfqs')
    return rfqPage(q, p, sp, host)
  }

  return <BusinessRfqsTable total={total} page={page} pageSize={PAGE_SIZE} rfqs={rfqs} loadPage={loadPage} />
}
