/** QR-first admin sales: the Razorpay QR comes first, the document only once the payment is confirmed. */
export const QR_INTENT_KINDS = ['invoice', 'quotation_convert', 'invoice_draft_finalise', 'cash_sale'] as const
export type QrIntentKind = (typeof QR_INTENT_KINDS)[number]

export const QR_INTENT_STATUSES = ['pending', 'paid', 'finalised', 'expired', 'cancelled', 'failed'] as const
export type QrIntentStatus = (typeof QR_INTENT_STATUSES)[number]

/** The scope of the create call each kind stands in for. */
export const QR_INTENT_SCOPE: Record<QrIntentKind, string> = {
  invoice: 'invoices:write',
  quotation_convert: 'quotations:write',
  invoice_draft_finalise: 'invoices:write',
  cash_sale: 'invoices:write',
}

export const isQrIntentKind = (v: unknown): v is QrIntentKind => typeof v === 'string' && (QR_INTENT_KINDS as readonly string[]).includes(v)

export const QR_INTENT_TTL_MS = 15 * 60 * 1000

export const QR_FIRST_MESSAGE =
  'UPI QR payments start from the payment QR (POST /api/admin/payments/qr-intents): the document is created once Razorpay confirms the payment'

export interface QrIntentActor {
  adminId: string
  role?: string
  scopes?: string[]
}

export interface QrIntentRow {
  id: string
  kind: QrIntentKind
  payload: Record<string, any>
  amount_paise: string | number
  razorpay_qr_id: string | null
  qr_image_url: string | null
  status: QrIntentStatus
  razorpay_payment_id: string | null
  payment: any
  result_ref: string | null
  error: string | null
  actor: QrIntentActor | Record<string, never>
  created_by: string | null
  expires_at: string | Date
  paid_at: string | Date | null
  finalised_at: string | Date | null
  checked_at: string | Date | null
  created_at: string | Date
}

/** What a finalised document is, for the settlement and the poll. */
export interface QrIntentResult {
  id: string
  /** order_number or sale_number: the Route transfer's order reference. */
  ref: string
  totalInr: number
}

export class QrIntentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly extra: Record<string, unknown> = {}
  ) {
    super(message)
    this.name = 'QrIntentError'
  }
}
