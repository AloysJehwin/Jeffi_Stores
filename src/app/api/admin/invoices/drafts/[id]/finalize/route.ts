import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, withTransaction } from '@/lib/db'
import { getFinancialYear, generateInvoiceNumber, getNextInvoiceSequence } from '@/lib/gst'
import { logStockMovement } from '@/lib/inventory'
import { sendInvoiceFinalizedEmail, sendOrderStatusUpdate } from '@/lib/email'
import { generateOrderInvoice } from '@/lib/invoice'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    let batchAssignments: { order_item_id: string; batch_id: string }[] = []
    try {
      const body = await request.json()
      if (Array.isArray(body?.batch_assignments)) batchAssignments = body.batch_assignments
    } catch (_) {}

    const order = await queryOne<any>(
      `SELECT id, status, source, customer_name, customer_email, total_amount, order_number FROM orders WHERE id = $1`,
      [id]
    )
    if (!order) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    const allowedStatuses = ['draft', 'confirmed', 'delivered', 'processing']
    if (!allowedStatuses.includes(order.status)) {
      return NextResponse.json({ error: 'Invoice is already finalized' }, { status: 400 })
    }

    const isOnlineOrder = order.source === 'online' || order.source === 'business'
    // If already delivered, keep status unchanged; otherwise move online/business→processing, offline→delivered
    const targetStatus = order.status === 'delivered' ? 'delivered' : (isOnlineOrder ? 'processing' : 'delivered')

    const result = await withTransaction(async (client) => {
      await client.query(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, [id])

      const itemsResult = await client.query(
        `SELECT * FROM order_items WHERE order_id = $1`,
        [id]
      )
      const items = itemsResult.rows

      if (!items.length) {
        throw new Error('Cannot finalize an invoice with no items')
      }

      for (const item of items) {
        if (!item.product_id) continue
        const qty = parseFloat(item.quantity)

        // For count-dimension selling units (box, set, etc.), inventory is tracked in
        // individual pieces. Multiply ordered qty by factor to get pieces to deduct.
        // Prefer variant-scoped product_units row; fall back to product-level; fall back to sell_unit_id.
        const unitRow = await client.query<{ factor: string; dimension: string }>(
          `SELECT COALESCE(puv.factor, pup.factor, pu_sv.factor, pu_sp.factor)::text AS factor,
                  COALESCE(puv.dimension, pup.dimension, pu_sv.dimension, pu_sp.dimension) AS dimension
           FROM (SELECT 1) x
           LEFT JOIN product_units puv ON puv.unit = $1 AND puv.product_id = $2 AND puv.variant_id = $3 AND $1 IS NOT NULL
           LEFT JOIN product_units pup ON pup.unit = $1 AND pup.product_id = $2 AND pup.variant_id IS NULL AND $1 IS NOT NULL
             AND ($3 IS NULL OR puv.id IS NULL)
           LEFT JOIN product_variants pvar ON pvar.id = $3
           LEFT JOIN product_units pu_sv ON pu_sv.id = pvar.sell_unit_id AND puv.id IS NULL AND pup.id IS NULL
           LEFT JOIN products prod ON prod.id = $2 AND $3 IS NULL
           LEFT JOIN product_units pu_sp ON pu_sp.id = prod.sell_unit_id AND puv.id IS NULL AND pup.id IS NULL`,
          [item.buy_unit || null, item.product_id, item.variant_id || null]
        )
        const unit = unitRow.rows[0]
        const effectiveQty = (unit?.dimension === 'count' && unit?.factor)
          ? qty * parseFloat(unit.factor)
          : qty

        const assignedBatchId = batchAssignments.find(
          a => a.order_item_id === item.id
        )?.batch_id ?? null

        let batchQty = 0
        if (assignedBatchId) {
          const br = await client.query<{ quantity_remaining: string }>(
            `SELECT quantity_remaining FROM product_batches WHERE id = $1`, [assignedBatchId]
          )
          batchQty = parseFloat(br.rows[0]?.quantity_remaining ?? '0') || 0
        }

        let stockBefore = 0
        // When batch assigned, only check/use batch qty — inventory_quantity is untouched
        if (assignedBatchId) {
          if (batchQty < effectiveQty) {
            throw new Error(
              `Insufficient batch stock for "${item.product_name}${item.variant_name ? ' / ' + item.variant_name : ''}" — batch available: ${batchQty}, required: ${effectiveQty}`
            )
          }
          stockBefore = batchQty
        } else if (item.sub_variant_id) {
          const inv = await client.query<{ inventory_quantity: number }>(
            `SELECT inventory_quantity FROM product_sub_variants WHERE id = $1 FOR UPDATE`,
            [item.sub_variant_id]
          )
          const stock = parseFloat(inv.rows[0]?.inventory_quantity as any) || 0
          stockBefore = stock
          if (stock < effectiveQty) {
            throw new Error(
              `Insufficient stock for "${item.product_name}${item.variant_name ? ' / ' + item.variant_name : ''}" — available: ${stock}, required: ${effectiveQty}`
            )
          }
          await client.query(
            `UPDATE product_sub_variants SET inventory_quantity = inventory_quantity - $1 WHERE id = $2`,
            [effectiveQty, item.sub_variant_id]
          )
        } else if (item.variant_id) {
          const inv = await client.query<{ inventory_quantity: number; has_sub_variants: boolean }>(
            `SELECT pv.inventory_quantity,
               EXISTS(SELECT 1 FROM product_sub_variants WHERE variant_id = pv.id AND is_active = true) AS has_sub_variants
             FROM product_variants pv WHERE pv.id = $1 FOR UPDATE`,
            [item.variant_id]
          )
          let stock = parseFloat(inv.rows[0]?.inventory_quantity as any) || 0
          if (inv.rows[0]?.has_sub_variants) {
            const svStock = await client.query<{ total: number }>(
              `SELECT COALESCE(SUM(inventory_quantity), 0) AS total FROM product_sub_variants WHERE variant_id = $1 AND is_active = true`,
              [item.variant_id]
            )
            stock = parseFloat(svStock.rows[0]?.total as any) || 0
          }
          stockBefore = stock
          if (stock < effectiveQty) {
            throw new Error(
              `Insufficient stock for "${item.product_name}${item.variant_name ? ' / ' + item.variant_name : ''}" — available: ${stock}, required: ${effectiveQty}`
            )
          }
          if (inv.rows[0]?.has_sub_variants) {
            await client.query(
              `UPDATE product_sub_variants SET inventory_quantity = inventory_quantity - $1
               WHERE variant_id = $2 AND sku = $3 AND is_active = true`,
              [effectiveQty, item.variant_id, item.product_sku]
            )
          } else {
            await client.query(
              `UPDATE product_variants SET inventory_quantity = inventory_quantity - $1 WHERE id = $2`,
              [effectiveQty, item.variant_id]
            )
          }
        } else {
          const inv = await client.query<{ inventory_quantity: number }>(
            `SELECT inventory_quantity FROM products WHERE id = $1 FOR UPDATE`,
            [item.product_id]
          )
          const stock = parseFloat(inv.rows[0]?.inventory_quantity as any) || 0
          stockBefore = stock
          if (stock < effectiveQty) {
            throw new Error(
              `Insufficient stock for "${item.product_name}" — available: ${stock}, required: ${effectiveQty}`
            )
          }
          await client.query(
            `UPDATE products SET inventory_quantity = inventory_quantity - $1 WHERE id = $2`,
            [effectiveQty, item.product_id]
          )
        }

        if (assignedBatchId) {
          await client.query(
            `UPDATE product_batches SET quantity_remaining = quantity_remaining - $1, updated_at = NOW() WHERE id = $2`,
            [effectiveQty, assignedBatchId]
          )
          await client.query(
            `UPDATE order_items SET batch_id = $1 WHERE id = $2`,
            [assignedBatchId, item.id]
          )
        }

        await logStockMovement(client, {
          productId: item.product_id,
          variantId: item.variant_id || null,
          subVariantId: item.sub_variant_id || null,
          transactionType: 'sale',
          quantityChange: -effectiveQty,
          referenceType: 'order',
          referenceId: id,
          currentStock: stockBefore,
          batchId: assignedBatchId,
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
          `UPDATE orders SET invoice_number = $1, invoice_date = $2, status = $3, updated_at = NOW() WHERE id = $4`,
          [invoiceNumber, invoiceDate, targetStatus, id]
        )

        if (isOnlineOrder) {
          // Update the existing draft invoice row rather than inserting a new one
          await client.query(
            `UPDATE invoices SET invoice_number = $1, financial_year = $2, sequence_number = $3, status = 'finalized', updated_at = NOW()
             WHERE order_id = $4 AND status = 'draft'`,
            [invoiceNumber, fy, seq, id]
          )
        } else {
          await client.query(
            `INSERT INTO invoices (order_id, invoice_number, financial_year, sequence_number) VALUES ($1, $2, $3, $4)`,
            [id, invoiceNumber, fy, seq]
          )
        }
      } else {
        await client.query(
          `UPDATE orders SET status = $1, invoice_date = NOW(), updated_at = NOW() WHERE id = $2`,
          [targetStatus, id]
        )
      }

      return { invoiceNumber, orderId: id }
    })

    if (result.invoiceNumber) {
      if (isOnlineOrder && order.customer_email) {
        try {
          const pdfBuffer = await generateOrderInvoice(id)
          await sendOrderStatusUpdate(
            order.customer_email,
            order.customer_name,
            order.order_number,
            id,
            'processing',
            undefined,
            pdfBuffer,
          )
        } catch (_) {}
      } else if (!isOnlineOrder && order.customer_email) {
        try {
          await sendInvoiceFinalizedEmail(order.customer_email, order.customer_name, result.invoiceNumber, Number(order.total_amount), order.order_number)
        } catch (_) {}
      }
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
