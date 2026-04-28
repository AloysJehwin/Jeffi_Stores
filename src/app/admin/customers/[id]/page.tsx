import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCustomerById } from '@/lib/queries'
import CustomerContactForm from '@/components/admin/CustomerContactForm'
import CustomerActionButton from '@/components/admin/CustomerActionButton'
import AdminSupportChat from '@/components/admin/AdminSupportChat'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function CustomerDetailPage({ params, searchParams }: { params: { id: string }, searchParams: { chat?: string } }) {
  let customer: any
  try {
    customer = await getCustomerById(params.id)
  } catch {
    notFound()
  }

  const fullName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unknown'
  const initials = [customer.first_name?.[0], customer.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?'
  const currentStatus: 'active' | 'inactive' | 'flagged' = customer.is_flagged ? 'flagged' : customer.is_active ? 'active' : 'inactive'

  const statusColors = {
    active: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
    inactive: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300',
    flagged: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300',
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-foreground-secondary">
        <Link href="/admin/customers" className="text-accent-500 hover:text-accent-600">Customers</Link>
        <span>/</span>
        <span className="text-foreground">{fullName}</span>
      </div>

      <div className="bg-gradient-to-r from-accent-500 to-accent-600 rounded-xl p-6 text-white shadow-md">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center text-2xl font-bold shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold truncate">{fullName}</h1>
            <p className="text-white/80 text-sm mt-0.5 truncate">{customer.email}</p>
          </div>
          <span className={`px-3 py-1 text-xs font-semibold rounded-full shrink-0 ${statusColors[currentStatus]}`}>
            {currentStatus.charAt(0).toUpperCase() + currentStatus.slice(1)}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white/10 rounded-lg p-3">
            <p className="text-white/60 text-xs uppercase tracking-wide">Phone</p>
            <p className="text-white font-semibold text-sm mt-0.5">{customer.phone || '—'}</p>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <p className="text-white/60 text-xs uppercase tracking-wide">Type</p>
            <p className="text-white font-semibold text-sm mt-0.5 capitalize">{customer.customer_type || 'Retail'}</p>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <p className="text-white/60 text-xs uppercase tracking-wide">Orders</p>
            <p className="text-white font-semibold text-sm mt-0.5">{customer.recent_orders?.length ?? 0}</p>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <p className="text-white/60 text-xs uppercase tracking-wide">Joined</p>
            <p className="text-white font-semibold text-sm mt-0.5">
              {new Date(customer.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
          </div>
        </div>
      </div>

      {(customer.company_name || customer.gst_number || customer.credit_limit) && (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-sm font-semibold text-foreground-secondary uppercase tracking-wide mb-3">Business Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            {customer.company_name && (
              <div>
                <p className="text-foreground-muted text-xs">Company</p>
                <p className="text-foreground font-medium mt-0.5">{customer.company_name}</p>
              </div>
            )}
            {customer.gst_number && (
              <div>
                <p className="text-foreground-muted text-xs">GST Number</p>
                <p className="text-foreground font-medium mt-0.5 font-mono">{customer.gst_number}</p>
              </div>
            )}
            {customer.credit_limit && (
              <div>
                <p className="text-foreground-muted text-xs">Credit Limit</p>
                <p className="text-foreground font-medium mt-0.5">Rs. {Number(customer.credit_limit).toLocaleString('en-IN')}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {customer.is_flagged && customer.flag_reason && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex gap-3 items-start">
          <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">Account Flagged</p>
            <p className="text-sm text-red-700 dark:text-red-400 mt-0.5">{customer.flag_reason}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <h2 className="font-semibold text-foreground text-base mb-4">Account Actions</h2>
          <CustomerActionButton
            customerId={customer.id}
            customerName={fullName}
            isActive={customer.is_active}
            isFlagged={customer.is_flagged}
          />
        </div>

        <CustomerContactForm customerId={customer.id} />
      </div>

      <AdminSupportChat customerId={customer.id} autoOpen={searchParams.chat === 'true'} />

      <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
        <div className="px-5 py-4 border-b border-border-default">
          <h2 className="font-semibold text-foreground text-base">Recent Orders</h2>
        </div>
        {customer.recent_orders && customer.recent_orders.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border-default">
              <thead className="bg-surface-secondary">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Order #</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Date</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Total</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Payment</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {customer.recent_orders.map((order: any) => (
                  <tr key={order.id} className="hover:bg-surface-secondary transition-colors">
                    <td className="px-5 py-3 text-sm font-medium text-foreground">
                      #{order.order_number || order.id.slice(0, 8)}
                    </td>
                    <td className="px-5 py-3 text-sm text-foreground-secondary">
                      {new Date(order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-5 py-3 text-sm font-semibold text-foreground">
                      Rs.{Number(order.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 inline-flex text-xs font-semibold rounded-full ${
                        order.payment_status === 'paid'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                          : order.payment_status === 'refunded'
                          ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                          : order.payment_status === 'failed'
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                          : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
                      }`}>
                        {order.payment_status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 inline-flex text-xs font-semibold rounded-full ${
                        order.status === 'delivered'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                          : order.status === 'cancelled'
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                          : order.status === 'shipped'
                          ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                          : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
                      }`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-sm">
                      <Link href={`/admin/orders/${order.id}`} className="text-accent-500 hover:text-accent-600 font-medium">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center text-foreground-muted text-sm">No orders yet.</div>
        )}
      </div>
    </div>
  )
}
