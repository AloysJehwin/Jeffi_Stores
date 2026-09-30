import { withTransaction } from '@/lib/shared/db'
import { logStockMovement, recomputeStockStatusForProduct } from '@/lib/orders/inventory'
import { syncPerishableStock } from '@/lib/catalog/shelf'

/**
 * Restores inventory when an order is returned or cancelled.
 * - Tracked products (perishable / serialized): restores the batches the sale
 *   consumed; a batch that the sale emptied (and was therefore deleted) is
 *   recreated from the ledger snapshot so the units keep their lot and expiry
 * - Serials go back to in_stock only at a grain that still holds stock; at a
 *   retired grain they are marked returned instead
 * - Syncs shelf_stock for tracked products; restores shelf_stock for plain ones
 *
 * Safe to call multiple times — uses inventory_transactions to find exactly what
 * was deducted; won't double-restore if already done.
 *
 * Returns a `skipped` list of grains whose variant/sub-variant no longer holds
 * stock (retired by a product edit after the order was placed). Those are NOT
 * restocked and the caller can surface a warning. Acceptance of the return itself
 * is the admin's call; this only reports.
 */
export interface RestoreSkip {
  product_id: string
  variant_id: string | null
  sub_variant_id: string | null
  reason: string
}

type Client = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }

const GRAIN = `product_id = $1 AND variant_id IS NOT DISTINCT FROM $2::uuid AND sub_variant_id IS NOT DISTINCT FROM $3::uuid`

// A serial can only return to stock at a grain that still holds stock: an active
// sub-variant, an active variant without sub-variants, or a product without variants.
const SERIAL_GRAIN_IS_LEAF = `CASE
  WHEN ps.sub_variant_id IS NOT NULL THEN EXISTS (
    SELECT 1 FROM product_sub_variants sv JOIN product_variants v ON v.id = sv.variant_id
     WHERE sv.id = ps.sub_variant_id AND sv.is_active = true AND v.is_active = true)
  WHEN ps.variant_id IS NOT NULL THEN EXISTS (
    SELECT 1 FROM product_variants v WHERE v.id = ps.variant_id AND v.is_active = true
       AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = v.id AND sv.is_active = true))
  ELSE NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = ps.product_id AND v.is_active = true)
END`

async function grainIsLeaf(
  client: Client,
  productId: string,
  variantId: string | null,
  subVariantId: string | null
): Promise<boolean> {
  const r = await client.query(
    `SELECT CASE
       WHEN $3::uuid IS NOT NULL THEN EXISTS (
         SELECT 1 FROM product_sub_variants sv JOIN product_variants v ON v.id = sv.variant_id
          WHERE sv.id = $3 AND sv.is_active = true AND v.is_active = true)
       WHEN $2::uuid IS NOT NULL THEN EXISTS (
         SELECT 1 FROM product_variants v WHERE v.id = $2 AND v.is_active = true
            AND NOT EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = v.id AND sv.is_active = true))
       ELSE NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = $1 AND v.is_active = true)
     END AS is_leaf`,
    [productId, variantId, subVariantId]
  )
  return r.rows[0]?.is_leaf !== false
}

// Where a recreated batch goes: the grain's latest batch or shelf location, else the
// first active open shelf. Null only when no warehouse exists at all.
async function fallbackLocation(
  client: Client,
  productId: string,
  variantId: string | null,
  subVariantId: string | null
): Promise<string | null> {
  const r = await client.query(
    `SELECT location_id FROM (
       SELECT location_id, 1 AS pri, updated_at AS ts FROM product_batches WHERE ${GRAIN} AND location_id IS NOT NULL
       UNION ALL
       SELECT location_id, 2, updated_at FROM shelf_stock WHERE ${GRAIN}
       UNION ALL
       SELECT sl.id, 3, sl.created_at FROM shelf_locations sl JOIN warehouses w ON w.id = sl.warehouse_id
        WHERE sl.is_active = true AND w.is_active = true
          AND sl.aisle_code = 'OPEN' AND sl.rack_code = 'SHELF' AND sl.shelf_code = '01' AND sl.bin_code IS NULL
     ) x ORDER BY pri, ts DESC LIMIT 1`,
    [productId, variantId, subVariantId]
  )
  return r.rows[0]?.location_id ?? null
}

interface SaleMove {
  id: string
  batch_id: string | null
  quantity_change: string
  serial_number: string | null
  lot_number: string | null
  expiry_date: string | null
}

// Returns false when the line has no sale movements to reverse.
async function restoreTrackedLine(
  client: Client,
  orderId: string,
  productId: string,
  variantId: string | null,
  subVariantId: string | null,
  skipped: RestoreSkip[]
): Promise<boolean> {
  const moves = await client.query(
    `SELECT id, batch_id, quantity_change, serial_number, lot_number, expiry_date
       FROM inventory_transactions
      WHERE reference_type = 'order' AND reference_id = $4 AND transaction_type = 'sale' AND ${GRAIN}`,
    [productId, variantId, subVariantId, orderId]
  )
  const rows = moves.rows as SaleMove[]
  if (rows.length === 0) return false

  if (!(await grainIsLeaf(client, productId, variantId, subVariantId))) {
    skipped.push({
      product_id: productId,
      variant_id: variantId,
      sub_variant_id: subVariantId,
      reason: 'grain no longer holds stock; units were not restocked',
    })
    return true
  }

  // Group by the batch the sale consumed. A batch the sale emptied was deleted (its
  // id is NULL on the ledger now), so it is recreated from the snapshot.
  const groups = new Map<
    string,
    { batchId: string | null; lot: string | null; expiry: string | null; rows: SaleMove[] }
  >()
  for (const m of rows) {
    const key = m.batch_id || `lot:${m.lot_number ?? ''}|${m.expiry_date ?? ''}`
    const g = groups.get(key) || { batchId: m.batch_id, lot: m.lot_number, expiry: m.expiry_date, rows: [] }
    g.rows.push(m)
    groups.set(key, g)
  }

  let location: string | null | undefined
  for (const g of groups.values()) {
    const total = g.rows.reduce((s, m) => s + Math.abs(parseFloat(m.quantity_change) || 0), 0)
    let batchId = g.batchId
    let before = 0
    if (batchId) {
      const br = await client.query(`SELECT quantity_remaining FROM product_batches WHERE id = $1 FOR UPDATE`, [
        batchId,
      ])
      if (br.rows[0]) before = parseFloat(br.rows[0].quantity_remaining) || 0
      else batchId = null
    }
    if (batchId) {
      await client.query(
        `UPDATE product_batches SET quantity_remaining = quantity_remaining + $1, updated_at = NOW() WHERE id = $2`,
        [total, batchId]
      )
    } else {
      if (location === undefined) location = await fallbackLocation(client, productId, variantId, subVariantId)
      const ins = await client.query(
        `INSERT INTO product_batches
           (product_id, variant_id, sub_variant_id, lot_number, expiry_date, quantity, quantity_remaining, location_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8) RETURNING id`,
        [productId, variantId, subVariantId, g.lot, g.expiry, total, location, `Recreated on return of ${orderId}`]
      )
      batchId = ins.rows[0]?.id ?? null
      const serials = g.rows.map(m => m.serial_number).filter((s): s is string => !!s)
      if (batchId && serials.length > 0) {
        await client.query(
          `UPDATE product_serials SET batch_id = $1, updated_at = NOW() WHERE order_id = $2 AND serial_number = ANY($3::text[])`,
          [batchId, orderId, serials]
        )
      }
    }
    let running = before
    for (const m of g.rows) {
      const q = Math.abs(parseFloat(m.quantity_change) || 0)
      await logStockMovement(client as any, {
        productId,
        variantId,
        subVariantId,
        transactionType: 'return',
        quantityChange: q,
        referenceType: 'order',
        referenceId: orderId,
        currentStock: running,
        batchId,
        lotNumber: g.lot,
        expiryDate: g.expiry,
        serialNumber: m.serial_number ?? null,
      })
      running += q
    }
  }
  return true
}

export async function restoreOrderStock(orderId: string): Promise<{ skipped: RestoreSkip[] }> {
  const skipped: RestoreSkip[] = []
  await withTransaction(async client => {
    const itemsResult = await client.query(
      `SELECT product_id, variant_id, sub_variant_id, quantity, buy_unit FROM order_items WHERE order_id = $1`,
      [orderId]
    )

    for (const item of itemsResult.rows) {
      const rawQty = parseFloat(item.quantity)
      const variantId: string | null = item.variant_id || null
      const subVariantId: string | null = item.sub_variant_id || null

      const unitRow = await client.query<{ factor: string; dimension: string }>(
        `SELECT COALESCE(puv.factor, pup.factor) AS factor,
                COALESCE(puv.dimension, pup.dimension) AS dimension
         FROM (SELECT 1) x
         LEFT JOIN product_units puv ON puv.unit = $1 AND puv.product_id = $2 AND puv.variant_id = $3
         LEFT JOIN product_units pup ON pup.unit = $1 AND pup.product_id = $2 AND pup.variant_id IS NULL`,
        [item.buy_unit, item.product_id, variantId]
      )
      const u = unitRow.rows[0]
      const qty = u?.dimension === 'count' && u?.factor ? rawQty * parseFloat(u.factor) : rawQty

      // Check if we've already logged a return for this order+product to avoid double-restore
      const alreadyRestored = await client.query(
        `SELECT 1 FROM inventory_transactions
         WHERE reference_type = 'order' AND reference_id = $1
           AND product_id = $2
           AND transaction_type = 'return'
         LIMIT 1`,
        [orderId, item.product_id]
      )
      if (alreadyRestored.rows.length > 0) continue

      const flags = await client.query<{ perishable: boolean; serialized: boolean }>(
        'SELECT perishable, serialized FROM products WHERE id = $1',
        [item.product_id]
      )
      const tracked = !!flags.rows[0]?.perishable || !!flags.rows[0]?.serialized
      if (tracked && (await restoreTrackedLine(client, orderId, item.product_id, variantId, subVariantId, skipped)))
        continue

      let stockBefore = 0
      if (subVariantId) {
        const row = await client.query<{ inventory_quantity: string; is_active: boolean }>(
          `SELECT inventory_quantity, is_active FROM product_sub_variants WHERE id = $1 FOR UPDATE`,
          [subVariantId]
        )
        if (!row.rows[0] || row.rows[0].is_active === false) {
          skipped.push({
            product_id: item.product_id,
            variant_id: variantId,
            sub_variant_id: subVariantId,
            reason: row.rows[0] ? 'sub-variant is no longer active' : 'sub-variant no longer exists',
          })
          continue
        }
        stockBefore = parseFloat(row.rows[0]?.inventory_quantity ?? '0') || 0
        await client.query(
          `UPDATE product_sub_variants SET inventory_quantity = inventory_quantity + $1 WHERE id = $2`,
          [qty, subVariantId]
        )
      } else if (variantId) {
        const row = await client.query<{ inventory_quantity: string; is_active: boolean }>(
          `SELECT inventory_quantity, is_active FROM product_variants WHERE id = $1 FOR UPDATE`,
          [variantId]
        )
        if (!row.rows[0] || row.rows[0].is_active === false) {
          skipped.push({
            product_id: item.product_id,
            variant_id: variantId,
            sub_variant_id: null,
            reason: row.rows[0] ? 'variant is no longer active' : 'variant no longer exists',
          })
          continue
        }
        stockBefore = parseFloat(row.rows[0]?.inventory_quantity ?? '0') || 0
        await client.query(`UPDATE product_variants SET inventory_quantity = inventory_quantity + $1 WHERE id = $2`, [
          qty,
          variantId,
        ])
      } else {
        const row = await client.query<{ inventory_quantity: string }>(
          `SELECT inventory_quantity FROM products WHERE id = $1 FOR UPDATE`,
          [item.product_id]
        )
        stockBefore = parseFloat(row.rows[0]?.inventory_quantity ?? '0') || 0
        await client.query(`UPDATE products SET inventory_quantity = inventory_quantity + $1 WHERE id = $2`, [
          qty,
          item.product_id,
        ])
      }

      await logStockMovement(client, {
        productId: item.product_id,
        variantId,
        subVariantId,
        transactionType: 'return',
        quantityChange: qty,
        referenceType: 'order',
        referenceId: orderId,
        currentStock: stockBefore,
      })
    }

    // Serials come back to stock only where stock can still be held; the rest are
    // marked returned so they never reappear as sellable at a retired grain.
    await client.query(
      `UPDATE product_serials ps SET status = 'in_stock', order_id = NULL, sold_at = NULL, updated_at = NOW()
        WHERE ps.order_id = $1 AND ps.status = 'sold' AND ${SERIAL_GRAIN_IS_LEAF}`,
      [orderId]
    )
    const retired = await client.query<{
      product_id: string
      variant_id: string | null
      sub_variant_id: string | null
    }>(
      `UPDATE product_serials ps SET status = 'returned', returned_at = NOW(), updated_at = NOW()
        WHERE ps.order_id = $1 AND ps.status = 'sold' AND NOT (${SERIAL_GRAIN_IS_LEAF})
        RETURNING ps.product_id, ps.variant_id, ps.sub_variant_id`,
      [orderId]
    )
    const seen = new Set(skipped.map(s => `${s.product_id}:${s.variant_id || ''}:${s.sub_variant_id || ''}`))
    for (const r of retired.rows) {
      const key = `${r.product_id}:${r.variant_id || ''}:${r.sub_variant_id || ''}`
      if (seen.has(key)) continue
      seen.add(key)
      skipped.push({
        product_id: r.product_id,
        variant_id: r.variant_id,
        sub_variant_id: r.sub_variant_id,
        reason: 'serials returned to a retired grain; marked returned, not restocked',
      })
    }

    // Sync shelf_stock for perishable/serialized products
    const synced = new Set<string>()
    for (const item of itemsResult.rows) {
      if (!item.product_id) continue
      const perishRow = await client.query<{ perishable: boolean; serialized: boolean }>(
        'SELECT perishable, serialized FROM products WHERE id = $1',
        [item.product_id]
      )
      if (!perishRow.rows[0]?.perishable && !perishRow.rows[0]?.serialized) continue
      const key = `${item.product_id}:${item.variant_id || ''}:${item.sub_variant_id || ''}`
      if (synced.has(key)) continue
      synced.add(key)
      await syncPerishableStock(client, item.product_id, item.variant_id || null, item.sub_variant_id || null)
    }

    // Restore shelf_stock for plain (non-perishable, non-serialized) products
    for (const item of itemsResult.rows) {
      if (!item.product_id) continue
      const perishRow = await client.query<{ perishable: boolean; serialized: boolean }>(
        'SELECT perishable, serialized FROM products WHERE id = $1',
        [item.product_id]
      )
      if (perishRow.rows[0]?.perishable || perishRow.rows[0]?.serialized) continue
      const unitRow = await client.query<{ factor: string; dimension: string }>(
        `SELECT COALESCE(puv.factor, pup.factor) AS factor,
                COALESCE(puv.dimension, pup.dimension) AS dimension
         FROM (SELECT 1) x
         LEFT JOIN product_units puv ON puv.unit = $1 AND puv.product_id = $2 AND puv.variant_id = $3
         LEFT JOIN product_units pup ON pup.unit = $1 AND pup.product_id = $2 AND pup.variant_id IS NULL`,
        [item.buy_unit, item.product_id, item.variant_id || null]
      )
      const u = unitRow.rows[0]
      const baseQty =
        u?.dimension === 'count' && u?.factor
          ? parseFloat(item.quantity) * parseFloat(u.factor)
          : parseFloat(item.quantity)
      await client.query(
        `UPDATE shelf_stock
         SET quantity = quantity + $1, updated_at = now()
         WHERE product_id = $2
           AND (variant_id = $3 OR ($3 IS NULL AND variant_id IS NULL))
           AND (sub_variant_id = $4 OR ($4 IS NULL AND sub_variant_id IS NULL))`,
        [baseQty, item.product_id, item.variant_id || null, item.sub_variant_id || null]
      )
    }

    // If inventory_sync is ON, re-derive stock_status from the restored quantities
    // (once per product, deduped). No-op when OFF. Perishable/serialized grains were
    // already re-derived via syncPerishableStock above; this covers plain products
    // and is idempotent for the rest.
    const statusSynced = new Set<string>()
    for (const item of itemsResult.rows) {
      if (!item.product_id || statusSynced.has(item.product_id)) continue
      statusSynced.add(item.product_id)
      await recomputeStockStatusForProduct(client, item.product_id)
    }
  })
  return { skipped }
}
