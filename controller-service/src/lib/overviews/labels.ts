import type { AttentionItem } from '@/components/admin/overview/kit'
import { queryMany, queryOne } from '@/lib/shared/db'
import { previousPeriod, type Period } from '@/lib/overview/period'
import { BOUNDS, boundArgs, byPeriod, inBoth, n, per, type Row, type StripKpi } from '@/lib/overviews/orders'

// Label printing is not logged, so the strip shows what drives label work: stock received
// (batches and serial units) and products that cannot carry a barcode yet.

export const EXPIRY_WINDOW_DAYS = 30

export interface LabelsSnapshot {
  noBarcode: number
  expiringBatches: number
}

export function labelsAttention(s: LabelsSnapshot): AttentionItem[] {
  const out: AttentionItem[] = []
  if (s.expiringBatches)
    out.push({
      key: 'expiring',
      severity: 'warning',
      title: `${s.expiringBatches} ${s.expiringBatches === 1 ? 'batch expires' : 'batches expire'} within ${EXPIRY_WINDOW_DAYS} days`,
      sub: 'Still in stock',
      href: '/admin/inventory',
    })
  if (s.noBarcode)
    out.push({
      key: 'no_barcode',
      severity: 'info',
      title: `${s.noBarcode} active ${s.noBarcode === 1 ? 'product has' : 'products have'} no barcode or GTIN`,
      sub: 'Labels fall back to the SKU',
      href: '/admin/products',
    })
  return out
}

export async function loadLabelsStrip(period: Period) {
  const args = boundArgs(period)
  const [batches, serials, snap] = await Promise.all([
    queryMany<Row>(
      `WITH ${BOUNDS}
       SELECT ${per('pb.created_at')} AS period, COUNT(*) AS batches,
              COUNT(*) FILTER (WHERE p.perishable) AS perishable
       FROM product_batches pb JOIN products p ON p.id = pb.product_id, b
       WHERE ${inBoth('pb.created_at')}
       GROUP BY 1`,
      args
    ),
    queryMany<Row>(
      `WITH ${BOUNDS}
       SELECT ${per('ps.received_at')} AS period, COUNT(*) AS units
       FROM product_serials ps, b
       WHERE ${inBoth('ps.received_at')}
       GROUP BY 1`,
      args
    ),
    queryOne<Row>(
      `SELECT (SELECT COUNT(*) FROM products p
               WHERE p.is_active AND NULLIF(TRIM(p.barcode), '') IS NULL AND NULLIF(TRIM(p.gtin), '') IS NULL) AS no_barcode,
              (SELECT COUNT(*) FROM product_batches pb
               WHERE pb.quantity_remaining > 0 AND pb.expiry_date IS NOT NULL
                 AND pb.expiry_date <= (NOW() AT TIME ZONE 'Asia/Kolkata')::date + $1::int) AS expiring`,
      [EXPIRY_WINDOW_DAYS]
    ),
  ])
  const b = byPeriod(batches, r => r)
  const s = byPeriod(serials, r => r)
  const snapshot: LabelsSnapshot = { noBarcode: n(snap?.no_barcode), expiringBatches: n(snap?.expiring) }
  const kpis: StripKpi[] = [
    {
      key: 'batches',
      label: 'Batches received',
      value: n(b.current?.batches),
      previous: n(b.previous?.batches),
      format: 'count',
      sub: `${n(b.current?.perishable)} perishable`,
    },
    {
      key: 'serials',
      label: 'Serial units received',
      value: n(s.current?.units),
      previous: n(s.previous?.units),
      format: 'count',
    },
    {
      key: 'expiring',
      label: `Expiring in ${EXPIRY_WINDOW_DAYS} days`,
      value: snapshot.expiringBatches,
      previous: null,
      format: 'count',
      invert: true,
    },
    {
      key: 'no_barcode',
      label: 'No barcode or GTIN',
      value: snapshot.noBarcode,
      previous: null,
      format: 'count',
      invert: true,
    },
  ]
  return { period, previous: previousPeriod(period), kpis, snapshot, attention: labelsAttention(snapshot) }
}
