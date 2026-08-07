export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Link from 'next/link'
import { cookies} from 'next/headers'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { redirect } from 'next/navigation'
import { queryMany } from '@/lib/db'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import AdminStatsSkeleton from '@/components/admin/AdminStatsSkeleton'
import AdminTableSkeleton from '@/components/admin/AdminTableSkeleton'

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

async function getBusinessCustomers({
  status,
  search,
  page }: {
  status?: string
  search?: string
  page: number
}) {
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

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  approved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }

// Builds a business-customers URL that preserves the active status/search
// filters. Shared by the stat cards, status tabs and pagination.
function buildUrl(
  resolvedSearchParams: SP,
  host: string,
  p: number,
  extra: Record<string, string> = {},
) {
  const params = new URLSearchParams()
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
async function BusinessCustomersStats({
  resolvedSearchParams,
  host }: {
  resolvedSearchParams: SP
  host: string
}) {
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))
  const [{ customers, total }, pendingRows] = await Promise.all([
    getBusinessCustomers({
      status: resolvedSearchParams.status,
      search: resolvedSearchParams.search,
      page }),
    queryMany<{ count: string }>(`SELECT COUNT(*) AS count FROM business_profiles WHERE approval_status='pending'`, []),
  ])
  const pendingCount = pendingRows[0]?.count || '0'

  const cardValue = (s: 'all' | 'pending' | 'approved') =>
    s === 'all' ? total
      : s === 'pending' ? pendingCount
      : customers.filter(c => c.approval_status === s).length

  return (
    <div className="animate-fade-in">
      <div className="grid grid-cols-3 gap-4 mb-6">
        {(['all', 'pending', 'approved'] as const).map(s => (
          <Link
            key={s}
            href={buildUrl(resolvedSearchParams, host, 1, s === 'all' ? {} : { status: s })}
            className={`bg-surface-elevated rounded-lg border p-4 text-center transition-colors ${
              (resolvedSearchParams.status ?? 'all') === s
                ? 'border-accent-500 ring-1 ring-accent-500'
                : 'border-border-default hover:border-accent-300'
            }`}
          >
            <p className="text-xs text-foreground-secondary capitalize">{s}</p>
            <p className="text-2xl font-bold text-foreground mt-0.5">{cardValue(s)}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}

// Runs the FILTERED list query (status, search, page) and renders the table
// plus pagination. Wrapped in a keyed Suspense so it re-shimmers on change.
async function BusinessCustomersListContent({
  resolvedSearchParams,
  host }: {
  resolvedSearchParams: SP
  host: string
}) {
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))
  const { customers, total } = await getBusinessCustomers({
    status: resolvedSearchParams.status,
    search: resolvedSearchParams.search,
    page })
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <>
      {/* Table */}
      <div className="bg-surface-elevated rounded-lg border border-border-default overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-default bg-surface-secondary text-foreground-secondary text-xs uppercase tracking-wide">
              <th className="px-4 py-3 text-left">Company</th>
              <th className="px-4 py-3 text-left">Contact</th>
              <th className="px-4 py-3 text-left">GST</th>
              <th className="px-4 py-3 text-left">Industry</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Joined</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {customers.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-foreground-muted">No business customers found.</td>
              </tr>
            ) : customers.map(c => (
              <tr key={c.user_id} className="hover:bg-surface-secondary transition-colors">
                <td className="px-4 py-3 font-medium">
                  <Link
                    href={ap(`/admin/business/customers/${c.user_id}`, host)}
                    className="text-foreground hover:text-accent-500 transition-colors"
                  >
                    {c.company_name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <p className="text-foreground">{c.first_name} {c.last_name || ''}</p>
                  <p className="text-xs text-foreground-muted">{c.email}</p>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-foreground-secondary">{c.gst_number}</td>
                <td className="px-4 py-3 text-foreground-secondary">{c.industry}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${STATUS_STYLES[c.approval_status] || ''}`}>
                    {c.approval_status.charAt(0).toUpperCase() + c.approval_status.slice(1)}
                  </span>
                </td>
                <td className="px-4 py-3 text-foreground-secondary text-xs">
                  {new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={ap(`/admin/business/customers/${c.user_id}`, host)}
                    className="text-xs font-medium text-accent-600 dark:text-accent-400 hover:underline"
                  >
                    View →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-foreground-secondary">
          <span>{total} total</span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={buildUrl(resolvedSearchParams, host, page - 1)} className="px-3 py-1.5 rounded-lg border border-border-default hover:bg-surface-secondary transition-colors">
                Previous
              </Link>
            )}
            <span className="px-3 py-1.5">Page {page} of {totalPages}</span>
            {page < totalPages && (
              <Link href={buildUrl(resolvedSearchParams, host, page + 1)} className="px-3 py-1.5 rounded-lg border border-border-default hover:bg-surface-secondary transition-colors">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// Keys the table Suspense on the query string so filter/pagination changes
// re-trigger the shimmer while the stats + filters above stay mounted.
function BusinessCustomersListSection({
  resolvedSearchParams,
  host }: {
  resolvedSearchParams: SP
  host: string
}) {
  const key = JSON.stringify(resolvedSearchParams)
  return (
    <Suspense key={key} fallback={<AdminTableSkeleton rows={8} cols={7} />}>
      <BusinessCustomersListContent resolvedSearchParams={resolvedSearchParams} host={host} />
    </Suspense>
  )
}

export default async function BusinessCustomersPage({
  searchParams,
}: {
  searchParams: Promise<SP>
}) {
  // Auth gate runs synchronously in the shell — an unauthorized user is
  // redirected before any content (stats or list) is rendered/streamed.
  const resolvedSearchParams = await searchParams
  const cookieStore = await cookies()
  const token = cookieStore.get('admin_sid')
  const host = await getHost()
  if (!token) redirect(ap('/admin/login', host))
  const session = await verifyToken(token.value).catch(() => null)
  if (!session || !hasScope(session.role, session.scopes || [], 'business_customers:read')) redirect(ap('/admin/dashboard', host))

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Business Customers</h1>
        <p className="text-foreground-secondary mt-1 text-sm">Manage B2B partner accounts, approvals, and discounts</p>
      </div>

      {/* Stats */}
      <Suspense fallback={<AdminStatsSkeleton cards={3} gridClass="grid-cols-3" />}>
        <BusinessCustomersStats resolvedSearchParams={resolvedSearchParams} host={host} />
      </Suspense>

      {/* Filters */}
      <form method="get" className="flex gap-3 mb-4">
        {resolvedSearchParams.status && <input type="hidden" name="status" value={resolvedSearchParams.status} />}
        <input
          type="search"
          name="search"
          defaultValue={resolvedSearchParams.search}
          placeholder="Search by email, company, GST…"
          className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500"
        />
        <button type="submit" className="px-4 py-1.5 text-sm font-medium bg-accent-500 text-white rounded-lg hover:bg-accent-600 transition-colors">
          Search
        </button>
      </form>

      {/* Status tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {['all', 'pending', 'approved', 'rejected'].map(s => (
          <Link
            key={s}
            href={buildUrl(resolvedSearchParams, host, 1, s === 'all' ? {} : { status: s })}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full capitalize transition-colors ${
              (resolvedSearchParams.status ?? 'all') === s
                ? 'bg-accent-500 text-white'
                : 'bg-surface-elevated border border-border-default text-foreground-secondary hover:bg-surface-secondary'
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      <BusinessCustomersListSection resolvedSearchParams={resolvedSearchParams} host={host} />
    </div>
  )
}
