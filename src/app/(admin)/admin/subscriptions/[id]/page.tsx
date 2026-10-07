import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { getAdminSubscriptionDetail } from '@/lib/queries/subscriptions'
import { SUBSCRIPTION_STATUS_BADGE, fmtDate, inr } from '../_status'
import SubscriptionActions from './SubscriptionActions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type Sub = Record<string, unknown>
const str = (v: unknown) => (v == null ? null : String(v))

export default async function SubscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [detail, host] = await Promise.all([getAdminSubscriptionDetail(id), getHost()])
  if (!detail) notFound()
  const { subscription: s, customer, product, cycles } = detail
  const sub = s as Sub & typeof s
  const status = String(sub.status)
  const snap = (sub.address_snapshot ?? null) as Record<string, string | undefined> | null
  const address = snap
    ? {
        name: snap.full_name ?? snap.name,
        line1: snap.address_line1 ?? snap.line1,
        city: snap.city,
        state: snap.state,
        pincode: snap.postal_code ?? snap.pincode,
      }
    : null

  const fields: [string, React.ReactNode][] = [
    ['Plan', `${sub.intervalLabel}${Number(sub.quantity) > 1 ? ` × ${Number(sub.quantity)}` : ''}`],
    ['Per cycle', inr(sub.amount)],
    ['Shipping / cycle', inr(Number(sub.shipping_paise || 0) / 100)],
    ['Type', sub.is_digital ? 'Digital' : 'Physical'],
    ['Cycles paid', `${sub.current_cycle}${sub.totalCycles ? ` of ${sub.totalCycles}` : ' (until cancelled)'}`],
    [
      'Commitment',
      sub.min_cycles ? `Minimum ${sub.min_cycles} charges (customer can't cancel or pause before)` : 'None',
    ],
    ['Current period', `${fmtDate(str(sub.current_start))} – ${fmtDate(str(sub.current_end))}`],
    ['Access until', fmtDate(str(sub.access_expires_at))],
    ['Collected by', sub.collecting_account === 'own' ? 'Store Razorpay account' : 'Platform (Jeffi)'],
    ['Razorpay ID', str(sub.razorpay_subscription_id) || '—'],
    ['Consent', sub.consent_at ? `${sub.consent_version ?? ''} · ${fmtDate(str(sub.consent_at))}` : '—'],
    ['Started', fmtDate(str(sub.created_at))],
  ]
  if (sub.paused_at) fields.push(['Paused', fmtDate(str(sub.paused_at))])
  if (sub.cancelled_at) fields.push(['Cancelled', fmtDate(str(sub.cancelled_at))])

  const th = 'px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider'
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <Link href={ap('/admin/subscriptions', host)} className="text-sm text-accent-600 hover:underline">
          ← Subscriptions
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-2">
          <div>
            <h1 className="text-2xl font-bold text-secondary-500 dark:text-foreground">{product?.name ?? 'Subscription'}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SUBSCRIPTION_STATUS_BADGE[status] ?? ''}`}>
                {sub.statusLabel}
              </span>
              {sub.cancel_at_cycle_end && status !== 'cancelled' ? (
                <span className="text-xs text-red-600">Cancels at cycle end</span>
              ) : null}
            </div>
          </div>
          <SubscriptionActions id={id} status={status} cancelAtCycleEnd={!!sub.cancel_at_cycle_end} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-surface-elevated rounded-lg border border-border-default p-4 sm:p-6">
          <h2 className="font-semibold mb-4">Details</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {fields.map(([k, v]) => (
              <div key={k}>
                <dt className="text-foreground-muted">{k}</dt>
                <dd className="font-medium break-all">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="space-y-6">
          <div className="bg-surface-elevated rounded-lg border border-border-default p-4 sm:p-6 text-sm">
            <h2 className="font-semibold mb-3">Customer</h2>
            {customer ? (
              <>
                <Link href={ap(`/admin/customers/${customer.id}`, host)} className="font-medium text-accent-600 hover:underline">
                  {customer.name}
                </Link>
                {customer.email && <p className="text-foreground-secondary">{customer.email}</p>}
                {customer.phone && <p className="text-foreground-secondary">{customer.phone}</p>}
              </>
            ) : (
              <p className="text-foreground-muted">Unknown customer</p>
            )}
          </div>
          {address && (
            <div className="bg-surface-elevated rounded-lg border border-border-default p-4 sm:p-6 text-sm">
              <h2 className="font-semibold mb-3">Delivery address</h2>
              <p>{address.name}</p>
              <p className="text-foreground-secondary">
                {[address.line1, address.city, address.state, address.pincode].filter(Boolean).join(', ')}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-surface-elevated rounded-lg border border-border-default overflow-hidden">
        <h2 className="font-semibold p-4 sm:px-6">Cycles</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary">
              <tr>
                <th className={th}>Cycle</th>
                <th className={th}>Charged</th>
                <th className={th}>Amount</th>
                <th className={th}>Payment</th>
                <th className={th}>Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {cycles.map(c => (
                <tr key={c.id}>
                  <td className="px-4 py-3">#{c.cycleNumber}</td>
                  <td className="px-4 py-3">{fmtDate(c.createdAt)}</td>
                  <td className="px-4 py-3">{inr(c.amount)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{c.razorpayPaymentId}</td>
                  <td className="px-4 py-3">
                    {c.order ? (
                      <Link href={ap(`/admin/orders/${c.order.id}`, host)} className="text-accent-600 hover:underline">
                        {c.order.orderNumber}
                      </Link>
                    ) : (
                      <span className="text-foreground-muted">{c.status}</span>
                    )}
                    {c.order && <span className="ml-2 text-xs text-foreground-muted">{c.order.status}</span>}
                  </td>
                </tr>
              ))}
              {cycles.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-foreground-muted">
                    No cycles charged yet
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
