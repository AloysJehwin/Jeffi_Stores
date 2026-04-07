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
    // Authenticate: accept both user and admin tokens
    const userAuth = await authenticateUser(request)
    const adminAuth = await authenticateAdmin(request)

    if (!userAuth && !adminAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const orderId = params.id

    // Fetch order
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

    // If user auth, verify they own this order
    if (userAuth && !adminAuth && order.user_id !== userAuth.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check if invoice exists
    if (!order.invoice_number) {
      return NextResponse.json({ error: 'Invoice not available for this order' }, { status: 404 })
    }

    // Check if PDF is already cached on S3
    const invoiceRecord = await queryOne(
      'SELECT pdf_url FROM invoices WHERE order_id = $1',
      [orderId]
    )

    if (invoiceRecord?.pdf_url) {
      // Redirect to cached S3 URL
      return NextResponse.redirect(invoiceRecord.pdf_url)
    }

    // Generate PDF
    const orderItems = await queryMany(
      'SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at',
      [orderId]
    )

    // Fetch business settings
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

    const pdfBuffer = await generateInvoicePDF(invoiceOrder, invoiceItems, business, buyerAddress)

    // Upload to S3 and cache
    const fy = getFinancialYear(new Date(order.invoice_date || order.created_at))
    const s3Url = await uploadInvoicePDF(pdfBuffer, order.invoice_number, fy)

    // Update invoice record with S3 URL
    await query(
      'UPDATE invoices SET pdf_url = $1 WHERE order_id = $2',
      [s3Url, orderId]
    )

    // Return the PDF
    const safeFileName = order.invoice_number.replace(/\//g, '-')
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeFileName}.pdf"`,
        'Content-Length': String(pdfBuffer.length),
      },
    })
  } catch (error) {
    console.error('Invoice generation error:', error)
    return NextResponse.json({ error: 'Failed to generate invoice' }, { status: 500 })
  }
}

// POST: Admin-triggered invoice generation for orders missing an invoice
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

    const pdfBuffer = await generateOrderInvoice(orderId)

    if (!pdfBuffer) {
      return NextResponse.json({ error: 'Invoice generation failed. Ensure GST is enabled.' }, { status: 400 })
    }

    // Re-fetch to get the invoice number
    const updated = await queryOne('SELECT invoice_number FROM orders WHERE id = $1', [orderId])

    return NextResponse.json({ success: true, invoiceNumber: updated?.invoice_number || null })
  } catch (error) {
    console.error('Invoice generation error:', error)
    return NextResponse.json({ error: 'Failed to generate invoice' }, { status: 500 })
  }
}
