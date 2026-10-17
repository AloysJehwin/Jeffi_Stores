export const dynamic = 'force-dynamic'

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
import BusinessCustomersTable from './_components/BusinessCustomersTable'
import B2bCustomersOverview from './_components/B2bCustomersOverview'

const PAGE_SIZE = 25

type SP = { [key: string]: string | undefined }

interface BusinessCustomer {
  user_id: string
  email: string
  first_name: string
  last_name: string | null
  phone: string | null
  company_name: string
  gst_number: string
  industry: string
  approval_status: string
  created_at: string
  approved_at: string | null
}

async function getBusinessCustomers({ status, search, page }: { status?: string; search?: string; page: number }) {
  const conditions: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (status && status !== 'all') {
    conditions.push(`bp.approval_status = $${idx++}`)
    values.push(status)
  }
  if (search) {
    conditions.push(`(u.email ILIKE $${idx} OR bp.company_name ILIKE $${idx} OR bp.gst_number ILIKE $${idx})`)
    values.push(`%${search}%`)
    idx++
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const offset = (page - 1) * PAGE_SIZE

  const [rows, countRows] = await Promise.all([
    queryMany<BusinessCustomer & { total: string }>(
      `SELECT u.id AS user_id, u.email, u.first_name, u.last_name, u.phone,
              bp.company_name, bp.gst_number, bp.industry, bp.approval_status,
              bp.created_at, bp.approved_at
       FROM business_profiles bp
       JOIN users u ON u.id = bp.user_id
       ${where}
       ORDER BY bp.created_at DESC
       LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      values
    ),
    queryMany<{ count: string }>(
      `SELECT COUNT(*) AS count FROM business_profiles bp JOIN users u ON u.id = bp.user_id ${where}`,
      values
    ),
  ])

  return { customers: rows, total: parseInt(countRows[0]?.count || '0', 10) }
}

// Builds a business-customers URL that preserves the active status/search
// filters. Shared by the stat cards, status tabs and pagination.
function buildUrl(resolvedSearchParams: SP, host: string, p: number, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ tab: 'list' })
  if (resolvedSearchParams.status) params.set('status', resolvedSearchParams.status)
  if (resolvedSearchParams.search) params.set('search', resolvedSearchParams.search)
  Object.entries(extra).forEach(([k, v]) => params.set(k, v))
  if (p > 1) params.set('page', String(p))
  const qs = params.toString()
  return ap(`/admin/business/customers${qs ? `?${qs}` : ''}`, host)
}

// Runs the same filtered query the list uses plus the global pending count, and
// renders the stat/filter-tab cards. Streamed independently of the table so the
// header + filters stay mounted while both re-shimmer on filter change.
// Numbers match the original page exactly: all=filtered total, pending=global
// pending count, approved=approved rows on the current page.
async function BusinessCustomersStats({ resolvedSearchParams, host }: { resolvedSearchParams: SP; host: string }) {
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))
  const [{ customers, total }, pendingRows] = await Promise.all([
    getBusinessCustomers({
      status: resolvedSearchParams.status,
      search: resolvedSearchParams.search,
      page,
    }),
    queryMany<{ count: string }>(`SELECT COUNT(*) AS count FROM business_profiles WHERE approval_status='pending'`, []),
  ])
  const pendingCount = pendingRows[0]?.count || '0'

  const cardValue = (s: 'all' | 'pending' | 'approved') =>
    s === 'all' ? total : s === 'pending' ? pendingCount : customers.filter(c => c.approval_status === s).length

  return (
    <div className="animate-fade-in grid grid-cols-3 gap-3">
      {(['all', 'pending', 'approved'] as const).map(s => {
        const active = (resolvedSearchParams.status ?? 'all') === s
        return (
          <Link
            key={s}
            href={buildUrl(resolvedSearchParams, host, 1, s === 'all' ? {} : { status: s })}
            className={`rounded-xl transition-shadow ${active ? 'ring-1 ring-accent-500' : 'hover:ring-1 hover:ring-border-default'}`}
          >
            <Kpi label={s} value={String(cardValue(s))} highlight={active} />
          </Link>
        )
      })}
    </div>
  )
}

// Runs the FILTERED list query (status, search, page) and renders the table
// plus pagination. Wrapped in a keyed Suspense so it re-shimmers on change.
async function BusinessCustomersListContent({
  resolvedSearchParams,
  host,
}: {
  resolvedSearchParams: SP
  host: string
}) {
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))
  const { customers, total } = await getBusinessCustomers({
    status: resolvedSearchParams.status,
    search: resolvedSearchParams.search,
    page,
  })

  return (
    <BusinessCustomersTable
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      customers={customers.map(c => ({
        user_id: c.user_id,
        email: c.email,
        first_name: c.first_name,
        last_name: c.last_name,
        company_name: c.company_name,
        gst_number: c.gst_number,
        industry: c.industry,
        approval_status: c.approval_status,
        created_at: c.created_at,
        href: ap(`/admin/business/customers/${c.user_id}/view`, host),
      }))}
    />
  )
}

// Keys the table Suspense on the query string so filter/pagination changes
// re-trigger the shimmer while the stats + filters above stay mounted.
function BusinessCustomersListSection({ resolvedSearchParams, host }: { resolvedSearchParams: SP; host: string }) {
  const key = JSON.stringify(resolvedSearchParams)
  return (
    <Suspense key={key} fallback={<TableSkeleton rows={8} cols={6} />}>
      <BusinessCustomersListContent resolvedSearchParams={resolvedSearchParams} host={host} />
    </Suspense>
  )
}

export default async function BusinessCustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  // Auth gate runs synchronously in the shell — an unauthorized user is
  // redirected before any content (stats or list) is rendered/streamed.
  const resolvedSearchParams = await searchParams
  const cookieStore = await cookies()
  const token = cookieStore.get(await adminCookieName())
  const host = await getHost()
  if (!token) redirect(ap('/admin/login', host))
  const session = await verifyToken(token.value).catch(() => null)
  if (!session || !hasScope(session.role, session.scopes || [], 'business_customers:read'))
    redirect(ap('/admin/dashboard', host))

  // Overview by default; the list keeps its old filter URLs (status/search/page).
  const tab = resolvedSearchParams.tab
  const showList =
    tab === 'list' ||
    (!tab && !!(resolvedSearchParams.status || resolvedSearchParams.search || resolvedSearchParams.page))

  return (
    <PageBody>
      <PageHeader title="Business Customers" description="Manage B2B partner accounts, approvals, and discounts" />

      <TabLinks
        tabs={[
          { id: 'overview', label: 'Overview', href: ap('/admin/business/customers?tab=overview', host) },
          { id: 'list', label: 'All accounts', href: buildUrl(resolvedSearchParams, host, 1) },
        ]}
        value={showList ? 'list' : 'overview'}
      />

      {!showList ? (
        <Suspense fallback={null}>
          <B2bCustomersOverview />
        </Suspense>
      ) : (
        <>
          <Suspense fallback={<KpiRowSkeleton />}>
            <BusinessCustomersStats resolvedSearchParams={resolvedSearchParams} host={host} />
          </Suspense>

          {/* Same GET form as before: tab=list, status carried, search submitted. */}
          <div className="flex flex-wrap items-center gap-2">
            <form method="get" className="relative min-w-[200px] flex-1">
              <input type="hidden" name="tab" value="list" />
              {resolvedSearchParams.status && <input type="hidden" name="status" value={resolvedSearchParams.status} />}
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
              <input
                type="search"
                name="search"
                defaultValue={resolvedSearchParams.search}
                placeholder="Search by email, company, GST..."
                aria-label="Search"
                className="field-md w-full border border-border-default bg-surface-elevated pl-9 text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500/40"
              />
            </form>
            <div className="flex h-control items-center gap-0.5 rounded-lg border border-border-default bg-surface-elevated p-0.5">
              {['all', 'pending', 'approved', 'rejected'].map(s => (
                <Link
                  key={s}
                  href={buildUrl(resolvedSearchParams, host, 1, s === 'all' ? {} : { status: s })}
                  className={`flex h-full items-center rounded-md px-3 text-xs font-medium capitalize transition-colors ${
                    (resolvedSearchParams.status ?? 'all') === s ? 'bg-accent-500 text-white' : 'text-foreground-secondary hover:bg-surface-secondary hover:text-foreground'
                  }`}
                >
                  {s}
                </Link>
              ))}
            </div>
          </div>

          <BusinessCustomersListSection resolvedSearchParams={resolvedSearchParams} host={host} />
        </>
      )}
    </PageBody>
  )
}

function KpiRowSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3 animate-pulse">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-[84px] rounded-xl border border-border-default bg-surface-elevated" />
      ))}
    </div>
  )
}
