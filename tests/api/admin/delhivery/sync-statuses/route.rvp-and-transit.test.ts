import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendOrderStatusUpdate: vi.fn(),
}))

vi.mock('@/lib/shared/auto-tasks', () => ({
  createAutoTask: vi.fn(),
  completeAutoTask: vi.fn(),
}))

vi.mock('@/lib/orders/order-stock', () => ({
  restoreOrderStock: vi.fn(),
}))

vi.mock('@/lib/shared/sms', () => ({
  sendOrderDeliveredSMS: vi.fn(),
  sendOutForDeliverySMS: vi.fn(),
}))

vi.mock('@/lib/shipping/delhivery', () => ({
  fetchDelhiveryInvoiceCharges: vi.fn(),
  // Real helper — the route uses it to build the cgm param; keeping the real maths means the
  // assertion below pins the actual value sent to Delhivery.
  chargeableGrams: (c: unknown, q: unknown, allowFloor = true) => {
    const kg = Number(c) || Number(q) || 0
    if (kg > 0) return Math.round(kg * 1000)
    return allowFloor ? 500 : 0
  },
}))

vi.mock('@/lib/catalog/site-controls', () => ({
  getBusinessValues: vi.fn(async () => ({ delhiveryOriginPincode: '492001' })),
}))

vi.mock('@/lib/integrations/resolve', () => ({
  resolveDelhiveryToken: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/delhivery/sync-statuses/route'
import { query, queryMany } from '@/lib/shared/db'
import { sendOrderStatusUpdate } from '@/lib/email'
import { createAutoTask, completeAutoTask } from '@/lib/shared/auto-tasks'
import { restoreOrderStock } from '@/lib/orders/order-stock'
import { sendOrderDeliveredSMS, sendOutForDeliverySMS } from '@/lib/shared/sms'
import { fetchDelhiveryInvoiceCharges } from '@/lib/shipping/delhivery'
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

// ── RVP loop ──────────────────────────────────────────────────────────────────

const RVP = {
  id: 'rr-1',
  rvp_awb_number: 'RVP001',
  order_id: 'ord-1',
  user_id: 'user-1',
  order_number: 'ORD-001',
}

describe('POST — RVP return request loop', () => {
  it('marks received_at when destReceiveDate is set', async () => {
    mockQueryMany.mockResolvedValueOnce([]) // orders — so we skip order loop
    // orders loop returns early with synced:0 total:0 before rvp... need orders > 0
    // Actually when orders.length === 0 the route returns early.
    // We need at least one order to get past the early return:
    // Re-design: provide one order that won't sync, then RVP data
    mockQueryMany.mockReset()
    mockQueryMany
      .mockResolvedValueOnce([ORDER] as any) // orders (will get no matching shipment → synced=0)
      .mockResolvedValueOnce([RVP] as any) // rvp requests

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ShipmentData: [] }), // orders fetch → nothing synced
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ShipmentData: [
            {
              Shipment: {
                AWB: 'RVP001',
                Status: { StatusType: 'DL', Status: 'delivered', StatusDateTime: '2024-06-10T10:00:00' },
                Scans: [],
                DestRecieveDate: '2024-06-10',
                ReturnedDate: null,
              },
            },
          ],
        }),
      } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.rvp.received).toBe(1)

    const rvpUpdate = mockQuery.mock.calls.find(([sql]) => (sql as string).includes('UPDATE return_requests'))
    expect(rvpUpdate).toBeDefined()
    expect((rvpUpdate![1] as any[])[0]).toBe('rr-1')
    expect((rvpUpdate![1] as any[])[1]).toBe('2024-06-10')

    expect(mockCompleteAutoTask).toHaveBeenCalledWith('schedule_pickup', 'ord-1')
    expect(mockCreateAutoTask).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKind: 'inspect_refund', userId: 'user-1' })
    )
  })

  it('marks received when ReturnedDate is set (destReceiveDate null)', async () => {
    mockQueryMany.mockResolvedValueOnce([ORDER] as any).mockResolvedValueOnce([RVP] as any)

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ShipmentData: [
            {
              Shipment: {
                AWB: 'RVP001',
                Status: { StatusType: 'DL', Status: '', StatusDateTime: null },
                Scans: [],
                DestRecieveDate: null,
                ReturnedDate: '2024-06-11',
              },
            },
          ],
        }),
      } as any)

    const res = await POST(makeReq())
    expect((await res.json()).rvp.received).toBe(1)
    const rvpUpdate = mockQuery.mock.calls.find(([sql]) => (sql as string).includes('UPDATE return_requests'))
    expect((rvpUpdate![1] as any[])[1]).toBe('2024-06-11')
  })

  it('marks received when statusLabel is "delivered" (both date fields null)', async () => {
    mockQueryMany.mockResolvedValueOnce([ORDER] as any).mockResolvedValueOnce([RVP] as any)

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ShipmentData: [
            {
              Shipment: {
                AWB: 'RVP001',
                Status: { StatusType: 'DL', Status: 'delivered', StatusDateTime: '2024-06-12T09:00:00' },
                Scans: [],
                DestRecieveDate: null,
                ReturnedDate: null,
              },
            },
          ],
        }),
      } as any)

    const res = await POST(makeReq())
    expect((await res.json()).rvp.received).toBe(1)
  })

  it('skips RVP entry not yet received at warehouse', async () => {
    mockQueryMany.mockResolvedValueOnce([ORDER] as any).mockResolvedValueOnce([RVP] as any)

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ShipmentData: [
            {
              Shipment: {
                AWB: 'RVP001',
                Status: { StatusType: 'IT', Status: 'in transit', StatusDateTime: null },
                Scans: [],
                DestRecieveDate: null,
                ReturnedDate: null,
              },
            },
          ],
        }),
      } as any)

    const res = await POST(makeReq())
    expect((await res.json()).rvp.received).toBe(0)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('does not call completeAutoTask when user_id is null', async () => {
    mockQueryMany.mockResolvedValueOnce([ORDER] as any).mockResolvedValueOnce([{ ...RVP, user_id: null }] as any)

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ShipmentData: [
            {
              Shipment: {
                AWB: 'RVP001',
                Status: { StatusType: 'DL', Status: 'delivered', StatusDateTime: null },
                Scans: [],
                DestRecieveDate: '2024-06-10',
                ReturnedDate: null,
              },
            },
          ],
        }),
      } as any)

    const res = await POST(makeReq())
    expect((await res.json()).rvp.received).toBe(1)
    expect(mockCompleteAutoTask).not.toHaveBeenCalled()
    expect(mockCreateAutoTask).not.toHaveBeenCalled()
  })

  it('records rvp error when RVP fetch returns non-ok', async () => {
    mockQueryMany.mockResolvedValueOnce([ORDER] as any).mockResolvedValueOnce([RVP] as any)

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.rvp.errors).toHaveLength(1)
    expect(body.rvp.errors[0].awb).toBe('RVP001')
  })

  it('records rvp error when RVP fetch throws', async () => {
    mockQueryMany.mockResolvedValueOnce([ORDER] as any).mockResolvedValueOnce([RVP] as any)

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockRejectedValueOnce(new Error('RVP network error'))

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.rvp.errors).toHaveLength(1)
    expect(body.rvp.errors[0].error).toBe('RVP network error')
  })

  it('skips RVP entry when AWB does not match any return request', async () => {
    mockQueryMany.mockResolvedValueOnce([ORDER] as any).mockResolvedValueOnce([RVP] as any)

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeShipmentData('DIFFERENT_AWB', 'DL', { destReceiveDate: '2024-06-10' }),
      } as any)

    const res = await POST(makeReq())
    expect((await res.json()).rvp.received).toBe(0)
  })

  it('handles rvpRequests queryMany failure gracefully (returns [])', async () => {
    mockQueryMany.mockResolvedValueOnce([ORDER] as any).mockRejectedValueOnce(new Error('RVP query failed')) // rvp queryMany throws → caught → []

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ShipmentData: [] }),
    } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.rvp.total).toBe(0)
    expect(body.rvp.received).toBe(0)
  })
})

// ── OT / OD statuses ─────────────────────────────────────────────────────────

describe('POST — OT and OD statuses (out_for_delivery)', () => {
  it('syncs OT to out_for_delivery', async () => {
    mockQueryMany.mockResolvedValueOnce([{ ...ORDER, status: 'shipped' }] as any).mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'OT'),
    } as any)

    expect((await (await POST(makeReq())).json()).results[0].syncedTo).toBe('out_for_delivery')
  })

  it('syncs OD to out_for_delivery', async () => {
    mockQueryMany.mockResolvedValueOnce([{ ...ORDER, status: 'shipped' }] as any).mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'OD'),
    } as any)

    expect((await (await POST(makeReq())).json()).results[0].syncedTo).toBe('out_for_delivery')
  })
})

// ── IT status ─────────────────────────────────────────────────────────────────

describe('POST — IT status (in-transit → shipped)', () => {
  it('syncs IT to shipped', async () => {
    mockQueryMany.mockResolvedValueOnce([{ ...ORDER, status: 'confirmed' }] as any).mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'IT'),
    } as any)

    expect((await (await POST(makeReq())).json()).results[0].syncedTo).toBe('shipped')
  })
})

// ── RTO-IT status ─────────────────────────────────────────────────────────────

describe('POST — RTO-IT status', () => {
  it('syncs RTO-IT to shipped and fires createAutoTask (RTO prefix)', async () => {
    mockQueryMany.mockResolvedValueOnce([{ ...ORDER, status: 'shipped' }] as any).mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'RTO-IT'),
    } as any)

    const body = await (await POST(makeReq())).json()
    expect(body.results[0].syncedTo).toBe('shipped')
    expect(mockCreateAutoTask).toHaveBeenCalled()
  })
})
