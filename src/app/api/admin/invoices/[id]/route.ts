import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction } from '@/lib/db'
import { isInterState, calculateGST, generateInvoiceNumber, getNextInvoiceSequence, getFinancialYear } from '@/lib/gst'
import { logStockMovement } from '@/lib/inventory'
import { sendInvoiceFinalizedEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'invoices')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const order = await queryOne<any>(
      `SELECT id, source, invoice_number, status FROM orders WHERE id = $1`,
      [params.id]
    )
    if (!order) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    if (order.source !== 'offline') return NextResponse.json({ error: 'Only offline invoices can be edited' }, { status: 400 })

    const body = await request.json()
    const {
      customerName, customerPhone, customerEmail,
      addressLine1, addressLine2, city, state, postalCode,
      buyerGstin, paymentMode, invoiceDate, notes, items,
    } = body

    if (!customerName || !items?.length) {
      return NextResponse.json({ error: 'customerName and items are required' }, { status: 400 })
    }

    const sellerStateCode = process.env.BUSINESS_STATE_CODE || '33'
    const orderIsIgst = buyerGstin ? isInterState(state || '', sellerStateCode) : false

    let subtotal = 0
    let totalTaxable = 0
    let totalCgst = 0
    let totalSgst = 0
    let totalIgst = 0

    const processedItems = items.map((item: any) => {
      const unitPrice = parseFloat(item.unit_price)
      const qty = parseFloat(item.quantity)
      const lineTotal = unitPrice * qty
      const gstRate = parseFloat(item.gst_rate || '18')
      const gst = calculateGST(lineTotal, gstRate, orderIsIgst)

      subtotal += lineTotal
      totalTaxable += gst.taxableAmount
      totalCgst += gst.cgst
      totalSgst += gst.sgst
      totalIgst += gst.igst

      return {
        product_id: item.product_id || null,
        product_name: item.product_name,
        product_sku: item.product_sku || '',
        variant_id: item.variant_id || null,
        variant_name: item.variant_name || null,
        hsn_code: item.hsn_code || null,
        gst_rate: gstRate,
        quantity: qty,
        unit_price: unitPrice,
        total_price: lineTotal,
        taxable_amount: Math.round(gst.taxableAmount * 100) / 100,
        cgst_amount: Math.round(gst.cgst * 100) / 100,
        sgst_amount: Math.round(gst.sgst * 100) / 100,
        igst_amount: Math.round(gst.igst * 100) / 100,
        tax_amount: Math.round((gst.cgst + gst.sgst + gst.igst) * 100) / 100,
      }
    })

    const taxAmount = Math.round((totalCgst + totalSgst + totalIgst) * 100) / 100
    const totalAmount = Math.round(subtotal * 100) / 100
    const isPaid = paymentMode !== 'credit'
    const effectiveDate = invoiceDate || new Date().toISOString().slice(0, 10)

    const result = await withTransaction(async (client) => {
      const existingResult = await client.query<{ product_id: string | null; variant_id: string | null; quantity: string }>(
        `SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1`,
        [params.id]
      )

      const existingQtyMap = new Map<string, number>()
      for (const r of existingResult.rows) {
        const key = `${r.product_id ?? ''}::${r.variant_id ?? ''}`
        existingQtyMap.set(key, (existingQtyMap.get(key) ?? 0) + parseFloat(r.quantity))
      }

      const insufficientItems: string[] = []

      for (const item of processedItems) {
        if (!item.product_id) continue
        const key = `${item.product_id}::${item.variant_id ?? ''}`
        const previousQty = existingQtyMap.get(key) ?? 0
        const extraQty = item.quantity - previousQty
        if (extraQty <= 0) continue

        if (item.variant_id) {
          const inv = await client.query<{ inventory_quantity: string }>(
            `SELECT inventory_quantity FROM product_variants WHERE id = $1 FOR UPDATE`,
            [item.variant_id]
          )
          const stock = parseFloat(inv.rows[0]?.inventory_quantity ?? '0') || 0
          if (stock < extraQty) {
            insufficientItems.push(
              `${item.product_name}${item.variant_name ? ' / ' + item.variant_name : ''} (available: ${stock}, extra needed: ${extraQty})`
            )
          }
        } else {
          const inv = await client.query<{ inventory_quantity: string }>(
            `SELECT inventory_quantity FROM products WHERE id = $1 FOR UPDATE`,
            [item.product_id]
          )
          const stock = parseFloat(inv.rows[0]?.inventory_quantity ?? '0') || 0
          if (stock < extraQty) {
            insufficientItems.push(`${item.product_name} (available: ${stock}, extra needed: ${extraQty})`)
          }
        }
      }

      const moveToDraft = insufficientItems.length > 0

      await client.query(
        `UPDATE orders SET
          customer_name = $1, customer_phone = $2, customer_email = $3,
          buyer_gstin = $4, is_igst = $5,
          subtotal = $6, tax_amount = $7, taxable_amount = $8,
          cgst_amount = $9, sgst_amount = $10, igst_amount = $11,
          total_amount = $12, payment_status = $13,
          invoice_date = $14, notes = $15,
          status = $16, invoice_number = $17,
          updated_at = NOW()
        WHERE id = $18`,
        [
          customerName, customerPhone || null, customerEmail || null,
          buyerGstin || null, orderIsIgst,
          subtotal, taxAmount, Math.round(totalTaxable * 100) / 100,
          Math.round(totalCgst * 100) / 100, Math.round(totalSgst * 100) / 100, Math.round(totalIgst * 100) / 100,
          totalAmount, isPaid ? 'paid' : 'unpaid',
          effectiveDate, notes || null,
          moveToDraft ? 'draft' : order.status,
          moveToDraft ? null : order.invoice_number,
          params.id,
        ]
      )

      if (moveToDraft && order.invoice_number) {
        await client.query(`DELETE FROM invoices WHERE order_id = $1`, [params.id])
      }

      if (addressLine1) {
        await client.query(
          `UPDATE addresses SET
            full_name = $1, address_line1 = $2, address_line2 = $3,
            city = $4, state = $5, postal_code = $6
          WHERE id = (SELECT shipping_address_id FROM orders WHERE id = $7)`,
          [customerName, addressLine1, addressLine2 || null, city || '', state || '', postalCode || '', params.id]
        )
      }

      await client.query(`DELETE FROM order_items WHERE order_id = $1`, [params.id])

      for (const item of processedItems) {
        await client.query(
          `INSERT INTO order_items (
            order_id, product_id, product_name, product_sku, variant_id, variant_name,
            hsn_code, gst_rate, quantity, unit_price, total_price,
            taxable_amount, cgst_amount, sgst_amount, igst_amount, tax_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            params.id, item.product_id, item.product_name, item.product_sku,
            item.variant_id, item.variant_name, item.hsn_code, item.gst_rate,
            item.quantity, item.unit_price, item.total_price,
            item.taxable_amount, item.cgst_amount, item.sgst_amount, item.igst_amount, item.tax_amount,
          ]
        )
      }

      if (!moveToDraft) {
        for (const item of processedItems) {
          if (!item.product_id) continue
          const key = `${item.product_id}::${item.variant_id ?? ''}`
          const previousQty = existingQtyMap.get(key) ?? 0
          const extraQty = item.quantity - previousQty
          if (extraQty <= 0) continue

          if (item.variant_id) {
            await client.query(
              `UPDATE product_variants SET inventory_quantity = inventory_quantity - $1 WHERE id = $2`,
              [extraQty, item.variant_id]
            )
          } else {
            await client.query(
              `UPDATE products SET inventory_quantity = inventory_quantity - $1 WHERE id = $2`,
              [extraQty, item.product_id]
            )
          }
          await logStockMovement(client, {
            productId: item.product_id!,
            variantId: item.variant_id || null,
            transactionType: 'sale',
            quantityChange: -extraQty,
            referenceType: 'order',
            referenceId: params.id,
          })
        }
      }

      return { moveToDraft, insufficientItems }
    })

    if (result.moveToDraft) {
      return NextResponse.json({
        success: true,
        movedToDraft: true,
        insufficientItems: result.insufficientItems,
      })
    }

    if (order.invoice_number && customerEmail) {
      try {
        await sendInvoiceFinalizedEmail(customerEmail, customerName, order.invoice_number, totalAmount)
      } catch (_) {}
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
