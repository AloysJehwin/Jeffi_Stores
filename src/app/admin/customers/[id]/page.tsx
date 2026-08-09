import Link from 'next/link'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { getCustomerById } from '@/lib/queries'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { hasScope } from '@/lib/scopes'
import CustomerActionButton from '@/components/admin/CustomerActionButton'
import CustomerMailerPanel from '@/components/admin/CustomerMailerPanel'
import AdminSupportChat from '@/components/admin/AdminSupportChat'
import CustomerTags from '@/components/admin/CustomerTags'
import CustomerNotes from '@/components/admin/CustomerNotes'
import CustomerTasks from '@/components/admin/CustomerTasks'
import CustomerTimeline from '@/components/admin/CustomerTimeline'
import HealthScoreCard from '@/components/admin/HealthScoreCard'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function formatOrderStatus(status: string) {
  const map: Record<string, string> = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    processing: 'Processing',
    dispatched: 'Dispatched',
    shipped: 'Shipped',
    out_for_delivery: 'Out for Delivery',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    return_requested: 'Return Requested',
    return_approved: 'Return Approved',
    return_rejected: 'Return Rejected',
    return_picked_up: 'Picked Up',
    refunded: 'Refunded',
    replaced: 'Replaced' }
  return map[status] || status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatPaymentStatus(status: string) {
  const map: Record<string, string> = {
    paid: 'Paid',
    pending: 'Pending',
    failed: 'Failed',
    refunded: 'Refunded',
    partial_refund: 'Part Refunded',
    cod: 'COD' }
  return map[status] || status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function orderStatusBadge(status: string) {
  if (['delivered', 'replaced'].includes(status))
    return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
  if (['cancelled', 'return_rejected'].includes(status))
    return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
  if (['shipped', 'dispatched', 'out_for_delivery'].includes(status))
    return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
  if (['return_requested', 'return_approved', 'return_picked_up', 'refunded'].includes(status))
    return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
  return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
}

function paymentStatusBadge(status: string) {
  if (status === 'paid') return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
  if (status === 'refunded' || status === 'partial_refund') return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
  if (status === 'failed') return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
  return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
}

const SEGMENT_LABELS: Record<string, { label: string; color: string }> = {
  vip:      { label: 'VIP',           color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  loyal:    { label: 'Loyal',         color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  repeat:   { label: 'Repeat Buyer',  color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  one_time: { label: 'One-time',      color: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  new:      { label: 'New',           color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  at_risk:  { label: 'At Risk',       color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
  dormant:  { label: 'Dormant',       color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  b2b:      { label: 'B2B',           color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
  lead:     { label: 'Lead',          color: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300' } }

export default async function CustomerDetailPage({
  params,
  searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ chat?: string; back?: string }>
}) {
  const { id } = await params
  const resolvedSearchParams = await searchParams
  const host = await getHost()
  const back = resolvedSearchParams?.back
  const backUrl = back && back.startsWith('/admin/customers') ? back : '/admin/customers'
  let customer: any
  try {
    customer = await getCustomerById(id)
  } catch {
    notFound()
  }

  const h = await headers()
  const role = h.get('x-user-role') || ''
  const scopes: string[] = JSON.parse(h.get('x-user-scopes') || '[]')
  const canWrite = hasScope(role, scopes, 'customers:write')

  const fullName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unknown'
  const initials = [customer.first_name?.[0], customer.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?'
  const currentStatus: 'active' | 'inactive' | 'flagged' = customer.is_flagged
    ? 'flagged'
    : customer.is_active
    ? 'active'
    : 'inactive'

  const statusBadge = {
    active: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
    inactive: 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300',
    flagged: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' }

  return (
    <div className="p-4 sm:p-6 max-w-full space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-foreground-secondary">
        <Link href={ap(backUrl, host)} className="text-accent-500 hover:text-accent-600 transition-colors">
          Customers
        </Link>
        <span>/</span>
        <span className="text-foreground">{fullName}</span>
      </div>

      {/* Header card — neutral dark, not accent */}
      <div className="bg-zinc-800 dark:bg-zinc-900 rounded-2xl p-6 text-white shadow-md border border-zinc-700 dark:border-zinc-800">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-zinc-600 dark:bg-zinc-700 flex items-center justify-center text-xl font-bold shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold">{fullName}</h1>
              <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${statusBadge[currentStatus]}`}>
                {currentStatus.charAt(0).toUpperCase() + currentStatus.slice(1)}
              </span>
              {customer.user_type === 'business' && (
                <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${
                  customer.bp_approval_status === 'approved' ? 'bg-blue-500/20 text-blue-200'
                  : customer.bp_approval_status === 'rejected' ? 'bg-red-500/20 text-red-300'
                  : 'bg-amber-500/20 text-amber-200'
                }`}>
                  Business Partner{customer.bp_approval_status !== 'approved' ? ` · ${customer.bp_approval_status === 'rejected' ? 'Rejected' : 'Pending'}` : ''}
                </span>
              )}
              {customer.customer_type && customer.customer_type !== 'retail' && (
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-white/10 text-white/80 capitalize">
                  {customer.customer_type}
                </span>
              )}
            </div>
            <p className="text-zinc-400 text-sm mt-0.5">{customer.email}</p>
            {customer.phone && (
              <p className="text-zinc-500 text-xs mt-0.5">+91 {customer.phone}</p>
            )}
            {customer.segments && customer.segments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {customer.segments.map((seg: string) => {
                  const meta = SEGMENT_LABELS[seg] ?? { label: seg, color: 'bg-zinc-100 text-zinc-700' }
                  return (
                    <span key={seg} className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${meta.color}`}>
                      {meta.label}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white/5 rounded-xl p-3.5 border border-white/10">
            <p className="text-zinc-400 text-[10px] uppercase tracking-widest font-medium">Total Orders</p>
            <p className="text-white font-bold text-2xl mt-1">{Number(customer.total_orders).toLocaleString('en-IN')}</p>
          </div>
          <div className="bg-white/5 rounded-xl p-3.5 border border-white/10">
            <p className="text-zinc-400 text-[10px] uppercase tracking-widest font-medium">Lifetime Spend</p>
            <p className="text-white font-bold text-2xl mt-1">
              ₹{Number(customer.lifetime_value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="bg-white/5 rounded-xl p-3.5 border border-white/10">
            <p className="text-zinc-400 text-[10px] uppercase tracking-widest font-medium">Avg. Order</p>
            <p className="text-white font-bold text-2xl mt-1">
              {Number(customer.total_orders) > 0
                ? `₹${Math.round(Number(customer.lifetime_value) / Number(customer.total_orders)).toLocaleString('en-IN')}`
                : '—'}
            </p>
          </div>
          <div className="bg-white/5 rounded-xl p-3.5 border border-white/10">
            <p className="text-zinc-400 text-[10px] uppercase tracking-widest font-medium">Member Since</p>
            <p className="text-white font-semibold text-sm mt-2 leading-tight">
              {new Date(customer.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
          </div>
        </div>
      </div>

      {/* Flag warning */}
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

      {/* Assigned coupons banner */}
      {customer.assigned_coupons && customer.assigned_coupons.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 10V5a2 2 0 012-2z" />
            </svg>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {customer.assigned_coupons.length} Personal Coupon{customer.assigned_coupons.length > 1 ? 's' : ''} Assigned
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {customer.assigned_coupons.map((c: { id: string; code: string; discount_type: string; discount_value: number; valid_until: string | null; times_used: number; description: string | null }) => (
              <div key={c.id} className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg text-xs">
                <span className="font-mono font-bold text-amber-800 dark:text-amber-200">{c.code}</span>
                <span className="text-amber-600 dark:text-amber-400">
                  {c.discount_type === 'percentage' ? `${c.discount_value}% off` : `₹${c.discount_value} off`}
                </span>
                {c.times_used > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 font-semibold">Used</span>
                )}
                {c.valid_until && (
                  <span className="text-amber-500 dark:text-amber-500">
                    until {new Date(c.valid_until).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main content — 3-col layout on wide screens */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Left column: Actions + Business details + Contact */}
        <div className="space-y-5">
          {/* Health Score */}
          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <HealthScoreCard customerId={customer.id} initial={customer.health || null} />
          </div>

          {/* Account Actions */}
          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Account Actions</h2>
            {canWrite ? (
              <CustomerActionButton
                customerId={customer.id}
                customerName={fullName}
                isActive={customer.is_active}
                isFlagged={customer.is_flagged}
              />
            ) : (
              <p className="text-xs text-foreground-muted">Read-only access — cannot modify account.</p>
            )}
          </div>

          {/* Tags */}
          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <CustomerTags customerId={customer.id} initialTags={customer.tags || []} canWrite={canWrite} />
          </div>

          {/* Internal Notes */}
          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <CustomerNotes customerId={customer.id} initialNotes={customer.notes || []} canWrite={canWrite} />
          </div>

          {/* Tasks */}
          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <CustomerTasks customerId={customer.id} canWrite={canWrite} />
          </div>

          {/* Business details (customer_profiles) */}
          {(customer.company_name || customer.gst_number || customer.credit_limit) && (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
              <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-3">Business Details</h2>
              <div className="space-y-3 text-sm">
                {customer.company_name && (
                  <div>
                    <p className="text-foreground-muted text-xs mb-0.5">Company</p>
                    <p className="text-foreground font-medium">{customer.company_name}</p>
                  </div>
                )}
                {customer.gst_number && (
                  <div>
                    <p className="text-foreground-muted text-xs mb-0.5">GST Number</p>
                    <p className="text-foreground font-medium font-mono tracking-wide">{customer.gst_number}</p>
                  </div>
                )}
                {customer.credit_limit && (
                  <div>
                    <p className="text-foreground-muted text-xs mb-0.5">Credit Limit</p>
                    <p className="text-foreground font-semibold">₹{Number(customer.credit_limit).toLocaleString('en-IN')}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Business Partner Profile (business_profiles) */}
          {customer.user_type === 'business' && customer.bp_company_name && (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">Business Partner</h2>
                <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${
                  customer.bp_approval_status === 'approved' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : customer.bp_approval_status === 'rejected' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                  : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                }`}>
                  {customer.bp_approval_status === 'approved' ? 'Approved' : customer.bp_approval_status === 'rejected' ? 'Rejected' : 'Pending'}
                </span>
              </div>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-foreground-muted text-xs mb-0.5">Company</p>
                  <p className="text-foreground font-medium">{customer.bp_company_name}</p>
                </div>
                {customer.bp_gst_number && (
                  <div>
                    <p className="text-foreground-muted text-xs mb-0.5">GST Number</p>
                    <p className="text-foreground font-medium font-mono tracking-wide">{customer.bp_gst_number}</p>
                  </div>
                )}
                {customer.bp_industry && (
                  <div>
                    <p className="text-foreground-muted text-xs mb-0.5">Industry</p>
                    <p className="text-foreground">{customer.bp_industry}</p>
                  </div>
                )}
                {customer.bp_business_address && (
                  <div>
                    <p className="text-foreground-muted text-xs mb-0.5">Business Address</p>
                    <p className="text-foreground">{customer.bp_business_address}</p>
                  </div>
                )}
                {customer.bp_created_at && (
                  <div>
                    <p className="text-foreground-muted text-xs mb-0.5">Applied</p>
                    <p className="text-foreground">{new Date(customer.bp_created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                  </div>
                )}
                {customer.bp_approved_at && customer.bp_approval_status === 'approved' && (
                  <div>
                    <p className="text-foreground-muted text-xs mb-0.5">Approved On</p>
                    <p className="text-foreground">{new Date(customer.bp_approved_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                  </div>
                )}
                {customer.bp_rejection_note && customer.bp_approval_status === 'rejected' && (
                  <div>
                    <p className="text-foreground-muted text-xs mb-0.5">Rejection Note</p>
                    <p className="text-red-700 dark:text-red-400">{customer.bp_rejection_note}</p>
                  </div>
                )}
                <div className="pt-2 border-t border-border-default">
                  <Link
                    href={ap(`/admin/business/customers/${customer.id}`, host)}
                    className="text-xs text-accent-500 hover:text-accent-600 font-medium"
                  >
                    Manage in Business Customers →
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Support chat */}
          <AdminSupportChat customerId={customer.id} autoOpen={resolvedSearchParams.chat === 'true'} />
        </div>

        {/* Right column: Timeline + Orders table (spans 2 cols) */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <CustomerTimeline customerId={customer.id} />
          </div>
          <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
            <div className="px-5 py-4 border-b border-border-default flex items-center justify-between">
              <h2 className="font-semibold text-foreground text-base">Orders</h2>
              {Number(customer.total_orders) > 10 && (
                <Link
                  href={ap(`/admin/orders?customer=${customer.id}`, host)}
                  className="text-xs text-accent-500 hover:text-accent-600 font-medium"
                >
                  View all {Number(customer.total_orders)} →
                </Link>
              )}
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
                      <th className="px-5 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {customer.recent_orders.map((order: any) => (
                      <tr key={order.id} className="hover:bg-surface-secondary/60 transition-colors">
                        <td className="px-5 py-3.5 text-sm font-semibold text-foreground whitespace-nowrap">
                          #{order.order_number || order.id.slice(0, 8)}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-foreground-secondary whitespace-nowrap">
                          {new Date(order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="px-5 py-3.5 text-sm font-semibold text-foreground whitespace-nowrap">
                          ₹{Number(order.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`px-2 py-0.5 inline-flex text-xs font-semibold rounded-full whitespace-nowrap ${paymentStatusBadge(order.payment_status)}`}>
                            {formatPaymentStatus(order.payment_status)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`px-2 py-0.5 inline-flex text-xs font-semibold rounded-full whitespace-nowrap ${orderStatusBadge(order.status)}`}>
                            {formatOrderStatus(order.status)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right text-sm">
                          <Link
                            href={ap(`/admin/orders/${order.id}`, host)}
                            className="text-accent-500 hover:text-accent-600 font-medium text-xs"
                          >
                            View →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-16 text-center">
                <p className="text-foreground-muted text-sm">No orders yet.</p>
              </div>
            )}
          </div>

          {/* Send Mailer */}
          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">Send Mailer</h2>
            <CustomerMailerPanel
              customerId={customer.id}
              customerName={fullName}
              customerEmail={customer.email}
              segments={customer.segments}
              healthScore={customer.health?.score ?? null}
              totalOrders={customer.total_orders}
              lifetimeValue={customer.lifetime_value}
              daysSinceLastOrder={customer.days_since_last_order}
              lastOrderAt={customer.last_order_at}
              recentOrders={customer.recent_orders ?? []}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
