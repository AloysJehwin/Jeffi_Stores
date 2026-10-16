import type { AttentionItem } from '@/components/admin/overview/kit'
import { inIst, num, numOrNull } from './catalog'

// Bulk price runs (price_inflation_log). A run is a row with is_rollback = false; a rollback adds
// a row with is_rollback = true and stamps rolled_back_at on the run. "Live" runs are those not
// rolled back. Params: $1/$2 current IST days, $3/$4 previous.

export const STALE_RUN_DAYS = 180

export const INFLATION_PERIOD_SQL = `
  SELECT cur,
         COUNT(*) FILTER (WHERE NOT is_rollback) AS runs,
         COUNT(*) FILTER (WHERE is_rollback) AS rollbacks,
         COALESCE(SUM(product_count) FILTER (WHERE NOT is_rollback AND rolled_back_at IS NULL), 0) AS products,
         COUNT(DISTINCT category_id) FILTER (WHERE NOT is_rollback AND rolled_back_at IS NULL) AS categories,
         SUM(percentage * product_count) FILTER (WHERE NOT is_rollback AND rolled_back_at IS NULL) AS weighted,
         AVG(percentage) FILTER (WHERE NOT is_rollback AND rolled_back_at IS NULL) AS avg_pct
  FROM (
    SELECT l.*, (${inIst('l.applied_at', 1, 2)}) AS cur
    FROM price_inflation_log l
    WHERE ${inIst('l.applied_at', 1, 2)} OR ${inIst('l.applied_at', 3, 4)}
  ) x
  GROUP BY cur`

export const INFLATION_RECENT_SQL = `
  SELECT id::text, category_id::text, category_name, percentage, applied_fields, product_count, applied_by, applied_at,
         is_rollback, rolled_back_at
  FROM price_inflation_log
  ORDER BY applied_at DESC LIMIT 8`

// Active categories with active products and no live run on them or their parent in STALE_RUN_DAYS.
export const INFLATION_STALE_SQL = `
  WITH runs AS (
    SELECT category_id, MAX(applied_at) AS at FROM price_inflation_log
    WHERE NOT is_rollback AND rolled_back_at IS NULL GROUP BY category_id
  ),
  cats AS (
    SELECT c.id, c.name, COUNT(p.id) AS products,
           GREATEST(r.at, rp.at) AS last_run
    FROM categories c
    JOIN products p ON p.category_id = c.id AND p.is_active AND NOT p.is_draft
    LEFT JOIN runs r ON r.category_id = c.id
    LEFT JOIN runs rp ON rp.category_id = c.parent_category_id
    WHERE c.is_active AND NOT c.is_draft
    GROUP BY c.id, r.at, rp.at
  )
  SELECT id::text, name, products, last_run FROM cats
  WHERE COALESCE(last_run, 'epoch'::timestamptz) < now() - INTERVAL '${STALE_RUN_DAYS} days'
  ORDER BY products DESC`

export interface RunStats {
  runs: number
  rollbacks: number
  products: number
  categories: number
  /** Average change per product affected, in percent. */
  avgChange: number | null
}

export function runStats(r: Record<string, unknown> | undefined): RunStats {
  const products = num(r?.products)
  const weighted = numOrNull(r?.weighted)
  return {
    runs: num(r?.runs),
    rollbacks: num(r?.rollbacks),
    products,
    categories: num(r?.categories),
    avgChange: products && weighted != null ? weighted / products : numOrNull(r?.avg_pct),
  }
}

export function daysSince(at: string | null, now = new Date()) {
  return at ? Math.floor((now.getTime() - Date.parse(at)) / 86_400_000) : null
}

export function inflationAttention(
  lastRunAt: string | null,
  stale: { name: string; products: number }[],
  rollbacks: number,
  now = new Date()
): AttentionItem[] {
  const out: AttentionItem[] = []
  const href = '/admin/inflation'
  const days = daysSince(lastRunAt, now)
  if (days == null) out.push({ key: 'never', severity: 'info', title: 'No bulk price change has been run yet', href })
  else if (days > STALE_RUN_DAYS)
    out.push({ key: 'stale_run', severity: 'info', title: `Last bulk price change was ${days} days ago`, href })
  if (days != null && stale.length)
    out.push({
      key: 'stale_categories',
      severity: 'info',
      title: `${stale.length} categor${stale.length === 1 ? 'y' : 'ies'} not repriced in ${STALE_RUN_DAYS} days`,
      sub:
        stale
          .slice(0, 3)
          .map(c => `${c.name} (${c.products})`)
          .join(', ') + (stale.length > 3 ? ` and ${stale.length - 3} more` : ''),
      href,
    })
  if (rollbacks)
    out.push({
      key: 'rollbacks',
      severity: 'warning',
      title: `${rollbacks} price run${rollbacks === 1 ? ' was' : 's were'} rolled back this period`,
      href,
    })
  return out
}
