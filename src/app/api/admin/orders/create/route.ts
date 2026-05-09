import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { withTransaction, queryMany } from '@/lib/db'
import { generateOrderInvoice } from '@/lib/invoice'
import { isInterState, calculateGST, getFinancialYear, generateInvoiceNumber, getNextInvoiceSequence } from '@/lib/gst'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const {
      customerName,
      customerPhone,
      customerEmail,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      buyerGstin,
      paymentMode,
      items,
      notes,
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
    const totalAmount = Math.round((subtotal) * 100) / 100

    const result = await withTransaction(async (client) => {
      const addrResult = await client.query(
        `INSERT INTO addresses (full_name, address_line1, address_line2, city, state, postal_code, phone, address_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'shipping')
         RETURNING id`,
        [customerName, addressLine1 || '', addressLine2 || null, city || '', state || '', postalCode || '', customerPhone || '']
      )
      const addressId = addrResult.rows[0].id

      const ts = Date.now()
      const rand = Math.random().toString(36).substring(2, 8).toUpperCase()
      const orderNumber = `OFF-${ts}-${rand}`

      const orderResult = await client.query(
        `INSERT INTO orders (
          order_number, customer_name, customer_phone, customer_email,
          subtotal, tax_amount, total_amount, discount_amount, shipping_amount,
          taxable_amount, cgst_amount, sgst_amount, igst_amount, is_igst,
          buyer_gstin, payment_status, status, source,
          shipping_address_id, billing_address_id,
          notes
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, 0, 0,
          $8, $9, $10, $11, $12,
          $13, $14, 'confirmed', 'offline',
          $15, $15,
          $16
        ) RETURNING id, order_number`,
        [
          orderNumber, customerName, customerPhone || '', customerEmail || '',
          subtotal, taxAmount, totalAmount,
          Math.round(totalTaxable * 100) / 100,
          Math.round(totalCgst * 100) / 100,
          Math.round(totalSgst * 100) / 100,
          Math.round(totalIgst * 100) / 100,
          orderIsIgst,
          buyerGstin || null,
          paymentMode === 'credit' ? 'unpaid' : 'paid',
          addressId,
          notes || null,
        ]
      )
      const orderId = orderResult.rows[0].id
      const finalOrderNumber = orderResult.rows[0].order_number

      for (const item of processedItems) {
        await client.query(
          `INSERT INTO order_items (
            order_id, product_id, product_name, product_sku, variant_id, variant_name,
            hsn_code, gst_rate, quantity, unit_price, discount_amount, tax_amount,
            total_price, taxable_amount, cgst_amount, sgst_amount, igst_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$12,$13,$14,$15,$16)`,
          [
            orderId, item.product_id, item.product_name, item.product_sku,
            item.variant_id, item.variant_name,
            item.hsn_code, item.gst_rate, item.quantity, item.unit_price,
            item.tax_amount, item.total_price, item.taxable_amount,
            item.cgst_amount, item.sgst_amount, item.igst_amount,
          ]
        )
      }

      const isGSTEnabled = process.env.ENABLE_GST === 'true'
      let invoiceNumber: string | null = null

      if (isGSTEnabled) {
        const settingsResult = await client.query("SELECT value FROM site_settings WHERE key = 'invoice_prefix'")
        const prefix = settingsResult.rows[0]?.value || 'JS'
        const fy = getFinancialYear(new Date())
        const seq = await getNextInvoiceSequence(client, fy)
        invoiceNumber = generateInvoiceNumber(prefix, fy, seq)
        const invoiceDate = new Date().toISOString()

        await client.query(
          `UPDATE orders SET invoice_number = $1, invoice_date = $2 WHERE id = $3`,
          [invoiceNumber, invoiceDate, orderId]
        )
        await client.query(
          'INSERT INTO invoices (order_id, invoice_number, financial_year, sequence_number) VALUES ($1, $2, $3, $4)',
          [orderId, invoiceNumber, fy, seq]
        )
      }

      return { orderId, orderNumber: finalOrderNumber, invoiceNumber }
    })

    return NextResponse.json({
      success: true,
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      invoiceNumber: result.invoiceNumber,
      invoiceUrl: result.invoiceNumber ? `/api/orders/${result.orderId}/invoice` : null,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
