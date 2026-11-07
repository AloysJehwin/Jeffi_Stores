import { STATUS_RANK, type MarketStatus, type StockAction, type StockState } from './types'

// Pure rules for marketplace orders: our order status for a marketplace status, which stock move it
// needs, and the guard that ignores events arriving out of order.

/** Our orders.status for a marketplace status. */
export function ourOrderStatus(s: MarketStatus): string {
  switch (s) {
    case 'created':
      return 'pending'
    case 'accepted':
      return 'confirmed'
    case 'packed':
    case 'ready_to_dispatch':
      return 'processing'
    case 'shipped':
      return 'shipped'
    case 'delivered':
      return 'delivered'
    case 'cancelled':
    case 'rejected':
      return 'cancelled'
    case 'returned':
      return 'return_requested'
  }
}

/** The marketplace collects the money; an accepted order is paid from the store's side. */
export function paymentStatusFor(s: MarketStatus): string {
  if (s === 'created') return 'pending'
  if (s === 'cancelled' || s === 'rejected') return 'unpaid'
  return 'paid'
}

const HOLDS_STOCK: MarketStatus[] = ['accepted', 'packed', 'ready_to_dispatch', 'shipped', 'delivered']

/** Deduct on accept (or any later step), restore on cancel/reject; each happens at most once. Returns
 * restock when the return is received, not here. */
export function stockAction(status: MarketStatus, state: StockState): StockAction {
  if (HOLDS_STOCK.includes(status) && (state === 'none' || state === 'short')) return 'deduct'
  if ((status === 'cancelled' || status === 'rejected') && state === 'deducted') return 'restore'
  return 'none'
}

export interface Transition {
  /** Write the event (status and details); false = stale, ignore it. */
  apply: boolean
  status: MarketStatus
  /** The status moved. */
  changed: boolean
}

const time = (s?: string | null) => {
  const t = s ? Date.parse(s) : NaN
  return Number.isFinite(t) ? t : null
}

/** Ordering guard. Higher rank wins; the same status refreshes details unless the event is older; a
 * lower rank, or a second terminal status, is stale. A cancel after shipping is an RTO: returned. */
export function decideTransition(
  prior: { status: MarketStatus; eventAt?: string | null } | null,
  next: { status: MarketStatus; eventAt?: string | null }
): Transition {
  if (!prior) return { apply: true, status: next.status, changed: true }
  const terminal = (s: MarketStatus) => s === 'cancelled' || s === 'rejected' || s === 'returned'
  const shippedOrLater = STATUS_RANK[prior.status] >= STATUS_RANK.shipped && !terminal(prior.status)
  const status: MarketStatus = shippedOrLater && (next.status === 'cancelled' || next.status === 'rejected') ? 'returned' : next.status
  const from = STATUS_RANK[prior.status]
  const to = STATUS_RANK[status]
  if (to > from) return { apply: true, status, changed: true }
  if (status === prior.status) {
    const a = time(prior.eventAt)
    const b = time(next.eventAt)
    return { apply: a == null || b == null || b >= a, status, changed: false }
  }
  return { apply: false, status: prior.status, changed: false }
}
