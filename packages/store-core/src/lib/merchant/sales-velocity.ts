import { queryMany } from '@/lib/shared/db'
import { buildVelocity, VELOCITY_WINDOW_DAYS, type SalesVelocity } from './custom-labels'

/** Paid, kept units per SKU over the window (one query for the whole catalogue). Never throws. */
export async function loadSalesVelocity(windowDays = VELOCITY_WINDOW_DAYS): Promise<SalesVelocity> {
  let rows: { sku: string; units: string }[] = []
  try {
    rows =
      (await queryMany<{ sku: string; units: string }>(
        `SELECT lower(COALESCE(v.sku, p.sku)) AS sku, SUM(oi.quantity) AS units
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id
         LEFT JOIN product_variants v ON v.id = oi.variant_id
         WHERE o.payment_status = 'paid' AND o.status NOT IN ('cancelled', 'returned', 'draft', 'cancel_rejected')
           AND o.created_at >= now() - make_interval(days => $1::int)
         GROUP BY 1`,
        [windowDays]
      )) ?? []
  } catch {
    rows = []
  }
  return buildVelocity(
    rows.map(r => ({ sku: r.sku, units: Number(r.units) || 0 })),
    windowDays
  )
}
