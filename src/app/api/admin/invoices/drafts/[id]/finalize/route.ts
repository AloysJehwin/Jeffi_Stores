import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction } from '@/lib/db'
import { getFinancialYear, generateInvoiceNumber, getNextInvoiceSequence } from '@/lib/gst'
import { logStockMovement } from '@/lib/inventory'
import { sendInvoiceFinalizedEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const order = await queryOne<any>(
      `SELECT id, status, customer_name, customer_email, total_amount, order_number FROM orders WHERE id = $1`,
      [params.id]
    )
    if (!order) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    if (order.status !== 'draft') return NextResponse.json({ error: 'Invoice is already finalized' }, { status: 400 })

    const result = await withTransaction(async (client) => {
      await client.query(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, [params.id])

      const itemsResult = await client.query(
        `SELECT * FROM order_items WHERE order_id = $1`,
        [params.id]
      )
      const items = itemsResult.rows

      if (!items.length) {
        throw new Error('Cannot finalize an invoice with no items')
      }

      for (const item of items) {
        if (!item.product_id) continue
        const qty = parseFloat(item.quantity)

        if (item.sub_variant_id) {
          const inv = await client.query<{ stock_quantity: number }>(
            `SELECT stock_quantity FROM product_sub_variants WHERE id = $1 FOR UPDATE`,
            [item.sub_variant_id]
          )
          const stock = parseFloat(inv.rows[0]?.stock_quantity as any) || 0
          if (stock < qty) {
            throw new Error(
              `Insufficient stock for "${item.product_name}${item.variant_name ? ' / ' + item.variant_name : ''}" — available: ${stock}, required: ${qty}`
            )
          }
          await client.query(
            `UPDATE product_sub_variants SET stock_quantity = stock_quantity - $1 WHERE id = $2`,
            [qty, item.sub_variant_id]
          )
        } else if (item.variant_id) {
          const inv = await client.query<{ inventory_quantity: number }>(
            `SELECT inventory_quantity FROM product_variants WHERE id = $1 FOR UPDATE`,
            [item.variant_id]
          )
          const stock = parseFloat(inv.rows[0]?.inventory_quantity as any) || 0
          if (stock < qty) {
            throw new Error(
              `Insufficient stock for "${item.product_name}${item.variant_name ? ' / ' + item.variant_name : ''}" — available: ${stock}, required: ${qty}`
            )
          }
          await client.query(
            `UPDATE product_variants SET inventory_quantity = inventory_quantity - $1 WHERE id = $2`,
            [qty, item.variant_id]
          )
        } else {
          const inv = await client.query<{ inventory_quantity: number }>(
            `SELECT inventory_quantity FROM products WHERE id = $1 FOR UPDATE`,
            [item.product_id]
          )
          const stock = parseFloat(inv.rows[0]?.inventory_quantity as any) || 0
          if (stock < qty) {
            throw new Error(
              `Insufficient stock for "${item.product_name}" — available: ${stock}, required: ${qty}`
            )
          }
          await client.query(
            `UPDATE products SET inventory_quantity = inventory_quantity - $1 WHERE id = $2`,
            [qty, item.product_id]
          )
        }

        await logStockMovement(client, {
          productId: item.product_id,
          variantId: item.variant_id || null,
          transactionType: 'sale',
          quantityChange: -qty,
          referenceType: 'order',
          referenceId: params.id,
        })
      }

      const isGSTEnabled = process.env.ENABLE_GST === 'true'
      let invoiceNumber: string | null = null

      if (isGSTEnabled) {
        const settingsResult = await client.query(`SELECT value FROM site_settings WHERE key = 'invoice_prefix'`)
        const prefix = settingsResult.rows[0]?.value || 'JS'
        const fy = getFinancialYear(new Date())
        const seq = await getNextInvoiceSequence(client, fy)
        invoiceNumber = generateInvoiceNumber(prefix, fy, seq)
        const invoiceDate = new Date().toISOString()

        await client.query(
          `UPDATE orders SET invoice_number = $1, invoice_date = $2, status = 'delivered', updated_at = NOW() WHERE id = $3`,
          [invoiceNumber, invoiceDate, params.id]
        )
        await client.query(
          `INSERT INTO invoices (order_id, invoice_number, financial_year, sequence_number) VALUES ($1, $2, $3, $4)`,
          [params.id, invoiceNumber, fy, seq]
        )
      } else {
        await client.query(
          `UPDATE orders SET status = 'delivered', invoice_date = NOW(), updated_at = NOW() WHERE id = $1`,
          [params.id]
        )
      }

      return { invoiceNumber, orderId: params.id }
    })

    if (result.invoiceNumber && order.customer_email) {
      try {
        await sendInvoiceFinalizedEmail(order.customer_email, order.customer_name, result.invoiceNumber, Number(order.total_amount), order.order_number)
      } catch (_) {}
    }

    return NextResponse.json({
      success: true,
      invoiceNumber: result.invoiceNumber,
      invoiceUrl: result.invoiceNumber ? `/api/orders/${result.orderId}/invoice` : null,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
