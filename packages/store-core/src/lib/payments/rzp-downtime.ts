import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { createAdminNotification } from '@/lib/shared/admin-notify'

/**
 * Payment-method outages Razorpay reports (payment.downtime.*). Stored once in the control plane and
 * shown on every admin console; the account whose webhook reported a serious one alerts its admins.
 */

export interface PaymentDowntime {
  id: string
  method: string
  instrument: Record<string, any> | null
  severity: string | null
  status: string
  scheduled: boolean
  begin_at: string | null
  end_at: string | null
}

const METHOD: Record<string, string> = { upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', emi: 'EMI' }

/** "UPI (@ybl)", "Card (VISA, HDFC)", "Net banking (SBI)". */
export function downtimeLabel(d: Pick<PaymentDowntime, 'method' | 'instrument'>): string {
  const parts = Object.values(d.instrument ?? {}).filter(v => typeof v === 'string' && v && v !== 'ALL') as string[]
  return `${METHOD[d.method] ?? d.method}${parts.length ? ` (${parts.join(', ')})` : ''}`
}

const at = (unix: unknown) => (Number(unix) > 0 ? new Date(Number(unix) * 1000).toISOString() : null)

export async function recordDowntime(type: string, d: any, source: string): Promise<void> {
  if (!d?.id) return
  const status = type === 'payment.downtime.resolved' ? 'resolved' : String(d.status || 'started')
  const pool = controlPlanePool()
  await pool.query(
    `INSERT INTO razorpay_downtimes (id, method, instrument, severity, status, scheduled, begin_at, end_at, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET method = EXCLUDED.method, instrument = EXCLUDED.instrument, severity = EXCLUDED.severity,
       status = CASE WHEN razorpay_downtimes.status = 'resolved' THEN 'resolved' ELSE EXCLUDED.status END,
       scheduled = EXCLUDED.scheduled, begin_at = COALESCE(EXCLUDED.begin_at, razorpay_downtimes.begin_at),
       end_at = COALESCE(EXCLUDED.end_at, razorpay_downtimes.end_at), updated_at = now()`,
    [d.id, String(d.method || 'unknown'), d.instrument ? JSON.stringify(d.instrument) : null, d.severity ?? null, status, !!d.scheduled, at(d.begin), at(d.end), source]
  )
  cache = null
  if (status !== 'started') return
  if (d.severity !== 'high' && d.method !== 'upi' && d.method !== 'card') return
  // Once per outage, whichever account reports it first.
  const claim = await pool.query(`UPDATE razorpay_downtimes SET notified_at = now() WHERE id = $1 AND notified_at IS NULL RETURNING id`, [d.id])
  if (!claim.rowCount) return
  const label = downtimeLabel({ method: String(d.method), instrument: d.instrument ?? null })
  createAdminNotification({
    type: 'payment_downtime',
    category: 'finance',
    title: `${label} payments are down at Razorpay`,
    message: `${d.severity ? `${d.severity} severity. ` : ''}Customers paying this way may fail until it is resolved; other methods still work.`,
    link: '/admin/orders',
    entityType: 'razorpay_downtime',
    entityId: d.id,
    severity: d.severity === 'high' ? 'critical' : 'warning',
    scope: 'orders:read',
  }).catch(() => {})
  const { sendPaymentDowntimeEmail } = await import('@/lib/email')
  sendPaymentDowntimeEmail({ label, severity: d.severity ?? null, beganAt: at(d.begin) }).catch(() => {})
}

let cache: { at: number; rows: PaymentDowntime[] } | null = null

/** Outages in progress, or scheduled to start within the hour. Cached for a minute. */
export async function activeDowntimes(): Promise<PaymentDowntime[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.rows
  const rows = await controlPlanePool()
    .query<PaymentDowntime>(
      `SELECT id, method, instrument, severity, status, scheduled, begin_at, end_at FROM razorpay_downtimes
        WHERE status <> 'resolved' AND updated_at > now() - interval '2 days'
          AND (end_at IS NULL OR end_at > now())
          AND (status = 'started' OR begin_at < now() + interval '1 hour')
        ORDER BY begin_at NULLS LAST LIMIT 10`
    )
    .then(r => r.rows)
    .catch(() => [] as PaymentDowntime[])
  cache = { at: Date.now(), rows }
  return rows
}
