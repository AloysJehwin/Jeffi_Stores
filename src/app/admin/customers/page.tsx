import { Suspense } from 'react'
import Link from 'next/link'
import { getCustomers, getCustomerStats, getCustomerSegments, getCustomerChannelMix } from '@/lib/queries'
import AdminFilters from '@/components/admin/AdminFilters'
import Pagination from '@/components/admin/Pagination'
import CustomersTableRows from '@/components/admin/CustomersTableRows'
import SortableHeader from '@/components/admin/SortableHeader'
import { sortOptions } from '@/components/admin/sortOptions'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import AdminStatsSkeleton from '@/components/admin/AdminStatsSkeleton'
import AdminTableSkeleton from '@/components/admin/AdminTableSkeleton'
import CustomerEngagementChart from '@/components/admin/CustomerEngagementChart'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

type SP = { [key: string]: string | undefined }

async function CustomersStats() {
  const [stats, segments, channelMix] = await Promise.all([
    getCustomerStats(),
    getCustomerSegments(),
    getCustomerChannelMix(),
  ])

  return (
    <div className="animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6 lg:h-56">
        {/* Left: Total Customers + the 4 customer stats as tiles */}
        <div className="bg-gradient-to-r from-primary-500 to-accent-500 p-4 sm:p-6 rounded-lg shadow-sm flex flex-col justify-between text-white">
          <div>
            <p className="text-white/80 text-sm">Total Customers</p>
            <p className="text-3xl sm:text-4xl font-bold mt-1">{stats.total.toLocaleString('en-IN')}</p>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:gap-3 mt-4">
            <div className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
              <p className="text-lg sm:text-2xl font-bold leading-none">{stats.total}</p>
              <p className="text-[10px] sm:text-xs text-white/80 mt-1">Total</p>
            </div>
            <div className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
              <p className="text-lg sm:text-2xl font-bold leading-none">{stats.active}</p>
              <p className="text-[10px] sm:text-xs text-white/80 mt-1">Active</p>
            </div>
            <div className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
              <p className="text-lg sm:text-2xl font-bold leading-none">{stats.inactive}</p>
              <p className="text-[10px] sm:text-xs text-white/80 mt-1">Inactive</p>
            </div>
            <div className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
              <p className="text-lg sm:text-2xl font-bold leading-none">{stats.flagged}</p>
              <p className="text-[10px] sm:text-xs text-white/80 mt-1">Flagged</p>
            </div>
          </div>
        </div>
        {/* Right: customer engagement chart */}
        <CustomerEngagementChart segments={segments} channelMix={channelMix} />
      </div>
    </div>
  )
}

export default function CustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Customers</h1>
        <p className="text-foreground-secondary mt-1 text-sm">View and manage customer accounts</p>
      </div>

      <Suspense fallback={<AdminStatsSkeleton cards={4} banner={false} />}>
        <CustomersStats />
      </Suspense>

      <AdminFilters
        filters={[
          {
            name: 'status',
            label: 'Status',
            options: [
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
              { value: 'flagged', label: 'Flagged' },
            ],
          },
          {
            name: 'segment',
            label: 'Segment',
            options: [
              { value: 'vip', label: 'VIP (₹50k+)' },
              { value: 'loyal', label: 'Loyal' },
              { value: 'repeat', label: 'Repeat (3+)' },
              { value: 'one_time', label: 'One-time' },
              { value: 'new', label: 'New (<30d)' },
              { value: 'at_risk', label: 'At Risk (90-180d)' },
              { value: 'dormant', label: 'Dormant (180d+)' },
              { value: 'b2b', label: 'B2B' },
              { value: 'lead', label: 'Lead (no orders)' },
            ],
          },
          {
            name: 'health',
            label: 'Health',
            options: [
              { value: 'healthy', label: 'Healthy (≥70)' },
              { value: 'at_risk', label: 'At Risk (40-69)' },
              { value: 'critical', label: 'Critical (<40)' },
              { value: 'unknown', label: 'Not scored' },
            ],
          },
        ]}
        searchPlaceholder="Search by name, email or phone..."
        suggestType="customers"
        searchParam="search"
      />

      <CustomersListSection searchParams={searchParams} />
    </div>
  )
}

// Resolves searchParams (no DB — near-instant) then keys the table Suspense
// on the query string so filter/pagination changes re-trigger the shimmer
// while the stats + filters above stay mounted.
async function CustomersListSection({ searchParams }: { searchParams: Promise<SP> }) {
  const resolvedSearchParams = await searchParams
  const key = JSON.stringify(resolvedSearchParams)
  return (
    <Suspense key={key} fallback={<AdminTableSkeleton rows={8} cols={8} />}>
      <CustomersListContent resolvedSearchParams={resolvedSearchParams} />
    </Suspense>
  )
}

async function CustomersListContent({ resolvedSearchParams }: { resolvedSearchParams: SP }) {
  const host = await getHost()
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))
  const sort = resolvedSearchParams.sort
  const dir = resolvedSearchParams.dir as 'asc' | 'desc' | undefined

  const { customers, total } = await getCustomers({
    search: resolvedSearchParams.search,
    status: resolvedSearchParams.status,
    segment: resolvedSearchParams.segment,
    tag: resolvedSearchParams.tag,
    health: resolvedSearchParams.health,
    page,
    limit: PAGE_SIZE,
    sort,
    dir,
  })

  const buildUrl = (p: number) => {
    const params = new URLSearchParams()
    if (resolvedSearchParams.status) params.set('status', resolvedSearchParams.status)
    if (resolvedSearchParams.search) params.set('search', resolvedSearchParams.search)
    if (resolvedSearchParams.segment) params.set('segment', resolvedSearchParams.segment)
    if (resolvedSearchParams.tag) params.set('tag', resolvedSearchParams.tag)
    if (resolvedSearchParams.health) params.set('health', resolvedSearchParams.health)
    if (sort) params.set('sort', sort)
    if (dir) params.set('dir', dir)
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return ap(`/admin/customers${qs ? `?${qs}` : ''}`, host)
  }

  const currentListUrl = (() => {
    const params = new URLSearchParams()
    if (resolvedSearchParams.status) params.set('status', resolvedSearchParams.status)
    if (resolvedSearchParams.search) params.set('search', resolvedSearchParams.search)
    if (resolvedSearchParams.segment) params.set('segment', resolvedSearchParams.segment)
    if (resolvedSearchParams.tag) params.set('tag', resolvedSearchParams.tag)
    if (resolvedSearchParams.health) params.set('health', resolvedSearchParams.health)
    if (sort) params.set('sort', sort)
    if (dir) params.set('dir', dir)
    if (page > 1) params.set('page', String(page))
    const qs = params.toString()
    return `/admin/customers${qs ? `?${qs}` : ''}`
  })()

  return (
    <>
      <div className="md:hidden space-y-3">
        {customers && customers.length > 0 ? (
          customers.map((customer: any) => {
            const score = customer.health_score
            const barColor =
              score == null
                ? 'bg-zinc-300 dark:bg-zinc-700'
                : score >= 70
                  ? 'bg-green-500'
                  : score >= 40
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
            return (
              <Link
                key={customer.id}
                href={ap(`/admin/customers/${customer.id}`)}
                className="relative block bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 pl-5 active:bg-surface-secondary transition-colors overflow-hidden"
              >
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${barColor}`} aria-hidden />
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-foreground">
                    {[customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unknown'}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {score != null && (
                      <span
                        className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                          score >= 70
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                            : score >= 40
                              ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
                              : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                        }`}
                      >
                        {score}
                      </span>
                    )}
                    {customer.user_type === 'business' && (
                      <span
                        className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                          customer.bp_approval_status === 'approved'
                            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                            : customer.bp_approval_status === 'rejected'
                              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                              : 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'
                        }`}
                      >
                        Biz
                      </span>
                    )}
                    <span
                      className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                        customer.is_flagged
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                          : customer.is_active
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                            : 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
                      }`}
                    >
                      {customer.is_flagged ? 'Flagged' : customer.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-foreground-muted">{customer.email}</p>
                {customer.tags && customer.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {customer.tags.slice(0, 4).map((tag: string) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent-500/10 text-accent-600 dark:text-accent-400"
                      >
                        {tag}
                      </span>
                    ))}
                    {customer.tags.length > 4 && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-surface-secondary text-foreground-muted">
                        +{customer.tags.length - 4}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-foreground-muted">{Number(customer.order_count)} orders</span>
                  <span className="text-xs text-foreground-muted">
                    Joined {new Date(customer.created_at).toLocaleDateString('en-IN')}
                  </span>
                </div>
              </Link>
            )
          })
        ) : (
          <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center text-foreground-muted">
            No customers found.
          </div>
        )}
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />
      </div>

      <div className="hidden md:block bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border-default">
            <thead className="bg-surface-secondary">
              <tr>
                <SortableHeader
                  label="Name"
                  column="name"
                  options={sortOptions('text')}
                  currentSort={sort}
                  currentDir={dir}
                />
                <SortableHeader
                  label="Email"
                  column="email"
                  options={sortOptions('text')}
                  currentSort={sort}
                  currentDir={dir}
                />
                <SortableHeader
                  label="Phone"
                  column="phone"
                  options={sortOptions('text')}
                  currentSort={sort}
                  currentDir={dir}
                />
                <SortableHeader
                  label="Joined"
                  column="joined"
                  options={sortOptions('date')}
                  currentSort={sort}
                  currentDir={dir}
                />
                <SortableHeader
                  label="Orders"
                  column="orders"
                  options={sortOptions('number')}
                  currentSort={sort}
                  currentDir={dir}
                />
                <SortableHeader
                  label="Health"
                  column="health"
                  options={sortOptions('number')}
                  currentSort={sort}
                  currentDir={dir}
                />
                <SortableHeader
                  label="Status"
                  column="status"
                  options={sortOptions('text')}
                  currentSort={sort}
                  currentDir={dir}
                />
                <th className="px-6 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              <CustomersTableRows customers={customers ?? []} backUrl={currentListUrl} />
            </tbody>
          </table>
        </div>
      </div>
      <div className="hidden md:block px-6 py-3 border border-border-default border-t-0 rounded-b-lg bg-surface-elevated">
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />
      </div>
    </>
  )
}
