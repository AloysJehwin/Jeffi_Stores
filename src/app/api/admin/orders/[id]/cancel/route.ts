import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction } from '@/lib/db'
import { logStockMovement } from '@/lib/inventory'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'orders')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

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
        `SELECT product_id, variant_id, sub_variant_id, quantity FROM order_items WHERE order_id = $1`,
        [id]
      )

      for (const item of itemsResult.rows) {
        const qty = parseFloat(item.quantity)
        let stockBefore = 0

        if (item.sub_variant_id) {
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
