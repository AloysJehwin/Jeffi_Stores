import 'server-only'
import { queryMany } from '@/lib/shared/db'

/** Razorpay facts the admin order page shows beside the payments: refunds and their bank status. */

export interface OrderRefund {
  id: string
  razorpay_refund_id: string
  razorpay_payment_id: string
  amount: string
  status: 'pending' | 'processed' | 'failed'
  speed_processed: string | null
  arn: string | null
  purpose: string | null
  initiated_by: string
  failure_reason: string | null
  created_at: string
  processed_at: string | null
  failed_at: string | null
  retried: boolean
}

export async function orderRefunds(orderIds: string[]): Promise<OrderRefund[]> {
  return queryMany<OrderRefund>(
    `SELECT r.id, r.razorpay_refund_id, r.razorpay_payment_id, r.amount, r.status, r.speed_processed, r.arn, r.purpose,
            r.initiated_by, r.failure_reason, r.created_at, r.processed_at, r.failed_at,
            EXISTS (SELECT 1 FROM payment_refunds x WHERE x.retry_of = r.id AND x.status <> 'failed') AS retried
       FROM payment_refunds r
      WHERE r.order_id = ANY($1::uuid[])
      ORDER BY r.created_at`,
    [orderIds]
  ).catch(() => [])
}

export interface OrderDispute {
  id: string
  razorpay_dispute_id: string
  amount: string
  amount_deducted: string
  reason_code: string | null
  reason_description: string | null
  status: 'open' | 'under_review' | 'won' | 'lost' | 'closed'
  respond_by: string | null
  created_at: string
}

export async function orderDisputes(orderIds: string[]): Promise<OrderDispute[]> {
  return queryMany<OrderDispute>(
    `SELECT id, razorpay_dispute_id, amount, amount_deducted, reason_code, reason_description, status, respond_by, created_at
       FROM payment_disputes WHERE order_id = ANY($1::uuid[]) ORDER BY created_at`,
    [orderIds]
  ).catch(() => [])
}

/** How a payment was made, as a customer would recognise it: "UPI · name@bank", "Visa credit ••4242". */
export function paidWith(p: {
  gateway_method?: string | null
  card_network?: string | null
  card_type?: string | null
  card_last4?: string | null
  bank?: string | null
  wallet?: string | null
  vpa?: string | null
}): string | null {
  switch (p.gateway_method) {
    case 'upi':
      return p.vpa ? `UPI · ${p.vpa}` : 'UPI'
    case 'card':
      return [p.card_network, p.card_type].filter(Boolean).join(' ') + (p.card_last4 ? ` ••${p.card_last4}` : '') || 'Card'
    case 'netbanking':
      return p.bank ? `Net banking · ${p.bank}` : 'Net banking'
    case 'wallet':
      return p.wallet ? `Wallet · ${p.wallet}` : 'Wallet'
    case 'emi':
      return 'EMI'
    default:
      return p.gateway_method || null
  }
}
