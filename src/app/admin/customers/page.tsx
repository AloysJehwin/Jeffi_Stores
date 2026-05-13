import Link from 'next/link'
import { getCustomers } from '@/lib/queries'
import AdminFilters from '@/components/admin/AdminFilters'
import Pagination from '@/components/admin/Pagination'
import CustomersTableRows from '@/components/admin/CustomersTableRows'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

export default async function CustomersPage({ searchParams }: { searchParams: { [key: string]: string | undefined } }) {
  const page = Math.max(1, parseInt(searchParams.page || '1', 10))

  const [{ customers, total }, allStats] = await Promise.all([
    getCustomers({ search: searchParams.search, status: searchParams.status, page, limit: PAGE_SIZE }),
    getCustomers({}),
  ])

  const activeCount = allStats.customers?.filter((c: any) => c.is_active && !c.is_flagged).length || 0
  const inactiveCount = allStats.customers?.filter((c: any) => !c.is_active && !c.is_flagged).length || 0
  const flaggedCount = allStats.customers?.filter((c: any) => c.is_flagged).length || 0

  const buildUrl = (p: number) => {
    const params = new URLSearchParams()
    if (searchParams.status) params.set('status', searchParams.status)
    if (searchParams.search) params.set('search', searchParams.search)
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return `/admin/customers${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Customers</h1>
        <p className="text-foreground-secondary mt-1 text-sm">View and manage customer accounts</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 mb-6">
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Total Customers</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground mt-2">{allStats.total}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Active</p>
          <p className="text-2xl sm:text-3xl font-bold text-green-500 mt-2">{activeCount}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Inactive</p>
          <p className="text-2xl sm:text-3xl font-bold text-orange-500 mt-2">{inactiveCount}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Flagged</p>
          <p className="text-2xl sm:text-3xl font-bold text-red-500 mt-2">{flaggedCount}</p>
        </div>
      </div>

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
        ]}
        searchPlaceholder="Search by name, email or phone..."
        searchParam="search"
      />

      <div className="md:hidden space-y-3">
        {customers && customers.length > 0 ? (
          customers.map((customer: any) => (
            <Link
              key={customer.id}
              href={`/admin/customers/${customer.id}`}
              className="block bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 active:bg-surface-secondary transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-foreground">
                  {[customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unknown'}
                </span>
                <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                  customer.is_flagged ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                  : customer.is_active ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                  : 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
                }`}>
                  {customer.is_flagged ? 'Flagged' : customer.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="text-xs text-foreground-muted">{customer.email}</p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-foreground-muted">{Number(customer.order_count)} orders</span>
                <span className="text-xs text-foreground-muted">Joined {new Date(customer.created_at).toLocaleDateString('en-IN')}</span>
              </div>
            </Link>
          ))
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
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Email</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Phone</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Joined</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Orders</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              <CustomersTableRows customers={customers ?? []} />
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-border-default">
          <Pagination page={page} total={total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />
        </div>
      </div>
    </div>
  )
}
