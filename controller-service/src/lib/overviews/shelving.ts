import { queryOne } from '@/lib/shared/db'
import { ratio, type Period } from '@/lib/overview/period'
import type { AttentionItem } from '@/lib/overview/attention'
import { kpi, n, periodSql, plural, snapshot, type OverviewKpi } from './ops-kpi'

// Shelving strip. Utilisation is active locations holding any stock; unshelved stock is an
// active product with central stock (products.inventory_quantity, synced from its leaves) but
// less than that on shelves.

export interface ShelfSnapshot {
  warehouses: number
  locations: number
  used: number
  products_shelved: number
  unshelved_products: number
  unshelved_units: number
  over_shelved: number
}

export function shelfAttention(s: ShelfSnapshot): AttentionItem[] {
  const out: AttentionItem[] = []
  if (s.locations === 0) {
    out.push({
      key: 'setup',
      severity: 'info',
      title: 'No shelf locations yet',
      sub: 'Add a warehouse and its locations to start shelving stock',
      href: '/admin/shelving?tab=locations',
    })
    return out
  }
  if (s.unshelved_products)
    out.push({
      key: 'unshelved',
      severity: 'warning',
      title: `${plural(s.unshelved_products, 'product')} with stock not on a shelf`,
      sub: `${Math.round(s.unshelved_units).toLocaleString('en-IN')} units unassigned`,
      href: '/admin/shelving?tab=locations',
    })
  if (s.over_shelved)
    out.push({
      key: 'over',
      severity: 'warning',
      title: `${plural(s.over_shelved, 'product')} with more on shelves than in stock`,
      sub: 'Shelf counts and central stock disagree',
      href: '/admin/shelving?tab=locations',
    })
  const empty = s.locations - s.used
  if (empty > 0 && s.used / s.locations < 0.5)
    out.push({
      key: 'empty',
      severity: 'info',
      title: `${plural(empty, 'location')} empty`,
      href: '/admin/shelving?tab=locations',
    })
  return out
}

export async function getShelvingOverview(period: Period) {
  const ps = periodSql(period)
  const [snap, moves] = await Promise.all([
    queryOne<Record<string, unknown>>(
      `WITH shelved AS (SELECT product_id, SUM(quantity) AS q FROM shelf_stock GROUP BY 1),
       gap AS (
         SELECT p.inventory_quantity - COALESCE(s.q, 0) AS diff
         FROM products p LEFT JOIN shelved s ON s.product_id = p.id
         WHERE p.is_active AND (p.inventory_quantity > 0 OR s.q > 0))
       SELECT (SELECT COUNT(*) FROM warehouses WHERE is_active) AS warehouses,
              (SELECT COUNT(*) FROM shelf_locations WHERE is_active) AS locations,
              (SELECT COUNT(DISTINCT sl.id) FROM shelf_locations sl JOIN shelf_stock ss ON ss.location_id = sl.id AND ss.quantity > 0 WHERE sl.is_active) AS used,
              (SELECT COUNT(*) FROM shelved WHERE q > 0) AS products_shelved,
              (SELECT COUNT(*) FROM gap WHERE diff > 0) AS unshelved_products,
              (SELECT COALESCE(SUM(diff), 0) FROM gap WHERE diff > 0) AS unshelved_units,
              (SELECT COUNT(*) FROM gap WHERE diff < 0) AS over_shelved`
    ),
    queryOne<Record<string, unknown>>(
      `SELECT COUNT(*) FILTER (WHERE ${ps.cur('created_at')}) AS cur, COUNT(*) FILTER (WHERE ${ps.prev('created_at')}) AS prev,
              COALESCE(SUM(ABS(quantity_change)) FILTER (WHERE ${ps.cur('created_at')}), 0) AS cur_units,
              COALESCE(SUM(ABS(quantity_change)) FILTER (WHERE ${ps.prev('created_at')}), 0) AS prev_units
       FROM shelf_stock_transactions WHERE ${ps.span('created_at')}`,
      ps.params
    ),
  ])
  const s: ShelfSnapshot = {
    warehouses: n(snap?.warehouses),
    locations: n(snap?.locations),
    used: n(snap?.used),
    products_shelved: n(snap?.products_shelved),
    unshelved_products: n(snap?.unshelved_products),
    unshelved_units: n(snap?.unshelved_units),
    over_shelved: n(snap?.over_shelved),
  }
  const kpis: OverviewKpi[] = [
    snapshot('locations', 'Locations', s.locations, 'count', { sub: plural(s.warehouses, 'warehouse') }),
    snapshot('utilisation', 'Utilisation', ratio(s.used, s.locations), 'pct', { sub: `${s.used} in use` }),
    snapshot('shelved', 'Products shelved', s.products_shelved, 'count'),
    snapshot('unshelved', 'Unshelved products', s.unshelved_products, 'count', { invert: true }),
    kpi('moves', 'Shelf movements', n(moves?.cur), n(moves?.prev), 'count'),
    kpi('units', 'Units moved', n(moves?.cur_units), n(moves?.prev_units), 'count'),
  ]
  return { range: period, previous_range: ps.previous, kpis, snapshot: s, attention: shelfAttention(s) }
}
