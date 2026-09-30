import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendOrderStatusUpdate: vi.fn(),
}))

vi.mock('@/lib/auto-tasks', () => ({
  createAutoTask: vi.fn(),
  completeAutoTask: vi.fn(),
}))

vi.mock('@/lib/order-stock', () => ({
  restoreOrderStock: vi.fn(),
}))

vi.mock('@/lib/sms', () => ({
  sendOrderDeliveredSMS: vi.fn(),
  sendOutForDeliverySMS: vi.fn(),
}))

vi.mock('@/lib/delhivery', () => ({
  fetchDelhiveryInvoiceCharges: vi.fn(),
  // Real helper — the route uses it to build the cgm param; keeping the real maths means the
  // assertion below pins the actual value sent to Delhivery.
  chargeableGrams: (c: unknown, q: unknown, allowFloor = true) => {
    const kg = Number(c) || Number(q) || 0
    if (kg > 0) return Math.round(kg * 1000)
    return allowFloor ? 500 : 0
  },
}))

vi.mock('@/lib/site-controls', () => ({
  getBusinessValues: vi.fn(async () => ({ delhiveryOriginPincode: '492001' })),
}))

vi.mock('@/lib/integrations/resolve', () => ({
  resolveDelhiveryToken: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/delhivery/sync-statuses/route'
import { query, queryMany } from '@/lib/db'
import { sendOrderStatusUpdate } from '@/lib/email'
import { createAutoTask, completeAutoTask } from '@/lib/auto-tasks'
import { restoreOrderStock } from '@/lib/order-stock'
import { sendOrderDeliveredSMS, sendOutForDeliverySMS } from '@/lib/sms'
import { fetchDelhiveryInvoiceCharges } from '@/lib/delhivery'
import { resolveDelhiveryToken } from '@/lib/integrations/resolve'

const mockQuery = vi.mocked(query)
const mockQueryMany = vi.mocked(queryMany)
const mockSendEmail = vi.mocked(sendOrderStatusUpdate)
const mockCreateAutoTask = vi.mocked(createAutoTask)
const mockCompleteAutoTask = vi.mocked(completeAutoTask)
const mockRestoreStock = vi.mocked(restoreOrderStock)
const mockDeliveredSMS = vi.mocked(sendOrderDeliveredSMS)
const mockOfdSMS = vi.mocked(sendOutForDeliverySMS)
const mockInvoiceCharges = vi.mocked(fetchDelhiveryInvoiceCharges)
const mockResolveDelhiveryToken = vi.mocked(resolveDelhiveryToken)

// ── Helpers ───────────────────────────────────────────────────────────────────

const CRON = 'test-cron-secret'
const DELHIVERY_TOKEN = 'test-delhivery-key'

function makeReq(opts: { auth?: string } = {}) {
  const auth = opts.auth ?? `Bearer ${CRON}`
  return new NextRequest('http://localhost/api/admin/delhivery/sync-statuses', {
    method: 'POST',
    headers: { authorization: auth },
  })
}

const ORDER = {
  id: 'ord-1',
  awb_number: 'AWB001',
  status: 'shipped',
  order_number: 'ORD-001',
  customer_name: 'John Doe',
  customer_email: 'john@example.com',
  user_id: 'user-1',
  delhivery_quoted_weight_kg: 1,
  delhivery_charged_weight_kg: null,
}

function makeShipmentData(awb: string, statusType: string, extra: Record<string, any> = {}) {
  return {
    ShipmentData: [
      {
        Shipment: {
          AWB: awb,
          Status: {
            StatusType: statusType,
            Status: extra.status ?? '',
            StatusDateTime: extra.statusDateTime ?? '2024-06-01T12:00:00',
          },
          Scans: extra.scans ?? [],
          DestRecieveDate: extra.destReceiveDate ?? null,
          ReturnedDate: extra.returnedDate ?? null,
          ...extra.shipmentExtra,
        },
      },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON
  process.env.DELHIVERY_API_KEY = DELHIVERY_TOKEN
  mockQuery.mockResolvedValue({ rows: [] } as any)
  mockCreateAutoTask.mockResolvedValue(undefined as any)
  mockCompleteAutoTask.mockResolvedValue(undefined as any)
  mockSendEmail.mockResolvedValue(undefined as any)
  mockRestoreStock.mockResolvedValue(undefined as any)
  mockDeliveredSMS.mockResolvedValue(undefined as any)
  mockOfdSMS.mockResolvedValue(undefined as any)
  mockInvoiceCharges.mockResolvedValue(null as any)
  mockResolveDelhiveryToken.mockResolvedValue(DELHIVERY_TOKEN)
})

afterEach(() => {
  // CRON_SECRET and DELHIVERY_API_KEY are captured as module-level constants at
  // import time; env mutation here has no effect on the route handler.
})

// ── EDD + charged-weight + billing side-effects ──────────────────────────────

describe('POST — EDD, charged weight and delivery billing', () => {
  it('updates estimated_delivery_date when Delhivery returns an EDD', async () => {
    mockQueryMany.mockResolvedValueOnce([{ ...ORDER, status: 'processing' }] as any).mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makeShipmentData('AWB001', 'IT', {
          shipmentExtra: { ExpectedDeliveryDate: '2024-06-15' },
        }),
    } as any)

    await POST(makeReq())
    const eddUpdate = mockQuery.mock.calls.find(([sql]) => (sql as string).includes('estimated_delivery_date'))
    expect(eddUpdate).toBeDefined()
  })

  it('computes delhivery_extra_charge when charged weight exceeds quoted weight', async () => {
    mockQueryMany
      .mockResolvedValueOnce([
        {
          ...ORDER,
          status: 'shipped',
          shipping_amount: 100,
          delhivery_quoted_weight_kg: 1,
          delhivery_charged_weight_kg: null,
        },
      ] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makeShipmentData('AWB001', 'IT', {
          shipmentExtra: { ChargedWeight: 2 },
        }),
    } as any)

    await POST(makeReq())
    const wtUpdate = mockQuery.mock.calls.find(([sql]) => (sql as string).includes('delhivery_charged_weight_kg = $2'))
    expect(wtUpdate).toBeDefined()
    // extra = ((2/1)-1)*100 = 100
    expect((wtUpdate![1] as any[])[2]).toBe(100)
  })

  it('leaves extra charge null when charged weight not above quoted', async () => {
    mockQueryMany
      .mockResolvedValueOnce([
        {
          ...ORDER,
          status: 'shipped',
          shipping_amount: 100,
          delhivery_quoted_weight_kg: 5,
          delhivery_charged_weight_kg: null,
        },
      ] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makeShipmentData('AWB001', 'IT', {
          shipmentExtra: { ChargedWeight: 2 },
        }),
    } as any)

    await POST(makeReq())
    const wtUpdate = mockQuery.mock.calls.find(([sql]) => (sql as string).includes('delhivery_charged_weight_kg = $2'))
    expect((wtUpdate![1] as any[])[2]).toBeNull()
  })

  it('flips COD payment_status to cod_collected on delivery', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'out_for_delivery', payment_mode: 'cod' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'DL'),
    } as any)

    await POST(makeReq())
    const codUpdate = mockQuery.mock.calls.find(([sql]) => (sql as string).includes('cod_collected'))
    expect(codUpdate).toBeDefined()
  })

  it('pulls Delhivery invoice charges on delivery when not already billed', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'out_for_delivery', delhivery_billed_at: null }] as any)
      .mockResolvedValueOnce([])

    mockInvoiceCharges.mockResolvedValue({ total: 120, freight: 90, codCharge: 20, oda: 10 } as any)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'DL'),
    } as any)

    await POST(makeReq())
    // The charges endpoint rejects a bare waybill — md/ss/cgm/o_pin/d_pin are all mandatory,
    // which is why this sync silently returned nothing in production.
    expect(mockInvoiceCharges).toHaveBeenCalledWith(
      expect.objectContaining({
        awb: 'AWB001',
        settledStatus: 'Delivered',
        originPin: '492001',
      })
    )
    const chargeArg = mockInvoiceCharges.mock.calls[0][0] as any
    expect(chargeArg.chargedWeightG).toBeGreaterThan(0)
    const billUpdate = mockQuery.mock.calls.find(([sql]) => (sql as string).includes('delhivery_billed_amount'))
    expect(billUpdate).toBeDefined()
    expect((billUpdate![1] as any[])[1]).toBe(120)
  })

  it('does not fetch invoice charges when already billed', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'out_for_delivery', delhivery_billed_at: '2024-06-01' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'DL'),
    } as any)

    await POST(makeReq())
    expect(mockInvoiceCharges).not.toHaveBeenCalled()
  })

  it('handles null invoice charges (no billing write)', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'out_for_delivery', delhivery_billed_at: null }] as any)
      .mockResolvedValueOnce([])

    mockInvoiceCharges.mockResolvedValue(null as any)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'DL'),
    } as any)

    await POST(makeReq())
    const billUpdate = mockQuery.mock.calls.find(([sql]) => (sql as string).includes('delhivery_billed_amount'))
    expect(billUpdate).toBeUndefined()
  })

  it('skips billing when the order has no trustworthy weight', async () => {
    mockQueryMany
      .mockResolvedValueOnce([
        {
          ...ORDER,
          status: 'out_for_delivery',
          delhivery_billed_at: null,
          delhivery_quoted_weight_kg: null,
          delhivery_charged_weight_kg: null,
        },
      ] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'DL'),
    } as any)

    await POST(makeReq())
    // No weight → no 500 g floor in the wallet path → billing is deferred, not floored.
    expect(mockInvoiceCharges).not.toHaveBeenCalled()
    const billUpdate = mockQuery.mock.calls.find(([sql]) => (sql as string).includes('delhivery_billed_amount'))
    expect(billUpdate).toBeUndefined()
  })
})

// ── SMS notifications ─────────────────────────────────────────────────────────

describe('POST — SMS notifications', () => {
  it('sends delivered SMS when notification_channel is sms on delivery', async () => {
    mockQueryMany
      .mockResolvedValueOnce([
        { ...ORDER, status: 'out_for_delivery', notification_channel: 'sms', phone: '9876543210' },
      ] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'DL'),
    } as any)

    await POST(makeReq())
    expect(mockDeliveredSMS).toHaveBeenCalledWith({ phone: '9876543210', orderNumber: 'ORD-001' })
  })

  it('sends out-for-delivery SMS when notification_channel is sms and status OFD', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'shipped', notification_channel: 'sms', phone: '9876543210' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'OT'),
    } as any)

    await POST(makeReq())
    expect(mockOfdSMS).toHaveBeenCalledWith({ phone: '9876543210', orderNumber: 'ORD-001' })
  })

  it('does not send SMS when notification_channel is not sms', async () => {
    mockQueryMany
      .mockResolvedValueOnce([
        { ...ORDER, status: 'out_for_delivery', notification_channel: 'email', phone: '9876543210' },
      ] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'DL'),
    } as any)

    await POST(makeReq())
    expect(mockDeliveredSMS).not.toHaveBeenCalled()
    expect(mockOfdSMS).not.toHaveBeenCalled()
  })
})

// ── restoreOrderStock on returned ─────────────────────────────────────────────

describe('POST — restoreOrderStock on returned', () => {
  it('calls restoreOrderStock when order syncs to returned (RTO-DL)', async () => {
    mockQueryMany.mockResolvedValueOnce([{ ...ORDER, status: 'shipped' }] as any).mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'RTO-DL'),
    } as any)

    await POST(makeReq())
    expect(mockRestoreStock).toHaveBeenCalledWith('ord-1')
  })
})
