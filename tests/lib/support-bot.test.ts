import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn(),
  queryOne: vi.fn(),
  query: vi.fn(),
  withTransaction: vi.fn(),
}))

import { getBotPayload, getBotReply, fetchUserOrders, type SupportOrder, type HistoryMessage } from '@/lib/shared/support-bot'
import { queryMany } from '@/lib/shared/db'

const mockQueryMany = vi.mocked(queryMany)

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeOrder(overrides: Partial<SupportOrder> = {}): SupportOrder {
  return {
    id: 'ord-1',
    order_number: 'ORD-001',
    status: 'confirmed',
    payment_status: 'paid',
    total_amount: '599.00',
    tracking_number: null,
    created_at: '2026-07-15T10:00:00Z',
    ...overrides,
  }
}

const NO_ORDERS: SupportOrder[] = []
const ONE_ORDER = [makeOrder()]
const TWO_ORDERS = [
  makeOrder({ id: 'ord-1', order_number: 'ORD-001', status: 'confirmed' }),
  makeOrder({ id: 'ord-2', order_number: 'ORD-002', status: 'delivered', total_amount: '299.00' }),
]

describe('fetchUserOrders', () => {
  beforeEach(() => vi.resetAllMocks())

  it('queries DB with userId and returns mapped rows', async () => {
    mockQueryMany.mockResolvedValueOnce(ONE_ORDER as any)
    const result = await fetchUserOrders('user-abc')
    expect(mockQueryMany).toHaveBeenCalledOnce()
    const [sql, params] = mockQueryMany.mock.calls[0]
    expect(sql).toContain('WHERE user_id = $1')
    expect(params).toEqual(['user-abc'])
    expect(result).toHaveLength(1)
    expect(result[0].order_number).toBe('ORD-001')
  })

  it('returns empty array when user has no orders', async () => {
    mockQueryMany.mockResolvedValueOnce([] as any)
    const result = await fetchUserOrders('user-xyz')
    expect(result).toEqual([])
  })
})

describe('getBotReply', () => {
  it('returns JSON-stringified BotPayload', () => {
    const reply = getBotReply('hello', NO_ORDERS)
    const parsed = JSON.parse(reply)
    expect(parsed).toHaveProperty('type')
  })
})

describe('getBotPayload — greeting', () => {
  it('hello → chips with quick-action topics', () => {
    const p = getBotPayload('hello', NO_ORDERS)
    expect(p.type).toBe('chips')
    if (p.type === 'chips') {
      expect(p.chips.length).toBeGreaterThan(0)
      expect(p.chips.some(c => c.label === 'Track my order')).toBe(true)
    }
  })

  it('hi → chips response', () => {
    const p = getBotPayload('hi there', NO_ORDERS)
    expect(p.type).toBe('chips')
  })

  it('hey → chips response', () => {
    const p = getBotPayload('Hey!', NO_ORDERS)
    expect(p.type).toBe('chips')
  })
})

describe('getBotPayload — all orders list', () => {
  it('my orders → order_list when user has orders', () => {
    const p = getBotPayload('my orders', TWO_ORDERS)
    expect(p.type).toBe('order_list')
    if (p.type === 'order_list') {
      expect(p.context).toBe('view')
      expect(p.orders).toHaveLength(2)
    }
  })

  it('all orders → order_list', () => {
    const p = getBotPayload('all orders', TWO_ORDERS)
    expect(p.type).toBe('order_list')
  })

  it('order history → order_list', () => {
    const p = getBotPayload('order history', TWO_ORDERS)
    expect(p.type).toBe('order_list')
  })

  it('purchase history → order_list', () => {
    const p = getBotPayload('purchase history', TWO_ORDERS)
    expect(p.type).toBe('order_list')
  })

  it('list orders → order_list', () => {
    const p = getBotPayload('list my orders', TWO_ORDERS)
    expect(p.type).toBe('order_list')
  })

  it('my orders → text_actions with browse link when no orders', () => {
    const p = getBotPayload('my orders', NO_ORDERS)
    expect(p.type).toBe('text_actions')
    if (p.type === 'text_actions') {
      expect(p.actions.some(a => a.url === '/products')).toBe(true)
    }
  })
})

describe('getBotPayload — tracking', () => {
  it('track my order → order_detail with view action', () => {
    const p = getBotPayload('track my order', ONE_ORDER)
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      expect(p.actions.some(a => a.url?.includes('/account/orders/'))).toBe(true)
    }
  })

  it('track with tracking_number → order_detail with delhivery track link', () => {
    const orderWithTracking = [makeOrder({ tracking_number: 'DLVRY12345' })]
    const p = getBotPayload('track my shipment', orderWithTracking)
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      expect(p.actions.some(a => a.url?.includes('delhivery.com'))).toBe(true)
    }
  })

  it('shipping → prompts order selection when multiple orders and no tracking number', () => {
    // No specific order named, no context order, multiple orders, no tracking
    const p = getBotPayload('track shipping', TWO_ORDERS)
    // With multiple orders and no specific one named → order_list for tracking context
    // OR order_detail for the first order — depends on whether tracking_number is set
    expect(['order_list', 'order_detail']).toContain(p.type)
  })

  it('track → text_actions when no orders', () => {
    const p = getBotPayload('track my order', NO_ORDERS)
    expect(p.type).toBe('text_actions')
  })

  it('dispatch → order_detail', () => {
    const p = getBotPayload('when will it be dispatched', ONE_ORDER)
    expect(p.type).toBe('order_detail')
  })

  it('shipped → order_detail', () => {
    const p = getBotPayload('has my order shipped?', ONE_ORDER)
    expect(p.type).toBe('order_detail')
  })

  it('track specific order number → order_detail for that order', () => {
    const p = getBotPayload('track order #ORD-001', TWO_ORDERS)
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      expect(p.order.order_number).toBe('ORD-001')
    }
  })
})

describe('getBotPayload — payment / invoice', () => {
  it('payment status with single order → order_detail', () => {
    const p = getBotPayload('payment status', ONE_ORDER)
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      expect(p.actions.some(a => a.label === 'View Invoice')).toBe(true)
      expect(p.actions.some(a => a.label === 'All Transactions')).toBe(true)
    }
  })

  it('invoice → order_detail', () => {
    const p = getBotPayload('show invoice', ONE_ORDER)
    expect(p.type).toBe('order_detail')
  })

  it('receipt → order_detail', () => {
    const p = getBotPayload('need receipt', ONE_ORDER)
    expect(p.type).toBe('order_detail')
  })

  it('bill → order_detail', () => {
    const p = getBotPayload('my bill', ONE_ORDER)
    expect(p.type).toBe('order_detail')
  })

  it('payment with multiple orders and no history context → order_list for payment', () => {
    const p = getBotPayload('payment details', TWO_ORDERS)
    expect(p.type).toBe('order_list')
    if (p.type === 'order_list') {
      expect(p.context).toBe('payment')
    }
  })

  it('payment with no orders → text_actions', () => {
    const p = getBotPayload('payment status', NO_ORDERS)
    expect(p.type).toBe('text_actions')
  })

  it('payment with order number in message → skips prompt, shows detail', () => {
    const p = getBotPayload('payment for order #ORD-001', TWO_ORDERS)
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      expect(p.order.order_number).toBe('ORD-001')
    }
  })

  it('payment with order number in history → skips prompt', () => {
    const history: HistoryMessage[] = [{ sender: 'user', message: 'I need details for ORD-001' }]
    const p = getBotPayload('paid status', TWO_ORDERS, history)
    expect(p.type).toBe('order_detail')
  })
})

describe('getBotPayload — cancel', () => {
  it('cancel with cancellable order → order_detail with cancel action', () => {
    const p = getBotPayload('cancel my order #ORD-001', [makeOrder({ status: 'pending' })])
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      expect(p.actions.some(a => a.label === 'Request Cancellation')).toBe(true)
    }
  })

  it('cancel with non-cancellable selected order → order_detail with view + contact actions', () => {
    const p = getBotPayload('cancel order #ORD-001', [makeOrder({ status: 'delivered' })])
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      expect(p.actions.some(a => a.label === 'View Order')).toBe(true)
      expect(p.actions.some(a => a.query === 'connect to agent')).toBe(true)
    }
  })

  it('cancel without specific order → order_list of cancellable orders', () => {
    const orders = [
      makeOrder({ id: 'ord-1', order_number: 'ORD-001', status: 'pending' }),
      makeOrder({ id: 'ord-2', order_number: 'ORD-002', status: 'delivered' }),
    ]
    const p = getBotPayload('cancel an order', orders)
    expect(p.type).toBe('order_list')
    if (p.type === 'order_list') {
      expect(p.context).toBe('cancel')
      expect(p.orders.every(o => ['pending', 'confirmed', 'processing'].includes(o.status))).toBe(true)
    }
  })

  it('cancel with no cancellable orders → text_actions explaining ineligibility', () => {
    const delivered = [makeOrder({ status: 'delivered' })]
    const p = getBotPayload('cancel my order', delivered)
    expect(p.type).toBe('text_actions')
    if (p.type === 'text_actions') {
      expect(p.text).toMatch(/eligible|cancel/i)
    }
  })

  it('cancel with all cancellable statuses: confirmed', () => {
    const p = getBotPayload('cancel my order #ORD-001', [makeOrder({ status: 'confirmed' })])
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      expect(p.actions.some(a => a.label === 'Request Cancellation')).toBe(true)
    }
  })

  it('cancel with all cancellable statuses: processing', () => {
    const p = getBotPayload('cancel order #ORD-001', [makeOrder({ status: 'processing' })])
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      expect(p.actions.some(a => a.label === 'Request Cancellation')).toBe(true)
    }
  })
})

describe('getBotPayload — return / refund / exchange', () => {
  it('return with delivered order → order_detail with return action', () => {
    const p = getBotPayload('return my order #ORD-001', [makeOrder({ status: 'delivered' })])
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      expect(p.actions.some(a => a.label === 'Request Return')).toBe(true)
    }
  })

  it('return with non-delivered selected order → view + contact actions', () => {
    const p = getBotPayload('return order #ORD-001', [makeOrder({ status: 'processing' })])
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      expect(p.actions.some(a => a.label === 'View Order')).toBe(true)
      expect(p.actions.some(a => a.query === 'connect to agent')).toBe(true)
    }
  })

  it('refund without specific order → order_list of returnable orders', () => {
    const orders = [
      makeOrder({ id: 'ord-1', order_number: 'ORD-001', status: 'delivered' }),
      makeOrder({ id: 'ord-2', order_number: 'ORD-002', status: 'processing' }),
    ]
    const p = getBotPayload('refund an order', orders)
    expect(p.type).toBe('order_list')
    if (p.type === 'order_list') {
      expect(p.context).toBe('return')
      expect(p.orders.every(o => o.status === 'delivered')).toBe(true)
    }
  })

  it('return with no delivered orders → text_actions', () => {
    const p = getBotPayload('return something', [makeOrder({ status: 'processing' })])
    expect(p.type).toBe('text_actions')
    if (p.type === 'text_actions') {
      expect(p.text).toMatch(/not.*eligible|don't have/i)
    }
  })

  it('exchange → returns same as return flow', () => {
    const p = getBotPayload('exchange my item', [makeOrder({ status: 'delivered' })])
    // No specific order named → returnable list
    expect(p.type).toBe('order_list')
  })

  it('replace → return flow', () => {
    const p = getBotPayload('replace this item', [makeOrder({ status: 'delivered' })])
    expect(p.type).toBe('order_list')
  })
})

describe('getBotPayload — specific order named without intent', () => {
  it('order number mentioned → order_detail with view + applicable actions', () => {
    const p = getBotPayload('details for order #ORD-001', ONE_ORDER)
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      expect(p.order.order_number).toBe('ORD-001')
      expect(p.actions.some(a => a.label === 'View Order')).toBe(true)
    }
  })

  it('adds track action when order has tracking number', () => {
    const orders = [makeOrder({ tracking_number: 'TRK999' })]
    const p = getBotPayload('order #ORD-001 details', orders)
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      expect(p.actions.some(a => a.url?.includes('delhivery'))).toBe(true)
    }
  })

  it('adds cancel action for cancellable status', () => {
    const orders = [makeOrder({ status: 'pending' })]
    const p = getBotPayload('tell me about order #ORD-001', orders)
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      expect(p.actions.some(a => a.label === 'Cancel Order')).toBe(true)
    }
  })

  it('adds return action for delivered status', () => {
    const orders = [makeOrder({ status: 'delivered' })]
    const p = getBotPayload('details for #ORD-001', orders)
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      expect(p.actions.some(a => a.label === 'Return Order')).toBe(true)
    }
  })

  it('longestMatch picks the longer order number when one is a substring of another', () => {
    const orders = [
      makeOrder({ id: 'ord-1', order_number: 'ORD-123' }),
      makeOrder({ id: 'ord-2', order_number: 'RPL-ORD-123' }),
    ]
    const p = getBotPayload('status of RPL-ORD-123', orders)
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      // RPL-ORD-123 is longer and appears in the text → should win
      expect(p.order.order_number).toBe('RPL-ORD-123')
    }
  })
})

describe('getBotPayload — latest / recent order', () => {
  it('latest order → order_detail for most recent', () => {
    const p = getBotPayload('my latest order', TWO_ORDERS)
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      // latest = first element
      expect(p.order.order_number).toBe('ORD-001')
    }
  })

  it('order status → order_detail for latest', () => {
    const p = getBotPayload('order status', ONE_ORDER)
    expect(p.type).toBe('order_detail')
  })

  it('where is my order → order_detail', () => {
    const p = getBotPayload('where is my order', ONE_ORDER)
    expect(p.type).toBe('order_detail')
  })

  it('status (without payment keyword) → order_detail', () => {
    const p = getBotPayload('status update please', ONE_ORDER)
    expect(p.type).toBe('order_detail')
  })

  it('latest order adds cancel action when eligible', () => {
    const orders = [makeOrder({ status: 'confirmed' })]
    const p = getBotPayload('last order', orders)
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      expect(p.actions.some(a => a.label === 'Cancel Order')).toBe(true)
    }
  })

  it('recent order → text_actions when no orders', () => {
    const p = getBotPayload('recent order', NO_ORDERS)
    expect(p.type).toBe('text_actions')
    if (p.type === 'text_actions') {
      expect(p.actions.some(a => a.url === '/products')).toBe(true)
    }
  })
})

describe('getBotPayload — delivery / ETA', () => {
  it('delivery → text_actions with delivery info', () => {
    const p = getBotPayload('when is my delivery', NO_ORDERS)
    expect(p.type).toBe('text_actions')
    if (p.type === 'text_actions') {
      expect(p.text).toMatch(/3.{0,3}7 business days/i)
      expect(p.actions.some(a => a.label === 'My Orders')).toBe(true)
    }
  })

  it('arrive → delivery text_actions', () => {
    const p = getBotPayload('when will it arrive', NO_ORDERS)
    expect(p.type).toBe('text_actions')
  })

  it('eta → delivery text_actions', () => {
    const p = getBotPayload('ETA for my order', NO_ORDERS)
    expect(p.type).toBe('text_actions')
  })

  it('when will → delivery text_actions', () => {
    const p = getBotPayload('when will you deliver', NO_ORDERS)
    expect(p.type).toBe('text_actions')
  })
})

describe('getBotPayload — account / profile', () => {
  it('account → nav with account links', () => {
    const p = getBotPayload('my account', NO_ORDERS)
    expect(p.type).toBe('nav')
    if (p.type === 'nav') {
      expect(p.links.some(l => l.url === '/account/orders')).toBe(true)
      expect(p.links.some(l => l.url === '/account/addresses')).toBe(true)
    }
  })

  it('profile → nav with account links', () => {
    const p = getBotPayload('edit profile', NO_ORDERS)
    expect(p.type).toBe('nav')
  })

  it('setting → nav with account links', () => {
    const p = getBotPayload('account settings', NO_ORDERS)
    expect(p.type).toBe('nav')
  })
})

describe('getBotPayload — address', () => {
  it('address → nav with address link', () => {
    const p = getBotPayload('change address', NO_ORDERS)
    expect(p.type).toBe('nav')
    if (p.type === 'nav') {
      expect(p.links.some(l => l.url === '/account/addresses')).toBe(true)
    }
  })

  it('pincode → nav with address link', () => {
    const p = getBotPayload('check pincode', NO_ORDERS)
    expect(p.type).toBe('nav')
  })

  it('location → nav with address link', () => {
    const p = getBotPayload('update location', NO_ORDERS)
    expect(p.type).toBe('nav')
  })
})

describe('getBotPayload — product / availability', () => {
  it('product → nav with browse + talk to agent', () => {
    const p = getBotPayload('show me products', NO_ORDERS)
    expect(p.type).toBe('nav')
    if (p.type === 'nav') {
      expect(p.links.some(l => l.url === '/products')).toBe(true)
      expect(p.links.some(l => l.query === 'connect to agent')).toBe(true)
    }
  })

  it('available → product nav', () => {
    const p = getBotPayload('is it available', NO_ORDERS)
    expect(p.type).toBe('nav')
  })

  it('stock → product nav', () => {
    const p = getBotPayload('check stock', NO_ORDERS)
    expect(p.type).toBe('nav')
  })

  it('price → product nav', () => {
    const p = getBotPayload('what is the price', NO_ORDERS)
    expect(p.type).toBe('nav')
  })
})

describe('getBotPayload — connect to agent / escalation', () => {
  it('agent → text_actions with connect button', () => {
    const p = getBotPayload('connect to agent', NO_ORDERS)
    expect(p.type).toBe('text_actions')
    if (p.type === 'text_actions') {
      expect(p.actions.some(a => a.query === '__connect_agent__')).toBe(true)
    }
  })

  it('human → escalation text_actions', () => {
    const p = getBotPayload('talk to a human', NO_ORDERS)
    expect(p.type).toBe('text_actions')
    if (p.type === 'text_actions') {
      expect(p.actions.some(a => a.query === '__connect_agent__')).toBe(true)
    }
  })

  it('support → escalation', () => {
    const p = getBotPayload('I need support', NO_ORDERS)
    expect(p.type).toBe('text_actions')
  })

  it('help me → escalation', () => {
    const p = getBotPayload('help me please', NO_ORDERS)
    expect(p.type).toBe('text_actions')
  })

  it('talk to → escalation', () => {
    const p = getBotPayload('talk to someone', NO_ORDERS)
    expect(p.type).toBe('text_actions')
  })

  it('person → escalation', () => {
    const p = getBotPayload('speak to a person', NO_ORDERS)
    expect(p.type).toBe('text_actions')
  })
})

describe('getBotPayload — fallback', () => {
  it('unknown message → text_actions fallback with order + agent links', () => {
    // Use a message with no keywords that match any branch
    const p = getBotPayload('zzzz unrelated 99999', NO_ORDERS)
    expect(p.type).toBe('text_actions')
    if (p.type === 'text_actions') {
      expect(p.actions.some(a => a.label === 'My Orders')).toBe(true)
      expect(p.actions.some(a => a.query === 'connect to agent')).toBe(true)
    }
  })
})

describe('getBotPayload — history context', () => {
  it('uses history to resolve order when processing a cancel request', () => {
    const history: HistoryMessage[] = [{ sender: 'user', message: 'I want to cancel ORD-002' }]
    // "cancel" branch: no selectedOrder in message, but history resolves ORD-002
    // contextOrder = extractOrderFromHistory → ORD-002
    // Since no specific order in message, falls to "filter cancellable" path
    // ORD-002 is 'delivered' (not cancellable) → ORD-001 is 'confirmed' (cancellable)
    // So it shows the cancellable list
    const p = getBotPayload('cancel an order', TWO_ORDERS, history)
    expect(p.type).toBe('order_list')
    if (p.type === 'order_list') {
      expect(p.context).toBe('cancel')
    }
  })

  it('message-level order wins over history order', () => {
    const history: HistoryMessage[] = [{ sender: 'user', message: 'ORD-002 is late' }]
    // Message names ORD-001 explicitly → selectedOrder = ORD-001 wins
    const p = getBotPayload('track order #ORD-001', TWO_ORDERS, history)
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      expect(p.order.order_number).toBe('ORD-001')
    }
  })

  it('history context resolves order for payment branch with multiple orders', () => {
    const history: HistoryMessage[] = [{ sender: 'user', message: 'I need invoice for ORD-002' }]
    // "payment" branch: no selected, multiple orders, but history has ORD-002
    // → skips the order-list prompt and shows order_detail
    const p = getBotPayload('show invoice', TWO_ORDERS, history)
    expect(p.type).toBe('order_detail')
    if (p.type === 'order_detail') {
      expect(p.order.order_number).toBe('ORD-002')
    }
  })
})
