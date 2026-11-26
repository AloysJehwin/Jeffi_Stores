import 'server-only'
import { queryOne } from '@/lib/shared/db'
import { docServiceFetch } from '@/lib/documents/proxy'
import { InsufficientStockError } from '@/lib/orders/inventory-deduct'
import { assignmentsOf, createOfflineInvoice, createOrderSchema, OfflineInvoiceError, type QrPaymentRecord } from '@/lib/orders/offline-invoice'
import { parseBody } from '@/lib/shared/validate'
import { QrIntentError, type QrIntentActor, type QrIntentKind, type QrIntentResult, type QrIntentRow } from './types'

/**
 * Each kind runs the real create call twice: a dry run when the QR is made (every check, nothing kept) and the
 * real one once the payment is confirmed, with the payment recorded in the same transaction. `existing` finds the
 * document a payment already made, so a retried finalise never makes a second one.
 */
interface KindImpl {
  validate(payload: Record<string, any>, actor: QrIntentActor): Promise<{ amountPaise: number; payload: Record<string, any>; label: string }>
  finalise(row: QrIntentRow, qr: QrPaymentRecord): Promise<QrIntentResult>
  existing(paymentId: string): Promise<QrIntentResult | null>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const toPaise = (inr: unknown) => Math.round(Number(inr) * 100)
const shortStock = (items: unknown) =>
  new QrIntentError(`Not enough stock: ${(Array.isArray(items) ? items : []).join('; ')}`, 409, { insufficientItems: Array.isArray(items) ? items : [] })

const orderPaidBy = async (paymentId: string): Promise<QrIntentResult | null> => {
  const r = await queryOne<{ id: string; ref: string; total_amount: string }>(
    `SELECT o.id, o.order_number AS ref, o.total_amount FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.transaction_id = $1 LIMIT 1`,
    [paymentId]
  )
  return r ? { id: r.id, ref: r.ref, totalInr: Number(r.total_amount) } : null
}

async function parseInvoice(payload: Record<string, any>) {
  const parsed = parseBody(createOrderSchema, { ...payload, paymentMode: 'upi_qr' }, 'POST /api/admin/payments/qr-intents (invoice)')
  if (!parsed.ok) {
    const body = await parsed.response.json().catch(() => ({}))
    throw new QrIntentError(body.error || 'Validation failed', 400, body.fields ? { fields: body.fields } : {})
  }
  return parsed.data
}

/** The offline invoice's own errors, as its route answers them. */
function invoiceError(e: unknown): never {
  if (e instanceof OfflineInvoiceError) throw new QrIntentError(e.message, e.status)
  if (e instanceof InsufficientStockError) throw new QrIntentError(e.message, 409)
  throw e
}

const invoice: KindImpl = {
  async validate(payload, actor) {
    const data = await parseInvoice(payload)
    const r = await createOfflineInvoice(data, assignmentsOf(payload), { actor, dryRun: true }).catch(invoiceError)
    if (r.saveAsDraft) throw shortStock(r.insufficientItems)
    return { amountPaise: toPaise(r.totalAmount), payload: { ...payload, paymentMode: 'upi_qr' }, label: `Invoice for ${data.customerName}` }
  },
  async finalise(row, qr) {
    const data = await parseInvoice(row.payload)
    const r = await createOfflineInvoice(data, assignmentsOf(row.payload), { actor: row.actor as QrIntentActor, qrPayment: qr }).catch(invoiceError)
    return { id: r.orderId, ref: r.orderNumber, totalInr: r.totalAmount }
  },
  existing: orderPaidBy,
}

/** A document-service create call as the admin who made the intent. */
async function docCall(path: string, actor: QrIntentActor, body: Record<string, unknown>, qrIntent: string): Promise<any> {
  const res = await docServiceFetch(path, { adminId: actor.adminId, role: actor.role, scopes: actor.scopes, qrIntent }, { method: 'POST', body })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) {
    const extra = Array.isArray(data?.insufficientItems) ? { insufficientItems: data.insufficientItems } : {}
    throw new QrIntentError(data?.error || data?.message || `Request failed (${res.status})`, res.status, extra)
  }
  return data
}

function docKind(spec: {
  path: (payload: Record<string, any>) => string
  body: (payload: Record<string, any>) => Record<string, unknown>
  label: string
  result: (data: any) => QrIntentResult
  existing: (paymentId: string) => Promise<QrIntentResult | null>
}): KindImpl {
  return {
    async validate(payload, actor) {
      const path = spec.path(payload)
      const data = await docCall(path, actor, { ...spec.body(payload), dryRun: true }, 'validate')
      if (data.savedAsDraft) throw shortStock(data.insufficientItems)
      return { amountPaise: toPaise(data.totalAmount), payload: { ...payload, ...spec.body(payload) }, label: spec.label }
    },
    async finalise(row, qr) {
      const data = await docCall(spec.path(row.payload), row.actor as QrIntentActor, { ...spec.body(row.payload), qrPayment: qr }, row.id)
      return spec.result(data)
    },
    existing: spec.existing,
  }
}

const idOf = (v: unknown, what: string) => {
  if (typeof v !== 'string' || !UUID.test(v)) throw new QrIntentError(`${what} is required`)
  return v
}
const arr = (v: unknown) => (Array.isArray(v) ? v : [])

const quotationConvert = docKind({
  path: p => `/admin/quotations/${idOf(p.quotationId, 'quotationId')}/convert-to-invoice`,
  body: p => ({ paymentMode: 'upi_qr', enableDelivery: !!p.enableDelivery, batch_assignments: arr(p.batch_assignments), serial_assignments: arr(p.serial_assignments) }),
  label: 'Invoice for quotation',
  result: d => ({ id: d.orderId, ref: d.orderNumber, totalInr: Number(d.totalAmount) }),
  existing: orderPaidBy,
})

const invoiceDraftFinalise = docKind({
  path: p => `/admin/invoices/drafts/${idOf(p.draftId, 'draftId')}/finalize`,
  body: p => ({ batch_assignments: arr(p.batch_assignments), serial_assignments: arr(p.serial_assignments) }),
  label: 'Invoice payment',
  result: d => ({ id: d.orderId, ref: d.orderNumber, totalInr: Number(d.totalAmount) }),
  existing: orderPaidBy,
})

const cashSale = docKind({
  path: () => '/admin/invoices/cash-sale',
  body: p => ({ ...p, paymentMode: 'upi_qr' }),
  label: 'Counter sale',
  result: d => ({ id: d.saleId, ref: d.saleNumber, totalInr: Number(d.totalAmount) }),
  existing: async paymentId => {
    const r = await queryOne<{ id: string; ref: string; total_amount: string }>(
      `SELECT id, sale_number AS ref, total_amount FROM cash_sales WHERE razorpay_payment_id = $1 LIMIT 1`,
      [paymentId]
    )
    return r ? { id: r.id, ref: r.ref, totalInr: Number(r.total_amount) } : null
  },
})

export const KINDS: Record<QrIntentKind, KindImpl> = {
  invoice,
  quotation_convert: quotationConvert,
  invoice_draft_finalise: invoiceDraftFinalise,
  cash_sale: cashSale,
}

/** Where the admin lands once the document exists, and its PDF. */
export function resultLinks(kind: QrIntentKind, id: string): { resultUrl: string; invoiceUrl: string } {
  return kind === 'cash_sale'
    ? { resultUrl: `/admin/cash-sale/${id}/view`, invoiceUrl: `/api/admin/cash-sale/${id}/receipt` }
    : { resultUrl: `/admin/invoices/${id}/view`, invoiceUrl: `/api/orders/${id}/invoice` }
}
