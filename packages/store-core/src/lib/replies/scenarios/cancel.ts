import 'server-only'
import { cancelOrder } from '@/lib/orders/orders'
import type { ExecResult } from '../types'

/** The customer confirmed they want the order cancelled: a paid order becomes a cancel request for the team. */
export async function cancelForCustomer(orderId: string, orderNumber: string, userId: string | null): Promise<ExecResult> {
  const r = await cancelOrder(orderId, { reason: 'user_request', expectedUserId: userId ?? undefined })
  if (!r.success) return { ok: false, text: r.error }
  return {
    ok: true,
    close: true,
    text: r.directCancel ? `Order ${orderNumber} is cancelled.` : `We've asked our team to cancel order ${orderNumber}; you'll get a confirmation shortly.`,
  }
}
