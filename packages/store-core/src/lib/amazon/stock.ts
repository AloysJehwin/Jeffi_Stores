import { query, queryMany } from '@/lib/shared/db'
import { readSetting } from '@/lib/google-ads/notify'
import { withChannelLock, errorText, type RunResult } from '@/lib/channels/sync-run'
import { AMAZON_PUSH_DISABLED, patchListingsItem } from './client'

// Merchant-fulfilled stock to Amazon. Our catalogue is the source of truth: what Amazon shows is
// our available quantity minus units held for Amazon orders still Pending there, minus a safety
// buffer, never below zero. Only SKUs that track stock (inventory_sync) and are not FBA are pushed,
// and only when the number changed. Off until the owner enables it.

export const SETTING_STOCK = 'amazon_stock_push'
export const SETTING_BUFFER = 'amazon_stock_buffer'
const MAX_PUSHES_PER_RUN = 300

export function desiredQuantity(available: number | null, reserved: number, buffer: number): number {
  if (available == null || !Number.isFinite(available)) return 0
  return Math.max(0, Math.floor(available) - reserved - buffer)
}

export async function stockSettings(): Promise<{ enabled: boolean; buffer: number }> {
  const [enabled, buffer] = await Promise.all([readSetting(SETTING_STOCK), readSetting(SETTING_BUFFER)])
  return { enabled: enabled === 'true', buffer: Math.max(0, Math.min(1000, Math.round(Number(buffer ?? 0)) || 0)) }
}

export interface StockRow {
  sku: string
  product_id: string
  variant_id: string | null
  product_type: string | null
  available: string | null
  reserved: string
  pushed_qty: number | null
}

/** Listed, merchant-fulfilled, stock-tracked SKUs with our quantity and Pending Amazon units. */
export async function stockRows(): Promise<StockRow[]> {
  return queryMany<StockRow>(
    `WITH cat AS (
       SELECT v.sku, p.id AS product_id, v.id AS variant_id, v.inventory_quantity AS qty
         FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE p.inventory_sync AND NOT COALESCE(p.is_digital, false) AND v.sku IS NOT NULL
       UNION ALL
       SELECT p.sku, p.id, NULL, p.inventory_quantity FROM products p
        WHERE p.inventory_sync AND NOT COALESCE(p.is_digital, false) AND p.sku IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active)
     ),
     pending AS (
       SELECT i.sku, SUM(i.quantity) AS units FROM amazon_order_items i JOIN amazon_orders a ON a.amazon_order_id = i.amazon_order_id
        WHERE a.fulfillment_channel = 'MFN' AND a.status IN ('Pending', 'PendingAvailability') AND a.stock_state = 'none'
        GROUP BY i.sku
     )
     SELECT l.sku, cat.product_id, cat.variant_id, l.summaries->0->>'productType' AS product_type, cat.qty AS available,
            COALESCE(pending.units, 0) AS reserved, s.pushed_qty
       FROM amazon_listing_status l
       JOIN cat ON cat.sku = l.sku
       LEFT JOIN pending ON pending.sku = l.sku
       LEFT JOIN amazon_inventory_state s ON s.sku = l.sku
      WHERE NOT COALESCE((l.summaries->0->>'fulfillmentChannel') ILIKE '%AMAZON%', false)`
  )
}

export async function pushAmazonStock(): Promise<RunResult> {
  return withChannelLock('amazon', 'amazon_stock', 'stock', async ({ step }) => {
    const { buffer } = await stockSettings()
    const rows = await stockRows()
    let pushes = 0
    for (const r of rows) {
      const want = desiredQuantity(r.available == null ? null : Number(r.available), Number(r.reserved), buffer)
      await query(
        `INSERT INTO amazon_inventory_state (sku, product_id, variant_id, our_available, reserved, updated_at) VALUES ($1,$2,$3,$4,$5,now())
         ON CONFLICT (sku) DO UPDATE SET product_id = EXCLUDED.product_id, variant_id = EXCLUDED.variant_id,
           our_available = EXCLUDED.our_available, reserved = EXCLUDED.reserved, updated_at = now()`,
        [r.sku, r.product_id, r.variant_id, r.available, Number(r.reserved)]
      )
      if (AMAZON_PUSH_DISABLED || r.pushed_qty === want || !r.product_type || pushes >= MAX_PUSHES_PER_RUN) continue
      pushes++
      await step('pushed', async () => {
        try {
          await patchListingsItem(r.sku, r.product_type!, [
            { op: 'replace', path: '/attributes/fulfillment_availability', value: [{ fulfillment_channel_code: 'DEFAULT', quantity: want }] },
          ])
          await query(`UPDATE amazon_inventory_state SET pushed_qty = $2, pushed_at = now(), push_error = NULL WHERE sku = $1`, [r.sku, want])
          return 1
        } catch (e) {
          await query(`UPDATE amazon_inventory_state SET push_error = $2 WHERE sku = $1`, [r.sku, errorText(e)])
          throw e
        }
      })
    }
  })
}

/** Amazon's own quantity per SKU, recorded by the listing status refresh for drift checks. */
export async function recordAmazonQuantities(items: any[]): Promise<void> {
  for (const item of items) {
    const fa = (item?.fulfillmentAvailability ?? []).find((f: any) => f?.fulfillmentChannelCode === 'DEFAULT')
    if (!item?.sku || fa?.quantity == null) continue
    await query(
      `INSERT INTO amazon_inventory_state (sku, amazon_quantity, amazon_checked_at) VALUES ($1, $2, now())
       ON CONFLICT (sku) DO UPDATE SET amazon_quantity = EXCLUDED.amazon_quantity, amazon_checked_at = now()`,
      [item.sku, Number(fa.quantity)]
    )
  }
}

export async function loadStock() {
  const [settings, rows] = await Promise.all([
    stockSettings(),
    queryMany<any>(
      `SELECT s.*, l.title FROM amazon_inventory_state s LEFT JOIN amazon_listing_status l ON l.sku = s.sku ORDER BY (s.push_error IS NOT NULL) DESC, l.title LIMIT 2000`
    ),
  ])
  return { settings, pushDisabled: AMAZON_PUSH_DISABLED, rows }
}
