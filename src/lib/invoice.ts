import { queryOne, queryMany, withTransaction } from '@/lib/db'
import { getFinancialYear, generateInvoiceNumber, getNextInvoiceSequence, isInterState, calculateGST } from '@/lib/gst'
import { generateInvoicePDF, InvoiceBusinessSettings, InvoiceOrder, InvoiceOrderItem, InvoiceBuyerAddress } from '@/lib/invoice-pdf'
import { uploadInvoicePDF } from '@/lib/s3'

const isGSTEnabled = process.env.ENABLE_GST === 'true'

export async function generateOrderInvoice(orderId: string): Promise<Buffer | null> {
  if (!isGSTEnabled) return null

  const existingInvoice = await queryOne(
    'SELECT id FROM invoices WHERE order_id = $1',
    [orderId]
  )
  if (existingInvoice) return null

  const order = await queryOne(`
    SELECT o.*, a.full_name, a.address_line1, a.address_line2, a.city, a.state, a.postal_code, a.phone AS address_phone
    FROM orders o
    LEFT JOIN addresses a ON o.shipping_address_id = a.id
    WHERE o.id = $1
  `, [orderId])

  if (!order) return null

  if (order.original_order_id) return null

  if (order.payment_status !== 'paid') return null

  if (order.status === 'pending' || order.status === 'cancelled') return null

  const orderItems = await queryMany(
    'SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at',
    [orderId]
  )

  const invoiceData = await withTransaction(async (client) => {
    const now = new Date()
    const fy = getFinancialYear(now)
    const settingsResult = await client.query(
      "SELECT value FROM site_settings WHERE key = 'invoice_prefix'"
    )
    const prefix = settingsResult.rows[0]?.value || 'JS'
    const seq = await getNextInvoiceSequence(client, fy)
    const invoiceNumber = generateInvoiceNumber(prefix, fy, seq)
    const invoiceDate = now.toISOString()

    let taxableAmount = parseFloat(order.taxable_amount || '0')
    let cgstAmount = parseFloat(order.cgst_amount || '0')
    let sgstAmount = parseFloat(order.sgst_amount || '0')
    let igstAmount = parseFloat(order.igst_amount || '0')
    let orderIsIgst = order.is_igst || false

    if (taxableAmount === 0 && parseFloat(order.tax_amount || '0') > 0) {
      const sellerStateCode = process.env.BUSINESS_STATE_CODE || '22'
      const buyerState = order.state || ''
      orderIsIgst = isInterState(buyerState, sellerStateCode)

      let totalTaxable = 0, totalCgst = 0, totalSgst = 0, totalIgst = 0

      for (const item of (orderItems || [])) {
        const gstRate = parseFloat(item.gst_rate || item.gst_percentage || '18')
        const itemTotal = parseFloat(item.total_price)
        const gst = calculateGST(itemTotal, gstRate, orderIsIgst)

        totalTaxable += gst.taxableAmount
        totalCgst += gst.cgst
        totalSgst += gst.sgst
        totalIgst += gst.igst

        await client.query(
          `UPDATE order_items SET hsn_code = COALESCE(hsn_code, $1), gst_rate = COALESCE(gst_rate, $2),
           taxable_amount = $3, cgst_amount = $4, sgst_amount = $5, igst_amount = $6
           WHERE id = $7`,
          [item.hsn_code || null, gstRate, gst.taxableAmount, gst.cgst, gst.sgst, gst.igst, item.id]
        )
      }

      taxableAmount = Math.round(totalTaxable * 100) / 100
      cgstAmount = Math.round(totalCgst * 100) / 100
      sgstAmount = Math.round(totalSgst * 100) / 100
      igstAmount = Math.round(totalIgst * 100) / 100
    }

    await client.query(
      `UPDATE orders SET invoice_number = $1, invoice_date = $2,
       taxable_amount = $3, cgst_amount = $4, sgst_amount = $5, igst_amount = $6, is_igst = $7
       WHERE id = $8`,
      [invoiceNumber, invoiceDate, taxableAmount, cgstAmount, sgstAmount, igstAmount, orderIsIgst, orderId]
    )

    await client.query(
      'INSERT INTO invoices (order_id, invoice_number, financial_year, sequence_number) VALUES ($1, $2, $3, $4)',
      [orderId, invoiceNumber, fy, seq]
    )

    return {
      invoiceNumber, invoiceDate, taxableAmount, cgstAmount, sgstAmount, igstAmount, isIgst: orderIsIgst
    }
  })

  const settingsRows = await queryMany(
    "SELECT key, value FROM site_settings WHERE key LIKE 'business_%' OR key LIKE 'bank_%'",
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

  const updatedItems = await queryMany(
    'SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at',
    [orderId]
  )

  const invoiceOrder: InvoiceOrder = {
    order_number: order.order_number,
    invoice_number: invoiceData.invoiceNumber,
    invoice_date: invoiceData.invoiceDate,
    customer_name: order.customer_name,
    subtotal: parseFloat(order.subtotal),
    tax_amount: parseFloat(order.tax_amount),
    total_amount: parseFloat(order.total_amount),
    taxable_amount: invoiceData.taxableAmount,
    cgst_amount: invoiceData.cgstAmount,
    sgst_amount: invoiceData.sgstAmount,
    igst_amount: invoiceData.igstAmount,
    is_igst: invoiceData.isIgst,
    buyer_gstin: order.buyer_gstin || null,
    order_date: order.created_at,
    payment_mode: order.payment_status === 'paid' ? 'Online Payment' : '',
    tracking_number: order.tracking_number || '',
    shipped_at: order.shipped_at || '',
    shipping_method: order.shipping_method || '',
    destination: [order.city, order.state].filter(Boolean).join(', '),
  }

  const invoiceItems: InvoiceOrderItem[] = (updatedItems || []).map((item: any) => ({
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

  const pdfBuffer = await generateInvoicePDF(invoiceOrder, invoiceItems, business, buyerAddress, billingAddress)

  const fy = getFinancialYear(new Date(invoiceData.invoiceDate))
  const s3Url = await uploadInvoicePDF(pdfBuffer, invoiceData.invoiceNumber, fy)

  await queryOne(
    'UPDATE invoices SET pdf_url = $1 WHERE order_id = $2 RETURNING id',
    [s3Url, orderId]
  )

  return pdfBuffer
}
