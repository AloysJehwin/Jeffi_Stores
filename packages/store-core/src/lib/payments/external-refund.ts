// Refunds that reached the customer without the in-app Razorpay refund call. Client-safe (no DB).

export const EXTERNAL_REFUND_METHODS = {
  razorpay_dispute: 'Razorpay dispute / chargeback',
  razorpay_dashboard: 'Razorpay dashboard',
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  cash: 'Cash',
  cheque: 'Cheque',
  other: 'Other',
} as const

export type ExternalRefundMethod = keyof typeof EXTERNAL_REFUND_METHODS

/** Methods that only make sense when the money was collected through Razorpay. */
export const RAZORPAY_ONLY_METHODS: ExternalRefundMethod[] = ['razorpay_dispute', 'razorpay_dashboard']

export interface ExternalRefund {
  method: ExternalRefundMethod
  reference: string | null
  note: string | null
}

/** One recorded external refund, stored on the payment row it covers. */
export interface ExternalRefundEntry extends ExternalRefund {
  amount: number
  purpose: string
  at: string
  by: string | null
}

export const externalRefundLabel = (method: unknown) =>
  EXTERNAL_REFUND_METHODS[method as ExternalRefundMethod] ?? (typeof method === 'string' && method ? method : 'Other')

/** The admin's "refunded another way" payload, or an error message. */
export function parseExternalRefund(raw: unknown): ExternalRefund | string {
  const r = (raw ?? {}) as Record<string, unknown>
  const method = String(r.method ?? '')
  if (!(method in EXTERNAL_REFUND_METHODS)) return 'Choose how the refund was made.'
  const clean = (v: unknown, max: number) => {
    const s = typeof v === 'string' ? v.trim() : ''
    return s ? s.slice(0, max) : null
  }
  const refund = { method: method as ExternalRefundMethod, reference: clean(r.reference, 120), note: clean(r.note, 500) }
  if (method === 'other' && !refund.note) return 'Add a note saying how the refund was made.'
  return refund
}
