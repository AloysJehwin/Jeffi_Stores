export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { redirect } from 'next/navigation'
import { queryMany } from '@/lib/shared/db'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import AdminTableSkeleton from '@/components/admin/AdminTableSkeleton'
import { adminCookieName } from '@/lib/auth/admin-cookie'

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

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  reviewed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  negotiating: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  offer_accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  converted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
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
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    Object.entries(extra).forEach(([k, v]) => params.set(k, v))
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return ap(`/admin/business/rfqs${qs ? `?${qs}` : ''}`, host)
  }

  const key = JSON.stringify(resolvedSearchParams)

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Business RFQs</h1>
        <p className="text-foreground-secondary mt-1 text-sm">
          Review and respond to quote requests from business partners
        </p>
      </div>

      {/* Filters */}
      <form method="get" className="flex gap-3 mb-4">
        {status && <input type="hidden" name="status" value={status} />}
        <input
          type="search"
          name="search"
          defaultValue={search}
          placeholder="Search by RFQ number, company, email…"
          className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-border-default bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500"
        />
        <button
          type="submit"
          className="px-4 py-1.5 text-sm font-medium bg-accent-500 text-white rounded-lg hover:bg-accent-600 transition-colors"
        >
          Search
        </button>
      </form>

      {/* Status tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {['all', 'pending', 'reviewed', 'negotiating', 'offer_accepted', 'converted', 'rejected'].map(s => (
          <Link
            key={s}
            href={tabUrl(1, s === 'all' ? {} : { status: s })}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
              (status ?? 'all') === s
                ? 'bg-accent-500 text-white'
                : 'bg-surface-elevated border border-border-default text-foreground-secondary hover:bg-surface-secondary'
            }`}
          >
            {STATUS_LABELS[s] ?? s}
          </Link>
        ))}
      </div>

      {/* Table — re-shimmers on filter/pagination change while shell stays mounted */}
      <Suspense key={key} fallback={<AdminTableSkeleton rows={8} cols={7} />}>
        <BusinessRFQsListContent resolvedSearchParams={resolvedSearchParams} host={host} />
      </Suspense>
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
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const buildUrl = (p: number, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (search) params.set('search', search)
    Object.entries(extra).forEach(([k, v]) => params.set(k, v))
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return ap(`/admin/business/rfqs${qs ? `?${qs}` : ''}`, host)
  }

  return (
    <>
      {/* Table */}
      <div className="bg-surface-elevated rounded-lg border border-border-default overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-default bg-surface-secondary text-foreground-secondary text-xs uppercase tracking-wide">
              <th className="px-4 py-3 text-left">RFQ #</th>
              <th className="px-4 py-3 text-left">Company</th>
              <th className="px-4 py-3 text-left">Contact</th>
              <th className="px-4 py-3 text-center">Items</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Submitted</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {rfqs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-foreground-muted">
                  No RFQs found.
                </td>
              </tr>
            ) : (
              rfqs.map(rfq => (
                <tr key={rfq.id} className="hover:bg-surface-secondary transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-semibold">
                    <Link
                      href={ap(`/admin/business/rfqs/${rfq.id}`, host)}
                      className="text-foreground hover:text-accent-500 hover:underline transition-colors"
                    >
                      {rfq.rfq_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">{rfq.company_name || '—'}</td>
                  <td className="px-4 py-3">
                    <p className="text-foreground">
                      {rfq.first_name} {rfq.last_name || ''}
                    </p>
                    <p className="text-xs text-foreground-muted">{rfq.email}</p>
                  </td>
                  <td className="px-4 py-3 text-center text-foreground-secondary">{rfq.item_count}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 text-xs font-semibold rounded-full ${STATUS_STYLES[rfq.status] || 'bg-surface-secondary text-foreground-secondary'}`}
                    >
                      {STATUS_LABELS[rfq.status] ?? rfq.status.charAt(0).toUpperCase() + rfq.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground-secondary text-xs">
                    {new Date(rfq.created_at).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={ap(`/admin/business/rfqs/${rfq.id}`, host)}
                      className="text-xs font-medium text-accent-600 dark:text-accent-400 hover:underline"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-foreground-secondary">
          <span>{total} total</span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={buildUrl(page - 1)}
                className="px-3 py-1.5 rounded-lg border border-border-default hover:bg-surface-secondary transition-colors"
              >
                Previous
              </Link>
            )}
            <span className="px-3 py-1.5">
              Page {page} of {totalPages}
            </span>
            {page < totalPages && (
              <Link
                href={buildUrl(page + 1)}
                className="px-3 py-1.5 rounded-lg border border-border-default hover:bg-surface-secondary transition-colors"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  )
}
