import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction } from '@/lib/db'
import { logStockMovement } from '@/lib/inventory'
import { syncPerishableStock, decrementNonPerishableShelfStock } from '@/lib/shelf'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const order = await queryOne<any>(
      `SELECT id, order_number, status, payment_status, source FROM orders WHERE id = $1`,
      [id]
    )
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (order.source !== 'offline') {
      return NextResponse.json({ error: 'Only offline invoices can be cancelled from here' }, { status: 400 })
    }
    if (order.status === 'cancelled') {
      return NextResponse.json({ error: 'Invoice is already cancelled' }, { status: 400 })
    }

    await withTransaction(async (client) => {
      const itemsResult = await client.query(
        `SELECT product_id, variant_id, sub_variant_id, quantity, buy_unit, batch_id FROM order_items WHERE order_id = $1`,
        [id]
      )

      for (const item of itemsResult.rows) {
        const rawQty = parseFloat(item.quantity)

        // Resolve unit factor so restore matches what was originally deducted
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

        // Find all batch deductions logged for this order item
        const batchMovements = await client.query<{ batch_id: string; quantity_change: string }>(
          `SELECT batch_id, quantity_change FROM inventory_transactions
           WHERE reference_type = 'order' AND reference_id = $1
             AND product_id = $2
             AND (variant_id = $3 OR ($3 IS NULL AND variant_id IS NULL))
             AND batch_id IS NOT NULL
             AND transaction_type = 'sale'`,
          [id, item.product_id, item.variant_id || null]
        )

        let stockBefore = 0
        if (batchMovements.rows.length > 0) {
          // Restore each batch individually
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
              referenceId: id,
              currentStock: stockBefore,
              batchId: mv.batch_id,
              lotNumber: batchUpd.rows[0]?.lot_number ?? null,
              expiryDate: batchUpd.rows[0]?.expiry_date ?? null,
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
        } else if (item.product_id) {
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
            referenceId: id,
            currentStock: stockBefore,
          })
        }
      }

      // Sync shelf_stock + inventory_quantity for any perishable product touched
      const synced = new Set<string>()
      for (const item of itemsResult.rows) {
        if (!item.product_id) continue
        const perishRow = await client.query<{ perishable: boolean }>(
          'SELECT perishable FROM products WHERE id = $1', [item.product_id]
        )
        if (!perishRow.rows[0]?.perishable) continue
        const key = `${item.product_id}:${item.variant_id || ''}:${item.sub_variant_id || ''}`
        if (synced.has(key)) continue
        synced.add(key)
        await syncPerishableStock(client, item.product_id, item.variant_id || null, item.sub_variant_id || null)
      }

      // Restore shelf_stock for non-perishable products (add back the cancelled quantity)
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
        // Add back to shelf_stock (cap at inventory_quantity to avoid over-restore)
        await client.query(
          `UPDATE shelf_stock
           SET quantity = quantity + $1, updated_at = now()
           WHERE product_id = $2
             AND (variant_id = $3 OR ($3 IS NULL AND variant_id IS NULL))
             AND (sub_variant_id = $4 OR ($4 IS NULL AND sub_variant_id IS NULL))`,
          [baseQty, item.product_id, item.variant_id || null, item.sub_variant_id || null]
        )
      }

      await client.query(
        `UPDATE orders SET status = 'cancelled', payment_status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [id]
      )
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to cancel invoice' }, { status: 500 })
  }
}
