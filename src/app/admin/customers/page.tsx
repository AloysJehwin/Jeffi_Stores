import Link from 'next/link'
import { getCustomers } from '@/lib/queries'
import AdminFilters from '@/components/admin/AdminFilters'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function CustomersPage({ searchParams }: { searchParams: { [key: string]: string | undefined } }) {
  const { customers, total } = await getCustomers({
    search: searchParams.search,
    status: searchParams.status,
  })

  const activeCount = customers?.filter((c: any) => c.is_active && !c.is_flagged).length || 0
  const inactiveCount = customers?.filter((c: any) => !c.is_active && !c.is_flagged).length || 0
  const flaggedCount = customers?.filter((c: any) => c.is_flagged).length || 0

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Customers</h1>
        <p className="text-foreground-secondary mt-1 text-sm">View and manage customer accounts</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 mb-6">
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Total Customers</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground mt-2">{total}</p>
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
                  customer.is_flagged
                    ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                    : customer.is_active
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                    : 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
                }`}>
                  {customer.is_flagged ? 'Flagged' : customer.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="text-xs text-foreground-muted">{customer.email}</p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-foreground-muted">
                  {Number(customer.order_count)} orders
                </span>
                <span className="text-xs text-foreground-muted">
                  Joined {new Date(customer.created_at).toLocaleDateString('en-IN')}
                </span>
              </div>
            </Link>
          ))
        ) : (
          <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center text-foreground-muted">
            No customers found.
          </div>
        )}
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
              {customers && customers.length > 0 ? (
                customers.map((customer: any) => (
                  <tr key={customer.id} className="hover:bg-surface-secondary">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-foreground">
                        {[customer.first_name, customer.last_name].filter(Boolean).join(' ') || '—'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-foreground">{customer.email}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-foreground">{customer.phone || '—'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-foreground">
                        {new Date(customer.created_at).toLocaleDateString('en-IN')}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-foreground">{Number(customer.order_count)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        customer.is_flagged
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                          : customer.is_active
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                          : 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
                      }`}>
                        {customer.is_flagged ? 'Flagged' : customer.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <Link
                        href={`/admin/customers/${customer.id}`}
                        className="text-accent-500 hover:text-accent-600"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-foreground-muted">
                    No customers found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
