// Order and payment status rules. PATCH /api/orders/[id] enforces them; the payment-status route
// and the admin agent validate against the same tables. Client-safe (no DB).

export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'out_for_delivery',
  'delivered',
  'granted',
  'cancel_requested',
  'cancel_rejected',
  'cancelled',
  'return_requested',
  'return_approved',
  'return_received',
  'return_rejected',
  'returned',
]

export const ORDER_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancel_requested', 'cancelled'],
  confirmed: ['processing', 'cancel_requested', 'cancelled'],
  processing: ['shipped', 'cancel_requested'],
  shipped: ['out_for_delivery', 'delivered'],
  out_for_delivery: ['delivered'],
  delivered: ['return_requested'],
  // Digital fulfilment: set by the payment paths, never by hand; nothing follows it.
  granted: [],
  cancel_requested: ['cancelled', 'cancel_rejected'],
  cancel_rejected: [],
  cancelled: [],
  return_requested: ['return_approved', 'return_rejected'],
  return_approved: ['return_received'],
  return_received: ['returned'],
  return_rejected: [],
  returned: [],
}

export const TERMINAL_ORDER_STATUSES = ['cancelled', 'cancel_rejected', 'return_rejected', 'returned']

export const PAYMENT_STATUSES = ['pending', 'unpaid', 'paid', 'failed', 'refunded', 'cod_pending', 'cod_collected']

// A hand-made payment change without an override (the orders UI offers the same moves).
export const PAYMENT_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ['paid', 'failed'],
  unpaid: ['paid', 'failed'],
  partial: ['paid'],
  paid: ['refunded'],
  failed: ['paid', 'pending'],
  refunded: [],
  cod_pending: ['cod_collected', 'failed'],
  cod_collected: ['paid', 'refunded'],
}

// Payment statuses that fit each order status.
export const PAYMENT_ALLOWED_FOR_STATUS: Record<string, string[]> = {
  pending: ['pending', 'unpaid', 'cod_pending', 'failed'],
  confirmed: ['pending', 'unpaid', 'cod_pending', 'paid', 'failed'],
  processing: ['paid', 'unpaid', 'cod_pending'],
  shipped: ['paid', 'cod_pending', 'cod_collected'],
  out_for_delivery: ['paid', 'cod_pending', 'cod_collected'],
  delivered: ['paid', 'cod_collected'],
  granted: ['paid', 'refunded'],
  cancel_requested: ['pending', 'unpaid', 'cod_pending', 'paid', 'failed'],
  cancel_rejected: ['pending', 'unpaid', 'cod_pending', 'paid', 'failed'],
  cancelled: ['paid', 'pending', 'unpaid', 'failed', 'refunded'],
}

/** A terminal order can only change through an override. */
export function orderLockedError(current: string): string | null {
  return TERMINAL_ORDER_STATUSES.includes(current) ? `Orders with status '${current}' cannot be modified` : null
}

/** Why `from → to` breaks the normal flow, or null (a same-status write is not a change). */
export function orderTransitionError(from: string, to: string): string | null {
  if (to === from) return null
  return (ORDER_STATUS_TRANSITIONS[from] ?? []).includes(to) ? null : `Cannot transition order from '${from}' to '${to}'`
}

/** The checks PATCH /api/orders/[id] applies to payment_status. */
export function paymentStatusError(
  from: string,
  to: string,
  override: boolean,
  allowed: readonly string[] = PAYMENT_STATUSES
): string | null {
  if (!allowed.includes(to)) return `Invalid payment status: ${to}`
  if (!override && from === 'paid' && to === 'pending') return 'Paid orders cannot revert to pending. Use refunded instead.'
  return null
}

export const REFUND_NEEDS_REFUND =
  'An order is marked refunded by the refund flow, which records how the money went back. Use the refund instead of setting the status.'

/** A hand-made payment change (no order-status move): the PATCH checks, the transition table and no bare "refunded". */
export function manualPaymentStatusError(
  from: string,
  to: string,
  override: boolean,
  allowed: readonly string[] = PAYMENT_STATUSES
): string | null {
  const base = paymentStatusError(from, to, override, allowed)
  if (base || override || to === from) return base
  if (to === 'refunded') return REFUND_NEEDS_REFUND
  return (PAYMENT_STATUS_TRANSITIONS[from] ?? []).includes(to) ? null : `Cannot move payment from '${from}' to '${to}'`
}
