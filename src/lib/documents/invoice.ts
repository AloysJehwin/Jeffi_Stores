import { queryOne, queryMany, withTransaction } from '@/lib/shared/db'
import {
  getFinancialYear,
  generateInvoiceNumber,
  getNextInvoiceSequence,
  isInterState,
  calculateGST,
  round2,
} from '@/lib/catalog/gst'
import {
  generateInvoicePDF,
  InvoiceBusinessSettings,
  InvoiceOrder,
  InvoiceOrderItem,
  InvoiceBuyerAddress,
} from '@/lib/documents/invoice-pdf'
import { uploadInvoicePDF } from '@/lib/shared/s3'
import { getFeatureFlags } from '@/lib/catalog/site-controls'

/**
 * Creates a placeholder invoice row (status='draft', no invoice number) when an
 * online order is placed. The row is finalized (number assigned, PDF generated)
 * only when an admin processes the order via the finalize route.
 */
export async function createDraftInvoice(orderId: string): Promise<void> {
  const existing = await queryOne('SELECT id FROM invoices WHERE order_id = $1', [orderId])
  if (existing) return
  await queryOne(`INSERT INTO invoices (order_id, status) VALUES ($1, 'draft') RETURNING id`, [orderId])
}

/**
 * Assigns the invoice NUMBER to an order (and finalizes its invoices row) WITHOUT
 * generating the PDF and WITHOUT any payment-status check. Used when an order is
 * moved to `processing` so every order — including COD (never `payment_status='paid'`
 * until remittance) — gets an invoice number/document at that point. The PDF is
 * rendered later by `generateOrderInvoice` once the order is paid.
 *
 * Idempotent: no-op if the order already has an invoice_number. When GST is off
 * the invoice is still numbered (a tax-free Bill of Supply) — only the tax lines
 * are omitted at render time.
 * Runs on the caller's transaction client.
 */
export async function assignInvoiceNumber(
  client: { query: (sql: string, params?: any[]) => Promise<any> },
  orderId: string
): Promise<string | null> {
  const ord = await client.query(`SELECT invoice_number, source FROM orders WHERE id = $1 FOR UPDATE`, [orderId])
  const row = ord.rows[0]
  if (!row) return null
  if (row.invoice_number) return row.invoice_number // already numbered — idempotent

  const isOnlineOrder = row.source === 'online' || row.source === 'business'

  const settingsResult = await client.query(`SELECT value FROM site_settings WHERE key = 'invoice_prefix'`)
  const prefix = settingsResult.rows[0]?.value || 'JS'
  const fy = getFinancialYear(new Date())
  const seq = await getNextInvoiceSequence(client, fy)
  const invoiceNumber = generateInvoiceNumber(prefix, fy, seq)
  const invoiceDate = new Date().toISOString()

  await client.query(`UPDATE orders SET invoice_number = $1, invoice_date = $2, updated_at = NOW() WHERE id = $3`, [
    invoiceNumber,
    invoiceDate,
    orderId,
  ])

  if (isOnlineOrder) {
    // Flip the draft row (created at order placement) to finalized.
    const upd = await client.query(
      `UPDATE invoices SET invoice_number = $1, financial_year = $2, sequence_number = $3, status = 'finalized', updated_at = NOW()
       WHERE order_id = $4 AND status = 'draft'`,
      [invoiceNumber, fy, seq, orderId]
    )
    if ((upd.rowCount ?? 0) === 0) {
      await client.query(
        `INSERT INTO invoices (order_id, invoice_number, financial_year, sequence_number, status) VALUES ($1, $2, $3, $4, 'finalized')`,
        [orderId, invoiceNumber, fy, seq]
      )
    }
  } else {
    await client.query(
      `INSERT INTO invoices (order_id, invoice_number, financial_year, sequence_number) VALUES ($1, $2, $3, $4)`,
      [orderId, invoiceNumber, fy, seq]
    )
  }

  return invoiceNumber
}

export async function generateOrderInvoice(orderId: string): Promise<Buffer | null> {
  const gstEnabled = (await getFeatureFlags()).gstEnabled

  const existingInvoice = await queryOne(`SELECT id FROM invoices WHERE order_id = $1 AND status = 'finalized'`, [
    orderId,
  ])
  if (existingInvoice) return null

  const order = await queryOne(
    `
    SELECT o.*, a.full_name, a.address_line1, a.address_line2, a.city, a.state, a.postal_code, a.phone AS address_phone
    FROM orders o
    LEFT JOIN addresses a ON o.shipping_address_id = a.id
    WHERE o.id = $1
  `,
    [orderId]
  )

  if (!order) return null

  if (order.original_order_id) return null

  if (order.payment_status !== 'paid') return null

  if (order.status === 'pending' || order.status === 'cancelled') return null

  const orderItems = await queryMany('SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at', [orderId])

  const invoiceData = await withTransaction(async client => {
    const now = new Date()
    const fy = getFinancialYear(now)
    const settingsResult = await client.query("SELECT value FROM site_settings WHERE key = 'invoice_prefix'")
    const prefix = settingsResult.rows[0]?.value || 'JS'
    const seq = await getNextInvoiceSequence(client, fy)
    const invoiceNumber = generateInvoiceNumber(prefix, fy, seq)
    const invoiceDate = now.toISOString()

    let taxableAmount = parseFloat(order.taxable_amount || '0')
    let cgstAmount = parseFloat(order.cgst_amount || '0')
    let sgstAmount = parseFloat(order.sgst_amount || '0')
    let igstAmount = parseFloat(order.igst_amount || '0')
    let orderIsIgst = order.is_igst || false

    if (gstEnabled && taxableAmount === 0 && parseFloat(order.tax_amount || '0') > 0) {
      const stateCodeResult = await client.query("SELECT value FROM site_settings WHERE key = 'business_state_code'")
      const sellerStateCode = stateCodeResult.rows[0]?.value || process.env.BUSINESS_STATE_CODE || '22'
      const buyerState = order.state || ''
      orderIsIgst = isInterState(buyerState, sellerStateCode)

      let totalTaxable = 0,
        totalCgst = 0,
        totalSgst = 0,
        totalIgst = 0

      for (const item of orderItems || []) {
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

      taxableAmount = round2(totalTaxable)
      cgstAmount = round2(totalCgst)
      sgstAmount = round2(totalSgst)
      igstAmount = round2(totalIgst)
    }

    // Tax-free invoice (GST off): the total IS the taxable value, no tax lines.
    if (!gstEnabled) {
      taxableAmount = round2(parseFloat(order.total_amount || '0'))
      cgstAmount = 0
      sgstAmount = 0
      igstAmount = 0
      orderIsIgst = false
    }

    await client.query(
      `UPDATE orders SET invoice_number = $1, invoice_date = $2,
       taxable_amount = $3, cgst_amount = $4, sgst_amount = $5, igst_amount = $6, is_igst = $7
       WHERE id = $8`,
      [invoiceNumber, invoiceDate, taxableAmount, cgstAmount, sgstAmount, igstAmount, orderIsIgst, orderId]
    )

    await client.query(
      `INSERT INTO invoices (order_id, invoice_number, financial_year, sequence_number, status)
       VALUES ($1, $2, $3, $4, 'finalized')
       ON CONFLICT (order_id) DO UPDATE
         SET invoice_number = EXCLUDED.invoice_number,
             financial_year = EXCLUDED.financial_year,
             sequence_number = EXCLUDED.sequence_number,
             status = 'finalized',
             updated_at = NOW()`,
      [orderId, invoiceNumber, fy, seq]
    )

    return {
      invoiceNumber,
      invoiceDate,
      taxableAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      isIgst: orderIsIgst,
    }
  })

  const settingsRows = await queryMany(
    "SELECT key, value FROM site_settings WHERE key LIKE 'business_%' OR key LIKE 'bank_%'",
    []
  )
  const settings: Record<string, string> = {}
  for (const row of settingsRows || []) {
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

  const updatedItems = await queryMany('SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at', [orderId])

  const paymentRecord = await queryOne(
    `SELECT transaction_id FROM payments WHERE order_id = $1 AND payment_gateway = 'razorpay' AND status = 'completed' LIMIT 1`,
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
    discount_amount: parseFloat(order.discount_amount || '0'),
    business_discount_amount: parseFloat(order.business_discount_amount || '0'),
    shipping_amount: parseFloat(order.shipping_amount || '0'),
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
    irn: order.irn || null,
    irn_ack_no: order.irn_ack_no || null,
    irn_ack_dt: order.irn_ack_dt || null,
    signed_qr_code: order.signed_qr || null,
    payment_link_url: order.payment_link_url || null,
    eway_bill_no: order.eway_bill_no || null,
    payment_transaction_id: paymentRecord?.transaction_id || null,
    estimated_delivery_date: order.estimated_delivery_date || null,
  }

  const invoiceItems: InvoiceOrderItem[] = (updatedItems || []).map((item: any) => ({
    product_name: item.product_name,
    hsn_code: item.hsn_code || null,
    gst_rate: parseFloat(item.gst_rate || '0'),
    quantity: item.quantity,
    unit_price: parseFloat(item.unit_price),
    total_price: parseFloat(item.total_price),
    discount_amount: parseFloat(item.discount_amount || '0'),
    mrp: item.mrp != null ? parseFloat(item.mrp) : null,
    sold_unit_factor: item.sold_unit_factor != null ? parseFloat(item.sold_unit_factor) : null,
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

  // Tax-free (Bill of Supply) is a property of the ORDER, not the current global
  // flag: an order placed while GST was off carries zero tax and must always
  // render tax-free, even if GST is later re-enabled.
  const invoiceIsTaxFree =
    invoiceData.cgstAmount === 0 &&
    invoiceData.sgstAmount === 0 &&
    invoiceData.igstAmount === 0 &&
    parseFloat(order.tax_amount || '0') === 0

  const pdfBuffer = await generateInvoicePDF(
    invoiceOrder,
    invoiceItems,
    business,
    buyerAddress,
    billingAddress,
    false,
    undefined,
    invoiceIsTaxFree
  )

  const fy = getFinancialYear(new Date(invoiceData.invoiceDate))
  const s3Url = await uploadInvoicePDF(pdfBuffer, invoiceData.invoiceNumber, fy)

  await queryOne('UPDATE invoices SET pdf_url = $1 WHERE order_id = $2 RETURNING id', [s3Url, orderId])

  return pdfBuffer
}
