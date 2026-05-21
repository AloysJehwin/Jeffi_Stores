import { NextRequest, NextResponse } from 'next/server'
import { queryMany, queryOne } from '@/lib/db'
import { generateInvoicePDF, InvoiceBusinessSettings, InvoiceOrder, InvoiceOrderItem, InvoiceBuyerAddress } from '@/lib/invoice-pdf'
import { generateReceiptPDF, ReceiptBusinessSettings, ReceiptOrder, ReceiptItem } from '@/lib/receipt-pdf'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const order = await queryOne<any>(
      `SELECT o.*, a.full_name, a.address_line1, a.address_line2, a.city, a.state, a.postal_code, a.phone AS address_phone
       FROM orders o
       LEFT JOIN addresses a ON o.shipping_address_id = a.id
       WHERE o.view_token = $1 AND o.invoice_number IS NOT NULL`,
      [params.token]
    )
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const orderItems = await queryMany(
      `SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at`,
      [order.id]
    )
    const settingsRows = await queryMany<{ key: string; value: string }>(
      `SELECT key, value FROM site_settings WHERE key LIKE 'business_%' OR key LIKE 'bank_%'`,
      []
    )
    const s: Record<string, string> = {}
    for (const row of settingsRows) s[row.key] = row.value || ''

    const business: InvoiceBusinessSettings = {
      gstin: s.business_gstin || '',
      legalName: s.business_legal_name || '',
      tradeName: s.business_trade_name || '',
      address: s.business_address || '',
      state: s.business_state || '',
      stateCode: s.business_state_code || '',
      phone: s.business_phone || '',
      email: s.business_email || '',
      bankName: s.bank_name || '',
      bankAccount: s.bank_account || '',
      bankIfsc: s.bank_ifsc || '',
      bankBranch: s.bank_branch || '',
    }

    const safeFileName = order.invoice_number.replace(/\//g, '-')
    let pdfBuffer: Buffer

    if (order.source === 'cash_sale') {
      const receiptBusiness: ReceiptBusinessSettings = {
        legalName: s.business_legal_name || '',
        tradeName: s.business_trade_name || '',
        address: s.business_address || '',
        phone: s.business_phone || '',
        gstin: s.business_gstin || '',
      }
      const receiptOrder: ReceiptOrder = {
        invoice_number: order.invoice_number,
        invoice_date: order.invoice_date || order.created_at,
        payment_mode: order.payment_mode || 'Cash',
        customer_name: order.customer_name,
        notes: order.notes || '',
        taxable_amount: parseFloat(order.taxable_amount || '0'),
        cgst_amount: parseFloat(order.cgst_amount || '0'),
        sgst_amount: parseFloat(order.sgst_amount || '0'),
        igst_amount: parseFloat(order.igst_amount || '0'),
        is_igst: order.is_igst || false,
        total_amount: parseFloat(order.total_amount),
      }
      const receiptItems: ReceiptItem[] = (orderItems || []).map((item: any) => ({
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: parseFloat(item.unit_price),
        total_price: parseFloat(item.total_price),
        taxable_amount: parseFloat(item.taxable_amount || '0'),
        cgst_amount: parseFloat(item.cgst_amount || '0'),
        sgst_amount: parseFloat(item.sgst_amount || '0'),
        igst_amount: parseFloat(item.igst_amount || '0'),
        gst_rate: parseFloat(item.gst_rate || '0'),
      }))
      pdfBuffer = await generateReceiptPDF(receiptOrder, receiptItems, receiptBusiness)
    } else {
      const invoiceOrder: InvoiceOrder = {
        order_number: order.order_number,
        invoice_number: order.invoice_number,
        invoice_date: order.invoice_date || order.created_at,
        customer_name: order.customer_name,
        subtotal: parseFloat(order.subtotal),
        tax_amount: parseFloat(order.tax_amount),
        total_amount: parseFloat(order.total_amount),
        discount_amount: parseFloat(order.discount_amount || '0'),
        shipping_amount: parseFloat(order.shipping_amount || '0'),
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
        irn: order.irn || null,
        irn_ack_no: order.irn_ack_no || null,
        irn_ack_dt: order.irn_ack_dt || null,
        signed_qr_code: order.signed_qr || null,
        payment_link_url: order.payment_link_url || null,
        eway_bill_no: order.eway_bill_no || null,
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
        buy_mode: item.buy_mode || 'unit',
        buy_unit: item.buy_unit || null,
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
        const billAddr = await queryOne<any>(
          `SELECT full_name, address_line1, address_line2, city, state, postal_code, phone FROM addresses WHERE id = $1`,
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
      const isCancelled = order.status === 'cancelled' || order.status === 'returned'
      const voidLabel = order.status === 'returned' ? 'RETURNED' : 'CANCELLED'
      pdfBuffer = await generateInvoicePDF(invoiceOrder, invoiceItems, business, buyerAddress, billingAddress, isCancelled, voidLabel)
    }

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeFileName}.pdf"`,
        'Content-Length': String(pdfBuffer.length),
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to generate PDF' }, { status: 500 })
  }
}
