import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, withTransaction } from '@/lib/db'
import { logStockMovement } from '@/lib/inventory'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

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
    if (!hasScope(admin.role, admin.scopes, 'invoices')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

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
        `SELECT product_id, variant_id, sub_variant_id, product_name, variant_name, quantity
         FROM cash_sale_items WHERE sale_id = $1`,
        [id]
      )

      for (const item of items.rows) {
        if (!item.product_id) continue
        const qty = parseFloat(item.quantity)
        let stockBefore = 0

        if (item.sub_variant_id) {
          const row = await client.query<{ inventory_quantity: number }>(
            `SELECT inventory_quantity FROM product_sub_variants WHERE id = $1`, [item.sub_variant_id])
          stockBefore = parseFloat(row.rows[0]?.inventory_quantity as any) || 0
          await client.query(
            `UPDATE product_sub_variants SET inventory_quantity = inventory_quantity + $1 WHERE id = $2`,
            [qty, item.sub_variant_id]
          )
        } else if (item.variant_id) {
          const row = await client.query<{ inventory_quantity: number }>(
            `SELECT inventory_quantity FROM product_variants WHERE id = $1`, [item.variant_id])
          stockBefore = parseFloat(row.rows[0]?.inventory_quantity as any) || 0
          await client.query(
            `UPDATE product_variants SET inventory_quantity = inventory_quantity + $1 WHERE id = $2`,
            [qty, item.variant_id]
          )
        } else {
          const row = await client.query<{ inventory_quantity: number }>(
            `SELECT inventory_quantity FROM products WHERE id = $1`, [item.product_id])
          stockBefore = parseFloat(row.rows[0]?.inventory_quantity as any) || 0
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
          referenceType: 'cash_sale',
          referenceId: id,
          currentStock: stockBefore,
        })
      }
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
