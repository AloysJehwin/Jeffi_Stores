import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, withTransaction } from '@/lib/db'
import { isInterState, calculateGST, generateInvoiceNumber, getNextInvoiceSequence, getFinancialYear } from '@/lib/gst'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const order = await queryOne<any>(
      `SELECT id, source, invoice_number FROM orders WHERE id = $1`,
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

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE orders SET
          customer_name = $1, customer_phone = $2, customer_email = $3,
          buyer_gstin = $4, is_igst = $5,
          subtotal = $6, tax_amount = $7, taxable_amount = $8,
          cgst_amount = $9, sgst_amount = $10, igst_amount = $11,
          total_amount = $12, payment_status = $13,
          invoice_date = $14, notes = $15,
          updated_at = NOW()
        WHERE id = $16`,
        [
          customerName, customerPhone || null, customerEmail || null,
          buyerGstin || null, orderIsIgst,
          subtotal, taxAmount, Math.round(totalTaxable * 100) / 100,
          Math.round(totalCgst * 100) / 100, Math.round(totalSgst * 100) / 100, Math.round(totalIgst * 100) / 100,
          totalAmount, isPaid ? 'paid' : 'unpaid',
          effectiveDate, notes || null,
          params.id,
        ]
      )

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
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
