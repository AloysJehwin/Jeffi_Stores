import type { AttentionItem } from '@/lib/overview/attention'
import { queryMany, queryOne } from '@/lib/shared/db'
import { previousPeriod, ratio, type Period } from '@/lib/overview/period'
import { BOUNDS, boundArgs, byPeriod, inBoth, n, per, type Row, type StripKpi } from '@/lib/overviews/orders'

// Scans are not logged, so the strip shows scan readiness (what resolves from a barcode) and
// serial-unit movement, which is what QuickScan looks up.

export interface ScanSnapshot {
  active: number
  scannable: number
  serialsInStock: number
}

export function scanAttention(s: ScanSnapshot): AttentionItem[] {
  const missing = s.active - s.scannable
  if (missing <= 0) return []
  return [
    {
      key: 'unscannable',
      severity: 'info',
      title: `${missing} active ${missing === 1 ? 'product has' : 'products have'} no barcode or GTIN`,
      sub: 'They resolve by SKU only',
      href: '/admin/products',
    },
  ]
}

export async function loadScanStrip(period: Period) {
  const [moves, snap] = await Promise.all([
    queryMany<Row>(
      `WITH ${BOUNDS},
       ev AS (
         SELECT ${per('ps.sold_at')} AS period, 1 AS sold, 0 AS returned FROM product_serials ps, b WHERE ${inBoth('ps.sold_at')}
         UNION ALL
         SELECT ${per('ps.returned_at')}, 0, 1 FROM product_serials ps, b WHERE ${inBoth('ps.returned_at')})
       SELECT period, SUM(sold) AS sold, SUM(returned) AS returned FROM ev GROUP BY 1`,
      boundArgs(period)
    ),
    queryOne<Row>(
      `SELECT (SELECT COUNT(*) FROM products WHERE is_active) AS active,
              (SELECT COUNT(*) FROM products WHERE is_active
                 AND (NULLIF(TRIM(barcode), '') IS NOT NULL OR NULLIF(TRIM(gtin), '') IS NOT NULL)) AS scannable,
              (SELECT COUNT(*) FROM product_serials WHERE status = 'in_stock') AS in_stock`
    ),
  ])
  const m = byPeriod(moves, r => r)
  const snapshot: ScanSnapshot = {
    active: n(snap?.active),
    scannable: n(snap?.scannable),
    serialsInStock: n(snap?.in_stock),
  }
  const kpis: StripKpi[] = [
    {
      key: 'scannable',
      label: 'Products with barcode',
      value: ratio(snapshot.scannable, snapshot.active),
      previous: null,
      format: 'pct',
      sub: `${snapshot.scannable} of ${snapshot.active} active`,
    },
    {
      key: 'in_stock',
      label: 'Serial units in stock',
      value: snapshot.serialsInStock,
      previous: null,
      format: 'count',
    },
    {
      key: 'sold',
      label: 'Serial units sold',
      value: n(m.current?.sold),
      previous: n(m.previous?.sold),
      format: 'count',
    },
    {
      key: 'returned',
      label: 'Serial units returned',
      value: n(m.current?.returned),
      previous: n(m.previous?.returned),
      format: 'count',
      invert: true,
    },
  ]
  return { period, previous: previousPeriod(period), kpis, snapshot, attention: scanAttention(snapshot) }
}
