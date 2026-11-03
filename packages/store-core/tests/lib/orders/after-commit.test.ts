import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

// --- mock every downstream side effect so we can assert exactly which ones fire ---
const mocks = vi.hoisted(() => ({
  createDraftInvoice: vi.fn(async () => {}),
  sendOrderConfirmationEmail: vi.fn(async () => {}),
  sendNewOrderNotification: vi.fn(async () => {}),
  sendPaymentStatusUpdate: vi.fn(async () => {}),
  sendOrderConfirmedSMS: vi.fn(async () => true),
  logActivity: vi.fn(async () => {}),
  recordImplicitSignalsForProducts: vi.fn(async () => {}),
  createAutoTask: vi.fn(async () => 'task-1'),
  attributeConversion: vi.fn(async () => {}),
  grantOrderEntitlements: vi.fn(async () => 0),
  queryOne: vi.fn(async () => null),
  queryMany: vi.fn(async () => []),
  query: vi.fn(async (..._args: any[]) => ({ rowCount: 0, rows: [] })),
}))

vi.mock('@/lib/shared/db', () => ({
  queryOne: mocks.queryOne,
  queryMany: mocks.queryMany,
  query: mocks.query,
}))
vi.mock('@/lib/documents/invoice', () => ({ createDraftInvoice: mocks.createDraftInvoice }))
vi.mock('@/lib/email', () => ({
  sendOrderConfirmationEmail: mocks.sendOrderConfirmationEmail,
  sendNewOrderNotification: mocks.sendNewOrderNotification,
  sendPaymentStatusUpdate: mocks.sendPaymentStatusUpdate,
}))
vi.mock('@/lib/shared/sms', () => ({ sendOrderConfirmedSMS: mocks.sendOrderConfirmedSMS }))
vi.mock('@/lib/shared/activity', () => ({ logActivity: mocks.logActivity }))
vi.mock('@/lib/shared/ai-feedback', () => ({ recordImplicitSignalsForProducts: mocks.recordImplicitSignalsForProducts }))
vi.mock('@/lib/shared/auto-tasks', () => ({ createAutoTask: mocks.createAutoTask }))
vi.mock('@/lib/shared/marketing', () => ({ attributeConversion: mocks.attributeConversion }))
vi.mock('@/lib/orders/entitlements', () => ({ grantOrderEntitlements: mocks.grantOrderEntitlements }))

import { afterOrderCommitted } from '@/lib/orders/after-commit'

const ORDER = { id: 'o1', order_number: 'ORD-1', total_amount: '1200.00' }
const USER = { email: 'a@b.com', phone: '9000000000', first_name: 'A', last_name: 'B', notification_channel: 'email' }
const ITEMS = [{ product_id: 'p1' }, { product_id: 'p2' }, { product_id: null }]

// Let microtask-queued fire-and-forget .catch chains settle before asserting.
const flush = () => new Promise(r => setTimeout(r, 0))

describe('afterOrderCommitted', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fires the common block (invoice, signals, activity, emails) and never the opt-ins by default', async () => {
    await afterOrderCommitted({ userId: 'u1', order: ORDER, user: USER, orderItems: ITEMS })
    await flush()

    expect(mocks.createDraftInvoice).toHaveBeenCalledWith('o1')
    expect(mocks.recordImplicitSignalsForProducts).toHaveBeenCalledWith('u1', ['p1', 'p2'], 'purchased')
    expect(mocks.logActivity).toHaveBeenCalledTimes(1)
    expect(mocks.sendOrderConfirmationEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendNewOrderNotification).toHaveBeenCalledTimes(1)
    expect(mocks.sendPaymentStatusUpdate).toHaveBeenCalledTimes(1)

    // opt-ins off by default
    expect(mocks.attributeConversion).not.toHaveBeenCalled()
    expect(mocks.sendOrderConfirmedSMS).not.toHaveBeenCalled()
    expect(mocks.createAutoTask).not.toHaveBeenCalled()
    expect(mocks.query).not.toHaveBeenCalled() // no markIntentCommitted
  })

  it('verify flavour: marks intent committed, fires Route + SMS + high-value task, NOT attributeConversion', async () => {
    const routeTransfer = vi.fn(() => Promise.resolve())
    await afterOrderCommitted({
      userId: 'u1',
      order: { id: 'o1', order_number: 'ORD-1', total_amount: '60000' },
      user: { ...USER, notification_channel: 'sms' },
      orderItems: ITEMS,
      markIntentCommittedForOrderId: 'rzp_order_1',
      routeTransfer,
      sms: true,
      highValueTask: true,
    })
    await flush()

    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.query.mock.calls[0][0]).toMatch(/UPDATE pending_payment_intents SET committed = true/)
    expect(mocks.query.mock.calls[0][1]).toEqual(['rzp_order_1'])
    expect(routeTransfer).toHaveBeenCalledTimes(1)
    expect(mocks.sendOrderConfirmedSMS).toHaveBeenCalledTimes(1)
    expect(mocks.createAutoTask).toHaveBeenCalledTimes(1) // 60000 >= 50000
    expect(mocks.attributeConversion).not.toHaveBeenCalled()
  })

  it('high-value task does NOT fire below the 50000 threshold', async () => {
    await afterOrderCommitted({
      userId: 'u1',
      order: { id: 'o1', order_number: 'ORD-1', total_amount: '49999' },
      user: USER,
      orderItems: ITEMS,
      highValueTask: true,
    })
    await flush()
    expect(mocks.createAutoTask).not.toHaveBeenCalled()
  })

  it('SMS requires BOTH notification_channel==="sms" AND a phone', async () => {
    await afterOrderCommitted({ userId: 'u1', order: ORDER, user: { ...USER, notification_channel: 'email' }, orderItems: ITEMS, sms: true })
    await flush()
    expect(mocks.sendOrderConfirmedSMS).not.toHaveBeenCalled()

    vi.clearAllMocks()
    await afterOrderCommitted({ userId: 'u1', order: ORDER, user: { ...USER, notification_channel: 'sms', phone: null }, orderItems: ITEMS, sms: true })
    await flush()
    expect(mocks.sendOrderConfirmedSMS).not.toHaveBeenCalled()
  })

  it('webhook flavour: fires attributeConversion but no SMS / high-value task', async () => {
    const routeTransfer = vi.fn(() => Promise.resolve())
    await afterOrderCommitted({
      userId: 'u1',
      order: ORDER,
      user: USER,
      orderItems: ITEMS,
      routeTransfer,
      attributeConversion: true,
    })
    await flush()
    expect(mocks.attributeConversion).toHaveBeenCalledWith('u1', 'o1')
    expect(routeTransfer).toHaveBeenCalledTimes(1)
    expect(mocks.sendOrderConfirmedSMS).not.toHaveBeenCalled()
    expect(mocks.createAutoTask).not.toHaveBeenCalled()
  })

  it('check-pending flavour: no Route, no SMS, no attributeConversion, no intent mark', async () => {
    await afterOrderCommitted({ userId: 'u1', order: ORDER, user: USER, orderItems: ITEMS })
    await flush()
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.attributeConversion).not.toHaveBeenCalled()
    expect(mocks.sendOrderConfirmedSMS).not.toHaveBeenCalled()
    expect(mocks.sendOrderConfirmationEmail).toHaveBeenCalledTimes(1)
  })

  it('loads order items when not pre-supplied', async () => {
    mocks.queryMany.mockResolvedValueOnce([{ product_id: 'px' }] as any)
    await afterOrderCommitted({ userId: 'u1', order: ORDER, user: USER })
    await flush()
    expect(mocks.queryMany).toHaveBeenCalledWith('SELECT * FROM order_items WHERE order_id = $1', ['o1'])
    expect(mocks.recordImplicitSignalsForProducts).toHaveBeenCalledWith('u1', ['px'], 'purchased')
  })

  it('loads the user when not supplied, and skips the emails/SMS when it still cannot be resolved', async () => {
    mocks.queryOne.mockResolvedValue(null) // user load fails
    await afterOrderCommitted({ userId: 'u1', order: ORDER, orderItems: ITEMS, sms: true })
    await flush()
    // common block still ran
    expect(mocks.createDraftInvoice).toHaveBeenCalledTimes(1)
    expect(mocks.logActivity).toHaveBeenCalledTimes(1)
    // user-dependent effects skipped
    expect(mocks.sendOrderConfirmationEmail).not.toHaveBeenCalled()
    expect(mocks.sendPaymentStatusUpdate).not.toHaveBeenCalled()
    expect(mocks.sendOrderConfirmedSMS).not.toHaveBeenCalled()
  })

  it('does NOT grant entitlements itself (grants belong inside the commit transaction)', async () => {
    await afterOrderCommitted({ userId: 'u1', order: ORDER, user: USER, orderItems: ITEMS })
    await flush()
    expect(mocks.grantOrderEntitlements).not.toHaveBeenCalled()
  })

  it('never rejects even if a side effect throws', async () => {
    mocks.createDraftInvoice.mockRejectedValueOnce(new Error('boom'))
    await expect(afterOrderCommitted({ userId: 'u1', order: ORDER, user: USER, orderItems: ITEMS })).resolves.toBeUndefined()
  })
})
