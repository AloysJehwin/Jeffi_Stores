import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, withTransaction } from '@/lib/db'
import { logStockMovement } from '@/lib/inventory'
import { syncPerishableStock } from '@/lib/shelf'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { id } = await params

    const [sale, items] = await Promise.all([
      queryOne<any>(`SELECT * FROM cash_sales WHERE id = $1`, [id]),
      queryMany<any>(`SELECT * FROM cash_sale_items WHERE sale_id = $1 ORDER BY created_at`, [id]),
    ])

    if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })

    return NextResponse.json({ sale, items: items || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { id } = await params
    const body = await request.json()
    if (body.action !== 'cancel') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

    await withTransaction(async (client) => {
      const sale = await client.query(`SELECT status FROM cash_sales WHERE id = $1 FOR UPDATE`, [id])
      if (!sale.rows[0]) throw new Error('Sale not found')
      if (sale.rows[0].status === 'cancelled') throw new Error('Sale is already cancelled')

      await client.query(
        `UPDATE cash_sales SET status = 'cancelled', payment_status = 'cancelled', updated_at = now() WHERE id = $1`,
        [id]
      )

      const items = await client.query(
        `SELECT product_id, variant_id, sub_variant_id, quantity FROM cash_sale_items WHERE sale_id = $1`,
        [id]
      )

      for (const item of items.rows) {
        if (!item.product_id) continue
        const qty = parseFloat(item.quantity)

        // Find all batch deductions logged for this cash sale item. The shared
        // deduction helper records cash-sale movements with reference_type='order'
        // and reference_id=saleId (it does not distinguish cash sales), so match
        // that here — matching 'cash_sale' would find nothing and skip the batch
        // restore entirely.
        const batchMovements = await client.query<{ batch_id: string; quantity_change: string; serial_number: string | null }>(
          `SELECT batch_id, quantity_change, serial_number FROM inventory_transactions
           WHERE reference_type = 'order' AND reference_id = $1
             AND product_id = $2
             AND (variant_id = $3 OR ($3 IS NULL AND variant_id IS NULL))
             AND batch_id IS NOT NULL
             AND transaction_type = 'sale'`,
          [id, item.product_id, item.variant_id || null]
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
              referenceType: 'cash_sale',
              referenceId: id,
              currentStock: stockBefore,
              batchId: mv.batch_id,
              lotNumber: batchUpd.rows[0]?.lot_number ?? null,
              expiryDate: batchUpd.rows[0]?.expiry_date ?? null,
              serialNumber: mv.serial_number ?? null,
            })
          }
        } else if (item.sub_variant_id) {
          const row = await client.query<{ inventory_quantity: number }>(
            `SELECT inventory_quantity FROM product_sub_variants WHERE id = $1 FOR UPDATE`, [item.sub_variant_id])
          stockBefore = parseFloat(row.rows[0]?.inventory_quantity as any) || 0
          await client.query(
            `UPDATE product_sub_variants SET inventory_quantity = inventory_quantity + $1 WHERE id = $2`,
            [qty, item.sub_variant_id]
          )
        } else if (item.variant_id) {
          const row = await client.query<{ inventory_quantity: number }>(
            `SELECT inventory_quantity FROM product_variants WHERE id = $1 FOR UPDATE`, [item.variant_id])
          stockBefore = parseFloat(row.rows[0]?.inventory_quantity as any) || 0
          await client.query(
            `UPDATE product_variants SET inventory_quantity = inventory_quantity + $1 WHERE id = $2`,
            [qty, item.variant_id]
          )
        } else {
          const row = await client.query<{ inventory_quantity: number }>(
            `SELECT inventory_quantity FROM products WHERE id = $1 FOR UPDATE`, [item.product_id])
          stockBefore = parseFloat(row.rows[0]?.inventory_quantity as any) || 0
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
            referenceType: 'cash_sale',
            referenceId: id,
            currentStock: stockBefore,
          })
        }
      }

      // Reset serialized units back to in_stock. The deduction marked them sold
      // with order_id = saleId (the helper uses order_id for both orders and cash
      // sales), so unlink by that id. Without this, cancelled cash-sale serials
      // stay 'sold' forever.
      await client.query(
        `UPDATE product_serials
         SET status = 'in_stock', order_id = NULL, order_item_id = NULL, sold_at = NULL, updated_at = NOW()
         WHERE order_id = $1`,
        [id]
      )

      // Sync shelf_stock for perishable/serialized products
      const synced = new Set<string>()
      for (const item of items.rows) {
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

      // Restore shelf_stock for non-perishable products
      for (const item of items.rows) {
        if (!item.product_id) continue
        const perishRow = await client.query<{ perishable: boolean; serialized: boolean }>(
          'SELECT perishable, serialized FROM products WHERE id = $1', [item.product_id]
        )
        if (perishRow.rows[0]?.perishable || perishRow.rows[0]?.serialized) continue
        await client.query(
          `UPDATE shelf_stock
           SET quantity = quantity + $1, updated_at = now()
           WHERE product_id = $2
             AND (variant_id = $3 OR ($3 IS NULL AND variant_id IS NULL))
             AND (sub_variant_id = $4 OR ($4 IS NULL AND sub_variant_id IS NULL))`,
          [parseFloat(item.quantity), item.product_id, item.variant_id || null, item.sub_variant_id || null]
        )
      }
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
