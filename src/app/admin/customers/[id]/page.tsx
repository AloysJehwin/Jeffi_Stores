import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCustomerById } from '@/lib/queries'
import CustomerContactForm from '@/components/admin/CustomerContactForm'
import CustomerActionButton from '@/components/admin/CustomerActionButton'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function CustomerDetailPage({ params }: { params: { id: string } }) {
  let customer: any
  try {
    customer = await getCustomerById(params.id)
  } catch {
    notFound()
  }

  const fullName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unknown'

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Link href="/admin/customers" className="text-accent-500 hover:text-accent-600 text-sm">
          ← Back to Customers
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 mt-2">{fullName}</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-5 space-y-3">
          <h2 className="font-semibold text-foreground text-lg">Customer Info</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Email</span>
              <span className="text-foreground font-medium">{customer.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Phone</span>
              <span className="text-foreground">{customer.phone || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Customer Type</span>
              <span className="text-foreground capitalize">{customer.customer_type || 'retail'}</span>
            </div>
            {customer.company_name && (
              <div className="flex justify-between">
                <span className="text-foreground-secondary">Company</span>
                <span className="text-foreground">{customer.company_name}</span>
              </div>
            )}
            {customer.gst_number && (
              <div className="flex justify-between">
                <span className="text-foreground-secondary">GST</span>
                <span className="text-foreground">{customer.gst_number}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Joined</span>
              <span className="text-foreground">{new Date(customer.created_at).toLocaleDateString('en-IN', { dateStyle: 'long' })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Orders</span>
              <span className="text-foreground">{Number(customer.recent_orders?.length || 0)}</span>
            </div>
          </div>

          <div className="pt-2 border-t border-border-default">
            <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
              customer.is_flagged
                ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                : customer.is_active
                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                : 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
            }`}>
              {customer.is_flagged ? 'Flagged' : customer.is_active ? 'Active' : 'Inactive'}
            </span>
            {customer.is_flagged && customer.flag_reason && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-2">{customer.flag_reason}</p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-5">
            <h2 className="font-semibold text-foreground text-lg mb-3">Actions</h2>
            <CustomerActionButton
              customerId={customer.id}
              customerName={fullName}
              isActive={customer.is_active}
              isFlagged={customer.is_flagged}
            />
          </div>

          <CustomerContactForm customerId={customer.id} />
        </div>
      </div>

      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <div className="px-5 py-4 border-b border-border-default">
          <h2 className="font-semibold text-foreground text-lg">Recent Orders</h2>
        </div>
        {customer.recent_orders && customer.recent_orders.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border-default">
              <thead className="bg-surface-secondary">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Order</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Date</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Total</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {customer.recent_orders.map((order: any) => (
                  <tr key={order.id} className="hover:bg-surface-secondary">
                    <td className="px-5 py-3 text-sm font-medium text-foreground">
                      #{order.order_number || order.id.slice(0, 8)}
                    </td>
                    <td className="px-5 py-3 text-sm text-foreground">
                      {new Date(order.created_at).toLocaleDateString('en-IN')}
                    </td>
                    <td className="px-5 py-3 text-sm font-semibold text-foreground">
                      Rs. {Number(order.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        order.status === 'delivered'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                          : order.status === 'cancelled'
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                          : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
                      }`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-sm">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="text-accent-500 hover:text-accent-600"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-foreground-muted text-sm">No orders yet.</div>
        )}
      </div>
    </div>
  )
}
