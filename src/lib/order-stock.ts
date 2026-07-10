import { withTransaction } from '@/lib/db'
import { logStockMovement } from '@/lib/inventory'
import { syncPerishableStock } from '@/lib/shelf'

/**
 * Restores inventory when an order is returned or cancelled.
 * - Reverses batch quantity_remaining deductions using the sale ledger
 * - Resets serialized product serials back to in_stock
 * - Syncs shelf_stock for perishable/serialized products
 * - Restores shelf_stock for plain products
 *
 * Safe to call multiple times — uses inventory_transactions to find
 * exactly what was deducted; won't double-restore if already done.
 */
export async function restoreOrderStock(orderId: string): Promise<void> {
  await withTransaction(async (client) => {
    const itemsResult = await client.query(
      `SELECT product_id, variant_id, sub_variant_id, quantity, buy_unit FROM order_items WHERE order_id = $1`,
      [orderId]
    )

    for (const item of itemsResult.rows) {
      const rawQty = parseFloat(item.quantity)

      const unitRow = await client.query<{ factor: string; dimension: string }>(
        `SELECT COALESCE(puv.factor, pup.factor) AS factor,
                COALESCE(puv.dimension, pup.dimension) AS dimension
         FROM (SELECT 1) x
         LEFT JOIN product_units puv ON puv.unit = $1 AND puv.product_id = $2 AND puv.variant_id = $3
         LEFT JOIN product_units pup ON pup.unit = $1 AND pup.product_id = $2 AND pup.variant_id IS NULL`,
        [item.buy_unit, item.product_id, item.variant_id || null]
      )
      const u = unitRow.rows[0]
      const qty = (u?.dimension === 'count' && u?.factor)
        ? rawQty * parseFloat(u.factor)
        : rawQty

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

      const batchMovements = await client.query<{ batch_id: string; quantity_change: string; serial_number: string | null }>(
        `SELECT batch_id, quantity_change, serial_number FROM inventory_transactions
         WHERE reference_type = 'order' AND reference_id = $1
           AND product_id = $2
           AND (variant_id = $3 OR ($3 IS NULL AND variant_id IS NULL))
           AND batch_id IS NOT NULL
           AND transaction_type = 'sale'`,
        [orderId, item.product_id, item.variant_id || null]
      )

      let stockBefore = 0
      if (batchMovements.rows.length > 0) {
        for (const mv of batchMovements.rows) {
          const restoreQty = Math.abs(parseFloat(mv.quantity_change))
          const br = await client.query<{ quantity_remaining: string }>(
            `SELECT quantity_remaining FROM product_batches WHERE id = $1 FOR UPDATE`, [mv.batch_id]
          )
          stockBefore = parseFloat(br.rows[0]?.quantity_remaining ?? '0') || 0
          const batchUpd = await client.query<{ lot_number: string | null; expiry_date: string | null }>(
            `UPDATE product_batches SET quantity_remaining = quantity_remaining + $1, updated_at = NOW() WHERE id = $2 RETURNING lot_number, expiry_date`,
            [restoreQty, mv.batch_id]
          )
          await logStockMovement(client, {
            productId: item.product_id,
            variantId: item.variant_id || null,
            subVariantId: item.sub_variant_id || null,
            transactionType: 'return',
            quantityChange: restoreQty,
            referenceType: 'order',
            referenceId: orderId,
            currentStock: stockBefore,
            batchId: mv.batch_id,
            lotNumber: batchUpd.rows[0]?.lot_number ?? null,
            expiryDate: batchUpd.rows[0]?.expiry_date ?? null,
            serialNumber: mv.serial_number ?? null,
          })
        }
      } else if (item.sub_variant_id) {
        const row = await client.query<{ inventory_quantity: string }>(
          `SELECT inventory_quantity FROM product_sub_variants WHERE id = $1 FOR UPDATE`,
          [item.sub_variant_id]
        )
        stockBefore = parseFloat(row.rows[0]?.inventory_quantity ?? '0') || 0
        await client.query(
          `UPDATE product_sub_variants SET inventory_quantity = inventory_quantity + $1 WHERE id = $2`,
          [qty, item.sub_variant_id]
        )
      } else if (item.variant_id) {
        const row = await client.query<{ inventory_quantity: string }>(
          `SELECT inventory_quantity FROM product_variants WHERE id = $1 FOR UPDATE`,
          [item.variant_id]
        )
        stockBefore = parseFloat(row.rows[0]?.inventory_quantity ?? '0') || 0
        await client.query(
          `UPDATE product_variants SET inventory_quantity = inventory_quantity + $1 WHERE id = $2`,
          [qty, item.variant_id]
        )
      } else {
        const row = await client.query<{ inventory_quantity: string }>(
          `SELECT inventory_quantity FROM products WHERE id = $1 FOR UPDATE`,
          [item.product_id]
        )
        stockBefore = parseFloat(row.rows[0]?.inventory_quantity ?? '0') || 0
        await client.query(
          `UPDATE products SET inventory_quantity = inventory_quantity + $1 WHERE id = $2`,
          [qty, item.product_id]
        )
      }

      if (batchMovements.rows.length === 0) {
        await logStockMovement(client, {
          productId: item.product_id,
          variantId: item.variant_id || null,
          subVariantId: item.sub_variant_id || null,
          transactionType: 'return',
          quantityChange: qty,
          referenceType: 'order',
          referenceId: orderId,
          currentStock: stockBefore,
        })
      }
    }

    // Reset serialized product serials back to in_stock
    await client.query(
      `UPDATE product_serials
       SET status = 'in_stock', order_id = NULL, sold_at = NULL, updated_at = NOW()
       WHERE order_id = $1`,
      [orderId]
    )

    // Sync shelf_stock for perishable/serialized products
    const synced = new Set<string>()
    for (const item of itemsResult.rows) {
      if (!item.product_id) continue
      const perishRow = await client.query<{ perishable: boolean; serialized: boolean }>(
        'SELECT perishable, serialized FROM products WHERE id = $1', [item.product_id]
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
        'SELECT perishable, serialized FROM products WHERE id = $1', [item.product_id]
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
      const baseQty = (u?.dimension === 'count' && u?.factor)
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
  })
}
