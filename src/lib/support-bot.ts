import { queryMany } from '@/lib/db'

export interface SupportOrder {
  order_number: string
  status: string
  payment_status: string
  total_amount: string
  tracking_number: string | null
  created_at: string
}

export interface HistoryMessage {
  sender: string
  message: string
}

// Structured bot payload — rendered as interactive UI in SupportChat
export type BotPayload =
  | { type: 'text'; text: string }
  | { type: 'text_actions'; text: string; actions: BotAction[] }
  | { type: 'order_list'; text: string; orders: BotOrderCard[]; context: 'view' | 'cancel' | 'return' | 'track' | 'payment' }
  | { type: 'order_detail'; order: BotOrderCard; actions: BotAction[] }
  | { type: 'nav'; text: string; links: BotNavLink[] }
  | { type: 'chips'; text: string; chips: BotChip[] }

export interface BotAction {
  label: string
  url?: string
  query?: string  // sends as next user message
}

export interface BotNavLink {
  label: string
  url?: string
  query?: string
  icon?: 'orders' | 'account' | 'returns' | 'addresses' | 'invoices' | 'track'
}

export interface BotOrderCard {
  order_number: string
  status: string
  payment_status: string
  total_amount: string
  tracking_number: string | null
  created_at: string
}

export interface BotChip {
  label: string
  query: string
}

export async function fetchUserOrders(userId: string): Promise<SupportOrder[]> {
  return queryMany<SupportOrder>(
    `SELECT order_number, status, payment_status, total_amount::text, tracking_number, created_at
       FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
    [userId]
  )
}

function toCard(o: SupportOrder): BotOrderCard {
  return {
    order_number: o.order_number,
    status: o.status,
    payment_status: o.payment_status,
    total_amount: o.total_amount,
    tracking_number: o.tracking_number,
    created_at: o.created_at,
  }
}

function extractOrderFromHistory(history: HistoryMessage[], orders: SupportOrder[]): SupportOrder | null {
  const combined = history.map(h => h.message).join(' ')
  return longestMatch(combined, orders)
}

// Find an order number mentioned directly in a single message (e.g. the user just
// tapped an order card, which sends "track order #ORD-123"). Takes priority over
// the history scan so a freshly-selected order is honoured immediately.
function extractOrderFromText(text: string, orders: SupportOrder[]): SupportOrder | null {
  return longestMatch(text, orders)
}

// Returns the order whose number appears in `text`, preferring the LONGEST match.
// Order numbers can be substrings of one another (e.g. "ORD-123" is contained in
// "RPL-ORD-123"), so a plain first-match would pick the wrong order.
function longestMatch(text: string, orders: SupportOrder[]): SupportOrder | null {
  let best: SupportOrder | null = null
  for (const order of orders) {
    if (text.includes(order.order_number) && (!best || order.order_number.length > best.order_number.length)) {
      best = order
    }
  }
  return best
}

const CANCELLABLE = ['pending', 'confirmed', 'processing']
const RETURNABLE = ['delivered']

export function getBotPayload(msg: string, orders: SupportOrder[], history: HistoryMessage[] = []): BotPayload {
  const m = msg.toLowerCase()
  const latest = orders[0]
  // Order the user just picked (named in this message) wins; else one referenced
  // earlier in the chat; else the most recent order.
  const selectedOrder = extractOrderFromText(msg, orders)
  const contextOrder = selectedOrder ?? extractOrderFromHistory(history, orders) ?? latest

  // ── All orders list ──────────────────────────────────────────────────────
  // Only when NO specific order was named — otherwise fall through to detail.
  if (
    !selectedOrder && (
      (m.includes('all') && (m.includes('order') || m.includes('purchase'))) ||
      (m.includes('my orders') || m.includes('list') && m.includes('order')) ||
      (m.includes('order history') || m.includes('purchase history'))
    )
  ) {
    if (!orders.length) {
      return { type: 'text_actions', text: "you haven't placed any orders yet.", actions: [{ label: 'Browse Products', url: '/products' }] }
    }
    return {
      type: 'order_list',
      text: `here are your last ${orders.length} orders — tap one to see details`,
      orders: orders.map(toCard),
      context: 'view',
    }
  }

  // ── Tracking / shipping ──────────────────────────────────────────────────
  if (m.includes('track') || m.includes('shipping') || m.includes('shipped') || m.includes('dispatch')) {
    if (!contextOrder) {
      return { type: 'text_actions', text: "you don't have any orders yet.", actions: [{ label: 'Browse Products', url: '/products' }] }
    }
    // If a specific order was picked, always show its detail (don't re-prompt).
    if (!selectedOrder && !contextOrder.tracking_number && orders.length > 1) {
      return {
        type: 'order_list',
        text: "which order would you like to track?",
        orders: orders.map(toCard),
        context: 'track',
      }
    }
    return {
      type: 'order_detail',
      order: toCard(contextOrder),
      actions: [
        ...(contextOrder.tracking_number
          ? [{ label: 'Track Shipment', url: `https://www.delhivery.com/track/package/${contextOrder.tracking_number}` }]
          : []),
        { label: 'View Order', url: `/account/orders/${contextOrder.order_number}` },
      ],
    }
  }

  // ── Payment / invoice ────────────────────────────────────────────────────
  if (m.includes('payment') || m.includes('paid') || m.includes('invoice') || m.includes('receipt') || m.includes('bill')) {
    if (!contextOrder) {
      return { type: 'text_actions', text: "you don't have any orders yet.", actions: [{ label: 'Browse Products', url: '/products' }] }
    }
    if (!selectedOrder && orders.length > 1 && !extractOrderFromHistory(history, orders)) {
      return {
        type: 'order_list',
        text: "which order's payment details do you need?",
        orders: orders.map(toCard),
        context: 'payment',
      }
    }
    return {
      type: 'order_detail',
      order: toCard(contextOrder),
      actions: [
        { label: 'View Invoice', url: `/account/orders/${contextOrder.order_number}` },
        { label: 'All Transactions', url: '/account/transactions' },
      ],
    }
  }

  // ── Cancel ───────────────────────────────────────────────────────────────
  if (m.includes('cancel')) {
    // Specific order picked → show its detail with a cancel action.
    if (selectedOrder) {
      const eligible = CANCELLABLE.includes(selectedOrder.status)
      return {
        type: 'order_detail',
        order: toCard(selectedOrder),
        actions: eligible
          ? [{ label: 'Request Cancellation', url: `/account/orders/${selectedOrder.order_number}` }]
          : [{ label: 'View Order', url: `/account/orders/${selectedOrder.order_number}` }, { label: 'Contact Agent', query: 'connect to agent' }],
      }
    }
    const cancellable = orders.filter(o => CANCELLABLE.includes(o.status))
    if (!cancellable.length) {
      return {
        type: 'text_actions',
        text: "none of your recent orders are eligible for cancellation — orders can only be cancelled before they ship.",
        actions: [{ label: 'View Orders', url: '/account/orders' }, { label: 'Contact Agent', query: 'connect to agent' }],
      }
    }
    return {
      type: 'order_list',
      text: "which order would you like to cancel?",
      orders: cancellable.map(toCard),
      context: 'cancel',
    }
  }

  // ── Return / refund / exchange ───────────────────────────────────────────
  if (m.includes('return') || m.includes('refund') || m.includes('exchange') || m.includes('replace')) {
    // Specific order picked → show its detail with a return action.
    if (selectedOrder) {
      const eligible = RETURNABLE.includes(selectedOrder.status)
      return {
        type: 'order_detail',
        order: toCard(selectedOrder),
        actions: eligible
          ? [{ label: 'Request Return', url: `/account/orders/${selectedOrder.order_number}` }]
          : [{ label: 'View Order', url: `/account/orders/${selectedOrder.order_number}` }, { label: 'Contact Agent', query: 'connect to agent' }],
      }
    }
    const returnable = orders.filter(o => RETURNABLE.includes(o.status))
    if (!returnable.length) {
      return {
        type: 'text_actions',
        text: "you don't have any delivered orders eligible for return right now.",
        actions: [{ label: 'View Orders', url: '/account/orders' }, { label: 'Contact Agent', query: 'connect to agent' }],
      }
    }
    return {
      type: 'order_list',
      text: "which order would you like to return? refunds go back to your original payment method in 5–7 business days.",
      orders: returnable.map(toCard),
      context: 'return',
    }
  }

  // ── A specific order was named but no cancel/return/track/payment intent ──
  // (e.g. "details for order #ORD-123" from tapping a card in the all-orders list)
  if (selectedOrder) {
    return {
      type: 'order_detail',
      order: toCard(selectedOrder),
      actions: [
        { label: 'View Order', url: `/account/orders/${selectedOrder.order_number}` },
        ...(selectedOrder.tracking_number
          ? [{ label: 'Track Shipment', url: `https://www.delhivery.com/track/package/${selectedOrder.tracking_number}` }]
          : []),
        ...(CANCELLABLE.includes(selectedOrder.status)
          ? [{ label: 'Cancel Order', query: `i want to cancel order #${selectedOrder.order_number}` }]
          : []),
        ...(RETURNABLE.includes(selectedOrder.status)
          ? [{ label: 'Return Order', query: `i want to return order #${selectedOrder.order_number}` }]
          : []),
      ],
    }
  }

  // ── Latest / recent order ─────────────────────────────────────────────────
  if (
    m.includes('latest order') || m.includes('recent order') || m.includes('last order') ||
    (m.includes('order') && (m.includes('status') || m.includes('update') || m.includes('where'))) ||
    (m.includes('status') && !m.includes('payment'))
  ) {
    if (!latest) {
      return { type: 'text_actions', text: "you haven't placed any orders yet.", actions: [{ label: 'Browse Products', url: '/products' }] }
    }
    return {
      type: 'order_detail',
      order: toCard(latest),
      actions: [
        { label: 'View Order', url: `/account/orders/${latest.order_number}` },
        ...(latest.tracking_number ? [{ label: 'Track Shipment', url: `https://www.delhivery.com/track/package/${latest.tracking_number}` }] : []),
        ...(CANCELLABLE.includes(latest.status) ? [{ label: 'Cancel Order', url: `/account/orders/${latest.order_number}` }] : []),
      ],
    }
  }

  // ── Delivery / ETA ────────────────────────────────────────────────────────
  if (m.includes('delivery') || m.includes('deliver') || m.includes('arrive') || m.includes('eta') || m.includes('when will')) {
    return {
      type: 'text_actions',
      text: "delivery usually takes 3–7 business days depending on your location. express delivery is available for select pincodes.",
      actions: [
        { label: 'My Orders', url: '/account/orders' },
        { label: 'Check Pincode', query: 'check delivery pincode' },
      ],
    }
  }

  // ── Account / profile ─────────────────────────────────────────────────────
  if (m.includes('account') || m.includes('profile') || m.includes('setting')) {
    return {
      type: 'nav',
      text: "here's what you can manage in your account:",
      links: [
        { label: 'My Orders', url: '/account/orders', icon: 'orders' },
        { label: 'Addresses', url: '/account/addresses', icon: 'addresses' },
        { label: 'Transactions', url: '/account/transactions', icon: 'invoices' },
        { label: 'Account Settings', url: '/account', icon: 'account' },
      ],
    }
  }

  // ── Address ───────────────────────────────────────────────────────────────
  if (m.includes('address') || m.includes('pincode') || m.includes('location')) {
    return {
      type: 'nav',
      text: "you can manage your delivery addresses here:",
      links: [{ label: 'Manage Addresses', url: '/account/addresses', icon: 'addresses' }],
    }
  }

  // ── Product / availability ────────────────────────────────────────────────
  if (m.includes('product') || m.includes('available') || m.includes('stock') || m.includes('price')) {
    return {
      type: 'nav',
      text: "browse our product catalogue here. if something's out of stock, our agents can help with availability timelines.",
      links: [
        { label: 'Browse Products', url: '/products', icon: 'orders' },
        { label: 'Talk to Agent', query: 'connect to agent' },
      ],
    }
  }

  // ── Connect to agent ──────────────────────────────────────────────────────
  if (
    m.includes('agent') || m.includes('human') || m.includes('person') ||
    m.includes('support') || m.includes('help me') || m.includes('talk to')
  ) {
    return {
      type: 'text_actions',
      text: "sure! let me connect you to a live support agent.",
      actions: [{ label: 'Connect to Agent', query: '__connect_agent__' }],
    }
  }

  // ── Greeting ──────────────────────────────────────────────────────────────
  if (m.includes('hello') || m.includes('hi') || m.includes('hey') || m.includes('hiya')) {
    return {
      type: 'chips',
      text: "hey! i'm Jeffi. what can i help you with today?",
      chips: [
        { label: 'Track my order', query: 'track my order' },
        { label: 'My orders', query: 'all my orders' },
        { label: 'Cancel order', query: 'cancel an order' },
        { label: 'Return / Refund', query: 'return an order' },
        { label: 'Payment status', query: 'payment status' },
        { label: 'Talk to agent', query: 'connect to agent' },
      ],
    }
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  return {
    type: 'text_actions',
    text: "got your message! our team will get back to you shortly. in the meantime, can i help with any of these?",
    actions: [
      { label: 'My Orders', url: '/account/orders' },
      { label: 'Track Order', query: 'track my order' },
      { label: 'Talk to Agent', query: 'connect to agent' },
    ],
  }
}

// Legacy plain-text fallback used by the live-mode DB insert (still works for basic replies)
export function getBotReply(msg: string, orders: SupportOrder[], history: HistoryMessage[] = []): string {
  const payload = getBotPayload(msg, orders, history)
  return JSON.stringify(payload)
}
