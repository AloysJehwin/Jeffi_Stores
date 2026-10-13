import { queryMany, queryOne } from '@jeffi/tenancy'
import { generateInvoicePDF, type InvoiceBusinessSettings, type InvoiceOrder, type InvoiceOrderItem, type InvoiceBuyerAddress } from '../lib/invoice-pdf'
import { generateReceiptPDF, type ReceiptBusinessSettings, type ReceiptOrder, type ReceiptItem } from '../lib/receipt-pdf'
import { generateQuotationPDF, type QuotationBusiness } from '../lib/quotation-pdf'
import { generatePurchaseOrderPDF, type POItem, type POBusinessSettings } from '../lib/po-pdf'

export async function businessSettings(): Promise<Record<string, string>> {
  const rows = await queryMany<{ key: string; value: string }>(`SELECT key, value FROM site_settings WHERE key LIKE 'business_%' OR key LIKE 'bank_%'`)
  const s: Record<string, string> = {}
  for (const r of rows) s[r.key] = r.value || ''
  return s
}

export const invoiceBusiness = (s: Record<string, string>): InvoiceBusinessSettings => ({
  gstin: s.business_gstin || '', legalName: s.business_legal_name || '', tradeName: s.business_trade_name || '',
  address: s.business_address || '', state: s.business_state || '', stateCode: s.business_state_code || '',
  phone: s.business_phone || '', email: s.business_email || '',
  bankName: s.bank_name || '', bankAccount: s.bank_account || '', bankIfsc: s.bank_ifsc || '', bankBranch: s.bank_branch || '',
})

const num = (v: any) => parseFloat(v || '0')

// ── invoice (orders.view_token) ──
export async function loadInvoice(token: string) {
  const order = await queryOne<any>(
    `SELECT o.*, a.full_name, a.address_line1, a.address_line2, a.city, a.state, a.postal_code, a.phone AS address_phone
     FROM orders o LEFT JOIN addresses a ON o.shipping_address_id = a.id
     WHERE o.view_token = $1 AND o.invoice_number IS NOT NULL`,
    [token]
  )
  if (!order) return null
  const items = await queryMany<any>(`SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at`, [order.id])
  return { order, items, settings: await businessSettings() }
}

export async function invoicePdf({ order, items, settings: s }: NonNullable<Awaited<ReturnType<typeof loadInvoice>>>): Promise<{ buffer: Buffer; filename: string }> {
  const filename = `${order.invoice_number.replace(/\//g, '-')}.pdf`
  if (order.source === 'cash_sale') {
    const business: ReceiptBusinessSettings = { legalName: s.business_legal_name || '', tradeName: s.business_trade_name || '', address: s.business_address || '', phone: s.business_phone || '', gstin: s.business_gstin || '' }
    const ro: ReceiptOrder = {
      invoice_number: order.invoice_number, invoice_date: order.invoice_date || order.created_at, payment_mode: order.payment_mode || 'Cash',
      customer_name: order.customer_name, notes: order.notes || '', taxable_amount: num(order.taxable_amount), cgst_amount: num(order.cgst_amount),
      sgst_amount: num(order.sgst_amount), igst_amount: num(order.igst_amount), is_igst: order.is_igst || false, total_amount: num(order.total_amount),
    }
    const ri: ReceiptItem[] = items.map((i: any) => ({
      product_name: i.product_name, quantity: i.quantity, unit_price: num(i.unit_price), total_price: num(i.total_price), taxable_amount: num(i.taxable_amount),
      cgst_amount: num(i.cgst_amount), sgst_amount: num(i.sgst_amount), igst_amount: num(i.igst_amount), gst_rate: num(i.gst_rate),
    }))
    return { buffer: await generateReceiptPDF(ro, ri, business), filename }
  }
  const io: InvoiceOrder = {
    order_number: order.order_number, invoice_number: order.invoice_number, invoice_date: order.invoice_date || order.created_at, customer_name: order.customer_name,
    subtotal: num(order.subtotal), tax_amount: num(order.tax_amount), total_amount: num(order.total_amount), discount_amount: num(order.discount_amount),
    business_discount_amount: num(order.business_discount_amount), shipping_amount: num(order.shipping_amount), taxable_amount: num(order.taxable_amount),
    cgst_amount: num(order.cgst_amount), sgst_amount: num(order.sgst_amount), igst_amount: num(order.igst_amount), is_igst: order.is_igst || false,
    buyer_gstin: order.buyer_gstin || null, order_date: order.created_at, payment_mode: order.payment_status === 'paid' ? 'Online Payment' : '',
    tracking_number: order.tracking_number || '', shipped_at: order.shipped_at || '', shipping_method: order.shipping_method || '',
    destination: [order.city, order.state].filter(Boolean).join(', '), irn: order.irn || null, irn_ack_no: order.irn_ack_no || null, irn_ack_dt: order.irn_ack_dt || null,
    signed_qr_code: order.signed_qr || null, payment_link_url: order.payment_link_url || null, eway_bill_no: order.eway_bill_no || null,
  }
  const ii: InvoiceOrderItem[] = items.map((i: any) => ({
    product_name: i.product_name, hsn_code: i.hsn_code || null, gst_rate: num(i.gst_rate), quantity: i.quantity, unit_price: num(i.unit_price), total_price: num(i.total_price),
    discount_amount: num(i.discount_amount), mrp: i.mrp != null ? parseFloat(i.mrp) : null, sold_unit_factor: i.sold_unit_factor != null ? parseFloat(i.sold_unit_factor) : null,
    taxable_amount: num(i.taxable_amount), cgst_amount: num(i.cgst_amount), sgst_amount: num(i.sgst_amount), igst_amount: num(i.igst_amount),
    buy_mode: i.buy_mode || 'unit', buy_unit: i.buy_unit || null, is_digital: !!i.is_digital,
  }))
  const addr = (a: any): InvoiceBuyerAddress => ({
    full_name: a.full_name || '', address_line1: a.address_line1 || '', address_line2: a.address_line2 || null, city: a.city || '', state: a.state || '', postal_code: a.postal_code || '', phone: a.phone || '',
  })
  const buyer = addr({ ...order, full_name: order.full_name || order.customer_name, phone: order.address_phone || order.customer_phone })
  let billing: InvoiceBuyerAddress | undefined
  if (order.billing_address_id && order.billing_address_id !== order.shipping_address_id) {
    const b = await queryOne<any>(`SELECT full_name, address_line1, address_line2, city, state, postal_code, phone FROM addresses WHERE id = $1`, [order.billing_address_id])
    if (b) billing = addr(b)
  }
  const cancelled = order.status === 'cancelled' || order.status === 'returned'
  const taxFree = num(order.tax_amount) === 0 && num(order.cgst_amount) + num(order.sgst_amount) + num(order.igst_amount) === 0
  return { buffer: await generateInvoicePDF(io, ii, invoiceBusiness(s), buyer, billing, cancelled, order.status === 'returned' ? 'RETURNED' : 'CANCELLED', taxFree), filename }
}

// ── quotation ──
export async function loadQuotation(token: string) {
  const qt = await queryOne<any>(`SELECT * FROM quotations WHERE view_token = $1`, [token])
  if (!qt) return null
  const items = await queryMany<any>(`SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY position`, [qt.id])
  return { qt, items, settings: await businessSettings() }
}

export async function quotationPdf({ qt, items, settings }: NonNullable<Awaited<ReturnType<typeof loadQuotation>>>) {
  const business: QuotationBusiness = invoiceBusiness(settings)
  const pdfItems = items.map((i: any) => ({
    description: i.description, hsn_code: i.hsn_code, gst_rate: Number(i.gst_rate), quantity: Number(i.quantity), unit: i.unit, rate: Number(i.rate), discount_pct: Number(i.discount_pct), amount: Number(i.amount),
  }))
  return { buffer: await generateQuotationPDF(qt, pdfItems, business), filename: `quotation-${qt.quote_number.replace(/\//g, '-')}.pdf` }
}

// ── purchase order ──
export async function loadPurchaseOrder(token: string) {
  const po = await queryOne<any>(
    `SELECT po.*, s.name AS supplier_name, s.contact_name, s.email AS supplier_email, s.address AS supplier_address, s.gstin AS supplier_gstin
     FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.view_token = $1`,
    [token]
  )
  if (!po) return null
  const items = await queryMany<any>(
    `SELECT poi.id, poi.quantity, poi.unit_cost, poi.total_cost, poi.tax_rate, poi.gst_inclusive, poi.line_total_incl_gst, poi.purchase_unit,
            poi.purchase_unit_factor, poi.sku, poi.quantity_received, COALESCE(poi.product_name, p.name) AS product_name, pv.variant_name,
            pu_base.unit AS base_unit, pu_sell.unit AS sell_unit, pu_sell.factor AS sell_unit_factor, pu_sell.display_label AS sell_unit_label
     FROM purchase_order_items poi
     LEFT JOIN products p ON p.id = poi.product_id
     LEFT JOIN product_variants pv ON pv.id = poi.variant_id
     LEFT JOIN product_units pu_base ON pu_base.is_base = true
       AND (poi.variant_id IS NOT NULL AND pu_base.variant_id = poi.variant_id OR poi.variant_id IS NULL AND pu_base.product_id = poi.product_id AND pu_base.variant_id IS NULL)
     LEFT JOIN product_units pu_sell ON (poi.variant_id IS NOT NULL AND pu_sell.variant_id = poi.variant_id OR poi.variant_id IS NULL AND pu_sell.product_id = poi.product_id AND pu_sell.variant_id IS NULL)
       AND pu_sell.is_purchase_default = true
     WHERE poi.po_id = $1`,
    [po.id]
  )
  const grns = await queryMany<any>(
    `SELECT g.id, g.grn_number, g.received_date, g.notes,
            json_agg(json_build_object('po_item_id', gi.po_item_id, 'quantity_received', gi.quantity_received, 'unit_cost', gi.unit_cost,
              'purchase_unit_factor', gi.purchase_unit_factor, 'tax_rate', poi.tax_rate, 'gst_inclusive', poi.gst_inclusive) ORDER BY gi.id) AS grn_items
     FROM grns g JOIN grn_items gi ON gi.grn_id = g.id JOIN purchase_order_items poi ON poi.id = gi.po_item_id
     WHERE g.po_id = $1 GROUP BY g.id ORDER BY g.received_date DESC, g.created_at DESC`,
    [po.id]
  )
  return { po, items, grns, settings: await businessSettings() }
}

export async function purchaseOrderPdf({ po, items, settings: s }: NonNullable<Awaited<ReturnType<typeof loadPurchaseOrder>>>) {
  const business: POBusinessSettings = { legalName: s.business_legal_name || '', tradeName: s.business_trade_name || '', address: s.business_address || '', phone: s.business_phone || '', email: s.business_email || '', gstin: s.business_gstin || '' }
  const poItems: POItem[] = items.map((i: any) => ({ product_name: i.product_name, variant_name: i.variant_name || null, quantity: Number(i.quantity), unit_cost: Number(i.unit_cost) }))
  return { buffer: await generatePurchaseOrderPDF(po, poItems, business), filename: `po-${po.po_number.replace(/\//g, '-')}.pdf` }
}
