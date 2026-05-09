import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, queryMany, withTransaction } from '@/lib/db'
import { isInterState, calculateGST, generateInvoiceNumber, getNextInvoiceSequence, getFinancialYear } from '@/lib/gst'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const quotation = await queryOne<any>(`SELECT * FROM quotations WHERE id = $1`, [params.id])
    if (!quotation) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 })
    if (quotation.status !== 'final') {
      return NextResponse.json({ error: 'Only finalised quotations can be converted to an invoice' }, { status: 400 })
    }
    if (quotation.converted_order_id) {
      return NextResponse.json({ error: 'This quotation has already been converted to an invoice' }, { status: 400 })
    }

    const qItems = await queryMany<any>(
      `SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY position`,
      [params.id]
    )
    if (!qItems.length) {
      return NextResponse.json({ error: 'Quotation has no line items' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const paymentMode: string = body.paymentMode || 'cash'

    const buyerState = quotation.buyer_same ? quotation.consignee_state : (quotation.buyer_state || quotation.consignee_state)
    const buyerGstin = quotation.buyer_same ? quotation.consignee_gstin : (quotation.buyer_gstin || quotation.consignee_gstin)
    const sellerStateCode = process.env.BUSINESS_STATE_CODE || '33'
    const orderIsIgst = buyerGstin ? isInterState(buyerState || '', sellerStateCode) : false

    let subtotal = 0
    let totalTaxable = 0
    let totalCgst = 0
    let totalSgst = 0
    let totalIgst = 0

    const processedItems = qItems.map((item: any) => {
      const qty = parseFloat(item.quantity)
      const rate = parseFloat(item.rate)
      const discountFactor = 1 - (parseFloat(item.discount_pct) || 0) / 100
      const lineTotal = qty * rate * discountFactor
      const gstRate = parseFloat(item.gst_rate || '18')
      const gst = calculateGST(lineTotal, gstRate, orderIsIgst)

      subtotal += lineTotal
      totalTaxable += gst.taxableAmount
      totalCgst += gst.cgst
      totalSgst += gst.sgst
      totalIgst += gst.igst

      return {
        product_id: item.product_id || null,
        product_name: item.description,
        product_sku: '',
        variant_id: item.variant_id || null,
        variant_name: null,
        hsn_code: item.hsn_code || null,
        gst_rate: gstRate,
        quantity: qty,
        unit_price: parseFloat((rate * discountFactor).toFixed(4)),
        total_price: Math.round(lineTotal * 100) / 100,
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
    const today = new Date().toISOString().slice(0, 10)

    const result = await withTransaction(async (client) => {
      const addrResult = await client.query(
        `INSERT INTO addresses (full_name, address_line1, address_line2, city, state, postal_code, phone, address_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'shipping')
         RETURNING id`,
        [
          quotation.consignee_name,
          quotation.consignee_addr1 || '',
          quotation.consignee_addr2 || null,
          quotation.consignee_city || '',
          quotation.consignee_state || '',
          '',
          '',
        ]
      )
      const addressId = addrResult.rows[0].id

      const orderResult = await client.query(
        `INSERT INTO orders (
          order_number, status, payment_status, source,
          customer_name, customer_phone, customer_email,
          buyer_gstin, is_igst,
          shipping_address_id,
          subtotal, tax_amount, taxable_amount,
          cgst_amount, sgst_amount, igst_amount, total_amount,
          notes
        ) VALUES (
          $1, 'delivered', $2, 'offline',
          $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15,
          $16
        ) RETURNING id, order_number`,
        [
          'OFF-' + Date.now(),
          isPaid ? 'paid' : 'unpaid',
          quotation.consignee_name,
          null,
          null,
          buyerGstin || null,
          orderIsIgst,
          addressId,
          subtotal,
          taxAmount,
          Math.round(totalTaxable * 100) / 100,
          Math.round(totalCgst * 100) / 100,
          Math.round(totalSgst * 100) / 100,
          Math.round(totalIgst * 100) / 100,
          totalAmount,
          `Converted from quotation ${quotation.quote_number}`,
        ]
      )
      const newOrder = orderResult.rows[0]

      const settingsResult = await client.query(`SELECT value FROM site_settings WHERE key = 'invoice_prefix'`)
      const prefix = settingsResult.rows[0]?.value || 'JS'
      const fy = getFinancialYear(new Date())
      const seq = await getNextInvoiceSequence(client, fy)
      const invoiceNumber = generateInvoiceNumber(prefix, fy, seq)

      await client.query(
        `UPDATE orders SET invoice_number = $1, invoice_date = $2 WHERE id = $3`,
        [invoiceNumber, today, newOrder.id]
      )
      await client.query(
        `INSERT INTO invoices (order_id, invoice_number, financial_year, sequence_number) VALUES ($1, $2, $3, $4)`,
        [newOrder.id, invoiceNumber, fy, seq]
      )

      for (const item of processedItems) {
        await client.query(
          `INSERT INTO order_items (
            order_id, product_id, product_name, product_sku, variant_id, variant_name,
            hsn_code, gst_rate, quantity, unit_price, total_price,
            taxable_amount, cgst_amount, sgst_amount, igst_amount, tax_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            newOrder.id, item.product_id, item.product_name, item.product_sku,
            item.variant_id, item.variant_name, item.hsn_code, item.gst_rate,
            item.quantity, item.unit_price, item.total_price,
            item.taxable_amount, item.cgst_amount, item.sgst_amount, item.igst_amount, item.tax_amount,
          ]
        )
      }

      await client.query(
        `UPDATE quotations SET converted_order_id = $1, updated_at = NOW() WHERE id = $2`,
        [newOrder.id, params.id]
      )

      return { id: newOrder.id, order_number: newOrder.order_number, invoice_number: invoiceNumber }
    })

    return NextResponse.json({
      success: true,
      orderId: result.id,
      orderNumber: result.order_number,
      invoiceNumber: result.invoice_number,
      invoiceUrl: `/api/orders/${result.id}/invoice`,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
