import { AlertTriangle } from 'lucide-react'
import { activeDowntimes, downtimeLabel } from '@/lib/payments/rzp-downtime'

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : null

/** Razorpay's current payment-method outages, above every admin page. */
export default async function PaymentDowntimeBanner() {
  const rows = await activeDowntimes()
  if (!rows.length) return null
  return (
    <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-300">
      {rows.map(d => (
        <div key={d.id} className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>{downtimeLabel(d)}</strong>{' '}
            {d.status === 'started'
              ? `payments are failing at Razorpay${d.begin_at ? ` since ${fmt(d.begin_at)}` : ''}`
              : `payments have scheduled downtime from ${fmt(d.begin_at)}${d.end_at ? ` to ${fmt(d.end_at)}` : ''}`}
            {d.severity === 'high' ? ' (severe)' : ''}. Other payment methods still work.
          </span>
        </div>
      ))}
    </div>
  )
}
