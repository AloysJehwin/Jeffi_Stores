import { NextRequest, NextResponse } from 'next/server'
import { queryOne, queryMany, query } from '@/lib/db'
import { authenticateUser, authenticateAdmin } from '@/lib/jwt'
import { generateInvoicePDF, InvoiceBusinessSettings, InvoiceOrder, InvoiceOrderItem, InvoiceBuyerAddress } from '@/lib/invoice-pdf'
import { uploadInvoicePDF } from '@/lib/s3'
import { getFinancialYear } from '@/lib/gst'
import { generateOrderInvoice } from '@/lib/invoice'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userAuth = await authenticateUser(request)
    const adminAuth = await authenticateAdmin(request)

    if (!userAuth && !adminAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orderId = params.id

    const order = await queryOne(
      `SELECT o.*, a.full_name, a.address_line1, a.address_line2, a.city, a.state, a.postal_code, a.phone AS address_phone
       FROM orders o
       LEFT JOIN addresses a ON o.shipping_address_id = a.id
       WHERE o.id = $1`,
      [orderId]
    )

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (userAuth && !adminAuth && order.user_id !== userAuth.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!order.invoice_number) {
      return NextResponse.json({ error: 'Invoice not available for this order' }, { status: 404 })
    }

    const invoiceRecord = await queryOne(
      'SELECT pdf_url FROM invoices WHERE order_id = $1',
      [orderId]
    )

    if (invoiceRecord?.pdf_url && order.status !== 'cancelled') {
      return NextResponse.redirect(invoiceRecord.pdf_url)
    }

    const orderItems = await queryMany(
      'SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at',
      [orderId]
    )

    const settingsRows = await queryMany(
      "SELECT key, value FROM site_settings WHERE key LIKE 'business_%' OR key LIKE 'bank_%' OR key = 'invoice_prefix'",
      []
    )
    const settings: Record<string, string> = {}
    for (const row of (settingsRows || [])) {
      settings[row.key] = row.value || ''
    }

    const business: InvoiceBusinessSettings = {
      gstin: settings.business_gstin || '',
      legalName: settings.business_legal_name || '',
      tradeName: settings.business_trade_name || '',
      address: settings.business_address || '',
      state: settings.business_state || '',
      stateCode: settings.business_state_code || '',
      phone: settings.business_phone || '',
      email: settings.business_email || '',
      bankName: settings.bank_name || '',
      bankAccount: settings.bank_account || '',
      bankIfsc: settings.bank_ifsc || '',
      bankBranch: settings.bank_branch || '',
    }

    const invoiceOrder: InvoiceOrder = {
      order_number: order.order_number,
      invoice_number: order.invoice_number,
      invoice_date: order.invoice_date || order.created_at,
      customer_name: order.customer_name,
      subtotal: parseFloat(order.subtotal),
      tax_amount: parseFloat(order.tax_amount),
      total_amount: parseFloat(order.total_amount),
      taxable_amount: parseFloat(order.taxable_amount || '0'),
      cgst_amount: parseFloat(order.cgst_amount || '0'),
      sgst_amount: parseFloat(order.sgst_amount || '0'),
      igst_amount: parseFloat(order.igst_amount || '0'),
      is_igst: order.is_igst || false,
      buyer_gstin: order.buyer_gstin || null,
      order_date: order.created_at,
      payment_mode: order.payment_status === 'paid' ? 'Online Payment' : '',
      tracking_number: order.tracking_number || '',
      shipped_at: order.shipped_at || '',
      shipping_method: order.shipping_method || '',
      destination: [order.city, order.state].filter(Boolean).join(', '),
    }

    const invoiceItems: InvoiceOrderItem[] = (orderItems || []).map((item: any) => ({
      product_name: item.product_name,
      hsn_code: item.hsn_code || null,
      gst_rate: parseFloat(item.gst_rate || '0'),
      quantity: item.quantity,
      unit_price: parseFloat(item.unit_price),
      total_price: parseFloat(item.total_price),
      taxable_amount: parseFloat(item.taxable_amount || '0'),
      cgst_amount: parseFloat(item.cgst_amount || '0'),
      sgst_amount: parseFloat(item.sgst_amount || '0'),
      igst_amount: parseFloat(item.igst_amount || '0'),
    }))

    const buyerAddress: InvoiceBuyerAddress = {
      full_name: order.full_name || order.customer_name || '',
      address_line1: order.address_line1 || '',
      address_line2: order.address_line2 || null,
      city: order.city || '',
      state: order.state || '',
      postal_code: order.postal_code || '',
      phone: order.address_phone || order.customer_phone || '',
    }

    let billingAddress: InvoiceBuyerAddress | undefined
    if (order.billing_address_id && order.billing_address_id !== order.shipping_address_id) {
      const billAddr = await queryOne(
        'SELECT full_name, address_line1, address_line2, city, state, postal_code, phone FROM addresses WHERE id = $1',
        [order.billing_address_id]
      )
      if (billAddr) {
        billingAddress = {
          full_name: billAddr.full_name || '',
          address_line1: billAddr.address_line1 || '',
          address_line2: billAddr.address_line2 || null,
          city: billAddr.city || '',
          state: billAddr.state || '',
          postal_code: billAddr.postal_code || '',
          phone: billAddr.phone || '',
        }
      }
    }

    const isCancelled = order.status === 'cancelled'

    const pdfBuffer = await generateInvoicePDF(invoiceOrder, invoiceItems, business, buyerAddress, billingAddress, isCancelled)

    const safeFileName = order.invoice_number.replace(/\//g, '-')
    const downloadName = isCancelled ? `${safeFileName}-CANCELLED.pdf` : `${safeFileName}.pdf`

    if (!isCancelled) {
      const fy = getFinancialYear(new Date(order.invoice_date || order.created_at))
      const s3Url = await uploadInvoicePDF(pdfBuffer, order.invoice_number, fy)

      await query(
        'UPDATE invoices SET pdf_url = $1 WHERE order_id = $2',
        [s3Url, orderId]
      )
    }

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${downloadName}"`,
        'Content-Length': String(pdfBuffer.length),
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to generate invoice' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orderId = params.id

    const order = await queryOne('SELECT id, invoice_number, payment_status, status FROM orders WHERE id = $1', [orderId])
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.invoice_number) {
      return NextResponse.json({ message: 'Invoice already exists', invoiceNumber: order.invoice_number })
    }

    if (order.payment_status !== 'paid') {
      return NextResponse.json({ error: 'Invoice can only be generated after payment is completed' }, { status: 400 })
    }

    if (order.status === 'pending' || order.status === 'cancelled') {
      return NextResponse.json({ error: `Invoice cannot be generated for ${order.status} orders` }, { status: 400 })
    }

    const pdfBuffer = await generateOrderInvoice(orderId)

    if (!pdfBuffer) {
      return NextResponse.json({ error: 'Invoice generation failed. Ensure GST is enabled.' }, { status: 400 })
    }

    const updated = await queryOne('SELECT invoice_number FROM orders WHERE id = $1', [orderId])

    return NextResponse.json({ success: true, invoiceNumber: updated?.invoice_number || null })
  } catch {
    return NextResponse.json({ error: 'Failed to generate invoice' }, { status: 500 })
  }
}
