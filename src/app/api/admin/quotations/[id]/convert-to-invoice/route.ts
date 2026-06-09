import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, query, withTransaction } from '@/lib/db'
import { isInterState, generateInvoiceNumber, getNextInvoiceSequence, getFinancialYear } from '@/lib/gst'
import { logStockMovement } from '@/lib/inventory'
import { sendInvoiceFinalizedEmail } from '@/lib/email'
import { lineItemExGst } from '@/lib/pricing'
import { getRazorpayInstance } from '@/lib/razorpay'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'quotations')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

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
    const enableDelivery: boolean = !!body.enableDelivery

    const isBuyerSame = quotation.buyer_same !== false
    const buyerState = isBuyerSame ? quotation.consignee_state : (quotation.buyer_state || quotation.consignee_state)
    const buyerGstin = isBuyerSame ? quotation.consignee_gstin : (quotation.buyer_gstin || quotation.consignee_gstin)
    const sellerStateCode = process.env.BUSINESS_STATE_CODE || '33'
    const orderIsIgst = buyerGstin ? isInterState(buyerState || '', sellerStateCode) : false

    // When buyer_same=false the invoice is billed to the buyer, so use buyer contact details
    const customerName = isBuyerSame
      ? (quotation.consignee_name || '')
      : (quotation.buyer_name || quotation.consignee_name || '')
    const customerPhone = isBuyerSame
      ? (quotation.consignee_phone || quotation.buyer_phone || null)
      : (quotation.buyer_phone || quotation.consignee_phone || null)
    const customerEmail = isBuyerSame
      ? (quotation.consignee_email || quotation.buyer_email || null)
      : (quotation.buyer_email || quotation.consignee_email || null)

    let subtotal = 0
    let totalTaxable = 0
    let totalCgst = 0
    let totalSgst = 0
    let totalIgst = 0

    const processedItems = qItems.map((item: any) => {
      const qty = parseFloat(item.quantity)
      const rate = parseFloat(item.rate)
      const exGstLineTotal = lineItemExGst(qty, rate, parseFloat(item.discount_pct) || 0)
      const gstRate = parseFloat(item.gst_rate || '18')

      let cgst = 0, sgst = 0, igst = 0
      if (gstRate > 0) {
        const lineTax = exGstLineTotal * gstRate / 100
        if (orderIsIgst) {
          igst = lineTax
        } else {
          cgst = lineTax / 2
          sgst = lineTax / 2
        }
      }
      const lineTax = cgst + sgst + igst
      const incGstLineTotal = exGstLineTotal + lineTax

      subtotal += exGstLineTotal
      totalTaxable += exGstLineTotal
      totalCgst += cgst
      totalSgst += sgst
      totalIgst += igst

      return {
        product_id: item.product_id || null,
        product_name: item.description,
        product_sku: '',
        variant_id: item.variant_id || null,
        sub_variant_id: item.sub_variant_id || null,
        variant_name: null,
        hsn_code: item.hsn_code || null,
        gst_rate: gstRate,
        quantity: qty,
        unit_price: Math.round(rate * (1 + gstRate / 100) * 100) / 100,
        total_price: Math.round(incGstLineTotal * 100) / 100,
        taxable_amount: Math.round(exGstLineTotal * 100) / 100,
        cgst_amount: Math.round(cgst * 100) / 100,
        sgst_amount: Math.round(sgst * 100) / 100,
        igst_amount: Math.round(igst * 100) / 100,
        tax_amount: Math.round(lineTax * 100) / 100,
      }
    })

    const taxAmount = Math.round((totalCgst + totalSgst + totalIgst) * 100) / 100
    const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100
    // cash and bank_transfer are immediately paid; upi_qr and credit are unpaid until confirmed
    const isPaid = paymentMode === 'cash' || paymentMode === 'bank_transfer'
    const today = new Date().toISOString()

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
          quotation.consignee_pincode || '',
          quotation.consignee_phone || '',
        ]
      )
      const addressId = addrResult.rows[0].id

      // Check stock for all items first — if any are short, save as draft
      const insufficientItems: string[] = []
      for (const item of processedItems) {
        if (!item.product_id) continue
        const qty = item.quantity
        if (item.sub_variant_id) {
          const inv = await client.query<{ inventory_quantity: number }>(
            'SELECT inventory_quantity FROM product_sub_variants WHERE id = $1 FOR UPDATE',
            [item.sub_variant_id]
          )
          const stock = parseFloat(inv.rows[0]?.inventory_quantity as any) || 0
          if (stock < qty) insufficientItems.push(`${item.product_name}${item.variant_name ? ' / ' + item.variant_name : ''} (available: ${stock}, required: ${qty})`)
        } else if (item.variant_id) {
          const inv = await client.query<{ inventory_quantity: number }>(
            'SELECT inventory_quantity FROM product_variants WHERE id = $1 FOR UPDATE',
            [item.variant_id]
          )
          const stock = parseFloat(inv.rows[0]?.inventory_quantity as any) || 0
          if (stock < qty) insufficientItems.push(`${item.product_name} (available: ${stock}, required: ${qty})`)
        } else {
          const inv = await client.query<{ inventory_quantity: number }>(
            'SELECT inventory_quantity FROM products WHERE id = $1 FOR UPDATE',
            [item.product_id]
          )
          const stock = parseFloat(inv.rows[0]?.inventory_quantity as any) || 0
          if (stock < qty) insufficientItems.push(`${item.product_name} (available: ${stock}, required: ${qty})`)
        }
      }

      const saveAsDraft = insufficientItems.length > 0
      const orderStatus = saveAsDraft ? 'draft' : (enableDelivery ? 'processing' : 'delivered')

      const orderResult = await client.query(
        `INSERT INTO orders (
          order_number, status, payment_status, payment_mode, source,
          customer_name, customer_phone, customer_email,
          buyer_gstin, is_igst,
          shipping_address_id,
          subtotal, tax_amount, taxable_amount,
          cgst_amount, sgst_amount, igst_amount, total_amount,
          needs_delivery, notes
        ) VALUES (
          $1, $2, $3, $4, 'offline',
          $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17,
          $18, $19
        ) RETURNING id, order_number`,
        [
          'OFF-' + Date.now(),
          orderStatus,
          isPaid ? 'paid' : 'unpaid',
          paymentMode,
          customerName,
          customerPhone,
          customerEmail,
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
          enableDelivery && !saveAsDraft,
          `Converted from quotation ${quotation.quote_number}`,
        ]
      )
      const newOrder = orderResult.rows[0]

      let invoiceNumber: string | null = null
      if (!saveAsDraft) {
        const settingsResult = await client.query(`SELECT value FROM site_settings WHERE key = 'invoice_prefix'`)
        const prefix = settingsResult.rows[0]?.value || 'JS'
        const fy = getFinancialYear(new Date())
        const seq = await getNextInvoiceSequence(client, fy)
        invoiceNumber = generateInvoiceNumber(prefix, fy, seq)

        await client.query(
          `UPDATE orders SET invoice_number = $1, invoice_date = $2 WHERE id = $3`,
          [invoiceNumber, today, newOrder.id]
        )
        await client.query(
          `INSERT INTO invoices (order_id, invoice_number, financial_year, sequence_number) VALUES ($1, $2, $3, $4)`,
          [newOrder.id, invoiceNumber, fy, seq]
        )
      }

      for (const item of processedItems) {
        await client.query(
          `INSERT INTO order_items (
            order_id, product_id, product_name, product_sku, variant_id, sub_variant_id, variant_name,
            hsn_code, gst_rate, quantity, unit_price, total_price,
            taxable_amount, cgst_amount, sgst_amount, igst_amount, tax_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            newOrder.id, item.product_id, item.product_name, item.product_sku,
            item.variant_id, item.sub_variant_id, item.variant_name, item.hsn_code, item.gst_rate,
            item.quantity, item.unit_price, item.total_price,
            item.taxable_amount, item.cgst_amount, item.sgst_amount, item.igst_amount, item.tax_amount,
          ]
        )
      }

      if (!saveAsDraft) {
        for (const item of processedItems) {
          if (!item.product_id) continue
          const qty = item.quantity
          let stockBefore = 0
          if (item.sub_variant_id) {
            const row = await client.query<{ inventory_quantity: string }>(
              'SELECT inventory_quantity FROM product_sub_variants WHERE id = $1 FOR UPDATE',
              [item.sub_variant_id]
            )
            stockBefore = parseFloat(row.rows[0]?.inventory_quantity ?? '0') || 0
            await client.query(
              'UPDATE product_sub_variants SET inventory_quantity = inventory_quantity - $1 WHERE id = $2',
              [qty, item.sub_variant_id]
            )
          } else if (item.variant_id) {
            const row = await client.query<{ inventory_quantity: string }>(
              'SELECT inventory_quantity FROM product_variants WHERE id = $1 FOR UPDATE',
              [item.variant_id]
            )
            stockBefore = parseFloat(row.rows[0]?.inventory_quantity ?? '0') || 0
            await client.query(
              'UPDATE product_variants SET inventory_quantity = inventory_quantity - $1 WHERE id = $2',
              [qty, item.variant_id]
            )
          } else {
            const row = await client.query<{ inventory_quantity: string }>(
              'SELECT inventory_quantity FROM products WHERE id = $1 FOR UPDATE',
              [item.product_id]
            )
            stockBefore = parseFloat(row.rows[0]?.inventory_quantity ?? '0') || 0
            await client.query(
              'UPDATE products SET inventory_quantity = inventory_quantity - $1 WHERE id = $2',
              [qty, item.product_id]
            )
          }
          await logStockMovement(client, {
            productId: item.product_id,
            variantId: item.variant_id || null,
            subVariantId: item.sub_variant_id || null,
            transactionType: 'sale',
            quantityChange: -qty,
            referenceType: 'order',
            referenceId: newOrder.id,
            currentStock: stockBefore,
          })
        }
      }

      await client.query(
        `UPDATE quotations SET converted_order_id = $1, updated_at = NOW() WHERE id = $2`,
        [newOrder.id, params.id]
      )

      return { id: newOrder.id, order_number: newOrder.order_number, invoice_number: invoiceNumber, saveAsDraft, insufficientItems }
    })

    if (!result.saveAsDraft && result.invoice_number) {
      if (customerEmail) {
        const invoiceViewUrl = `https://invoice.jeffistores.in/invoice/${result.id}`
        sendInvoiceFinalizedEmail(
          customerEmail,
          customerName,
          result.invoice_number,
          totalAmount,
          result.order_number,
          invoiceViewUrl
        ).catch(() => {})
      }
    }

    // Generate UPI QR after transaction so order ID is available
    let qrImageUrl: string | null = null
    if (!result.saveAsDraft && paymentMode === 'upi_qr') {
      try {
        const rzp = getRazorpayInstance() as any
        const amountPaise = Math.round(totalAmount * 100)
        const closeBy = Math.floor(Date.now() / 1000) + 24 * 60 * 60
        const qr = await rzp.qrCode.create({
          type: 'upi_qr',
          name: `Invoice ${result.invoice_number}`,
          usage: 'single_use',
          fixed_amount: true,
          payment_amount: amountPaise,
          description: `Jeffi Stores Invoice ${result.invoice_number}`,
          close_by: closeBy,
        })
        await query(
          `UPDATE orders SET razorpay_qr_id = $1, razorpay_qr_image_url = $2, updated_at = NOW() WHERE id = $3`,
          [qr.id, qr.image_url, result.id]
        )
        qrImageUrl = qr.image_url
      } catch (_) {
        // QR generation failure is non-fatal — admin can generate from the invoice page
      }
    }

    return NextResponse.json({
      success: true,
      orderId: result.id,
      orderNumber: result.order_number,
      invoiceNumber: result.invoice_number,
      invoiceUrl: result.invoice_number ? `/api/orders/${result.id}/invoice` : null,
      savedAsDraft: result.saveAsDraft,
      insufficientItems: result.insufficientItems,
      qrImageUrl,
      needsDelivery: enableDelivery && !result.saveAsDraft,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
