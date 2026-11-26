// QR-first sales (store-core lib/payments/qr-intents): the create routes run as a dry run when the QR is made,
// and again with the confirmed Razorpay payment, which they record in their own transaction.
import { z } from 'zod'
import type { ServiceClaims } from '@jeffi/service-auth'
import { NextResponse, type NextRequest } from '../next'

const intentOf = (req: NextRequest) => (req.claims as (ServiceClaims & { qrIntent?: string }) | undefined)?.qrIntent

export const QR_FIRST_MESSAGE =
  'UPI QR payments start from the payment QR (POST /api/admin/payments/qr-intents): the document is created once Razorpay confirms the payment'

export interface QrPayment {
  razorpayPaymentId: string
  razorpayQrId: string | null
  amountPaise: number
  intentId: string
}

const qrPaymentSchema = z.object({
  razorpayPaymentId: z.string().min(1),
  razorpayQrId: z.string().nullish(),
  amountPaise: z.number().int().positive(),
  intentId: z.string().min(1),
})

/**
 * The request's QR payment. Only the finaliser's own token (claims.qrIntent = that intent) may carry one; a body
 * claiming it any other way gets `refused` (a 403), so a browser can't book a payment that never happened.
 */
export function qrPaymentOf(req: NextRequest, body: any): { qr: QrPayment | null; refused: NextResponse | null } {
  if (body?.qrPayment == null) return { qr: null, refused: null }
  const p = qrPaymentSchema.safeParse(body.qrPayment)
  const intent = intentOf(req)
  if (!p.success || !intent || intent === 'validate' || p.data.intentId !== intent)
    return { qr: null, refused: NextResponse.json({ error: 'qrPayment is only accepted from the payment finaliser' }, { status: 403 }) }
  return { qr: { ...p.data, razorpayQrId: p.data.razorpayQrId ?? null }, refused: null }
}

/** upi_qr is never a direct create: only the dry run and the finaliser use it. */
export function upiQrRefused(req: NextRequest, body: any, paymentMode: string | null | undefined): NextResponse | null {
  if (paymentMode !== 'upi_qr' || body?.dryRun === true || intentOf(req)) return null
  return NextResponse.json({ error: QR_FIRST_MESSAGE }, { status: 400 })
}

export const isDryRun = (body: any) => body?.dryRun === true

/** Thrown at the end of a dry run's transaction: everything rolls back and the result comes out. */
export class DryRun<T> extends Error {
  constructor(readonly result: T) {
    super('dry run')
  }
}

export function amountMismatch(totalInr: number, qr: QrPayment): NextResponse | null {
  if (Math.round(totalInr * 100) === qr.amountPaise) return null
  return NextResponse.json(
    { error: `The total is ₹${Math.round(totalInr * 100) / 100} but ₹${qr.amountPaise / 100} was paid` },
    { status: 409 }
  )
}

/** The paid-by-QR marks on an order and its completed payment row (transaction_id is unique: once only). */
export async function recordQrPayment(client: { query: (sql: string, params?: any[]) => Promise<any> }, orderId: string, qr: QrPayment) {
  await client.query(
    `UPDATE orders SET payment_status = 'paid', payment_mode = 'upi_qr', razorpay_qr_id = COALESCE($2, razorpay_qr_id), updated_at = NOW() WHERE id = $1`,
    [orderId, qr.razorpayQrId]
  )
  await client.query(
    `INSERT INTO payments (order_id, payment_method, payment_gateway, transaction_id, amount, status, gateway_response)
     VALUES ($1, 'upi', 'razorpay_qr', $2, $3, 'completed', $4)`,
    [
      orderId,
      qr.razorpayPaymentId,
      qr.amountPaise / 100,
      JSON.stringify({ razorpay_payment_id: qr.razorpayPaymentId, razorpay_qr_id: qr.razorpayQrId, payment_intent_id: qr.intentId }),
    ]
  )
}
