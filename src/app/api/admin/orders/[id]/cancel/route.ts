import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, queryMany, query } from '@/lib/db'
import { logStockMovement } from '@/lib/inventory'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const order = await queryOne<any>(
      `SELECT id, order_number, status, payment_status, source FROM orders WHERE id = $1`,
      [params.id]
    )
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (order.source !== 'offline') {
      return NextResponse.json({ error: 'Only offline invoices can be cancelled from here' }, { status: 400 })
    }
    if (order.status === 'cancelled') {
      return NextResponse.json({ error: 'Invoice is already cancelled' }, { status: 400 })
    }

    const items = await queryMany<any>(
      `SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1`,
      [params.id]
    )

    for (const item of items) {
      const qty = parseFloat(item.quantity)
      if (item.variant_id) {
        await query(
          `UPDATE product_variants SET stock_quantity = stock_quantity + $1 WHERE id = $2`,
          [qty, item.variant_id]
        )
      } else if (item.product_id) {
        await query(
          `UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2`,
          [qty, item.product_id]
        )
      }
      await logStockMovement(null, {
        productId: item.product_id,
        variantId: item.variant_id || null,
        transactionType: 'return',
        quantityChange: qty,
        referenceType: 'order',
        referenceId: params.id,
      })
    }

    await query(
      `UPDATE orders SET status = 'cancelled', payment_status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [params.id]
    )

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to cancel invoice' }, { status: 500 })
  }
}
