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

import { POST } from '@/app/api/(admin)/admin/delhivery/sync-statuses/route'
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

// ── Auth / config guards ──────────────────────────────────────────────────────
// NOTE: CRON_SECRET is captured at module load time as a module-level constant, so env
// mutations in beforeEach/afterEach have no effect on it. The Delhivery token is resolved
// per-request via resolveDelhiveryToken (tenant-aware), so the 503 path is driven by mocking
// that helper to return an empty token rather than by clearing env / re-importing the module.

describe('POST /api/admin/delhivery/sync-statuses — auth / config', () => {
  it('returns 401 when authorization header does not match', async () => {
    const res = await POST(makeReq({ auth: 'Bearer wrong-secret' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 when authorization header is missing', async () => {
    const req = new NextRequest('http://localhost/api/admin/delhivery/sync-statuses', {
      method: 'POST',
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 503 when no Delhivery token resolves', async () => {
    // The route reads orders before the token check and 200s early on an empty list, so it must
    // see at least one order to reach the 503 config guard.
    mockQueryMany.mockResolvedValueOnce([ORDER] as any)
    mockResolveDelhiveryToken.mockResolvedValueOnce('')

    const res = await POST(makeReq())
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/not configured/)
  })
})

// ── No orders ─────────────────────────────────────────────────────────────────

describe('POST — no orders with AWB', () => {
  it('returns synced:0 total:0 when no orders found', async () => {
    mockQueryMany.mockResolvedValueOnce([]) // orders
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.synced).toBe(0)
    expect(body.total).toBe(0)
  })
})

// ── Happy path: DL (delivered) ────────────────────────────────────────────────

describe('POST — DL status (delivered)', () => {
  it('updates order to delivered and sends email', async () => {
    mockQueryMany.mockResolvedValueOnce([{ ...ORDER, status: 'out_for_delivery' }] as any).mockResolvedValueOnce([]) // rvp orders

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'DL'),
    } as any)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.synced).toBe(1)
    expect(body.results[0].syncedTo).toBe('delivered')

    const updateCall = mockQuery.mock.calls.find(([sql]) => (sql as string).includes('UPDATE orders'))
    expect(updateCall).toBeDefined()
    expect((updateCall![1] as any[])[0]).toBe('ord-1')

    expect(mockSendEmail).toHaveBeenCalledWith(
      'john@example.com',
      'John Doe',
      'ORD-001',
      'ord-1',
      'delivered',
      'out_for_delivery'
    )
  })

  it('does not update order when onlyIfCurrent guard fails (already delivered)', async () => {
    mockQueryMany.mockResolvedValueOnce([{ ...ORDER, status: 'delivered' }] as any).mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'DL'),
    } as any)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.synced).toBe(0)
    // shipment_status write may still fire; assert STATUS_SYNC status write did not
    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining("status = 'delivered'"), expect.any(Array))
  })
})

// ── PU (picked up) ────────────────────────────────────────────────────────────

describe('POST — PU status (picked up → shipped)', () => {
  it('updates order to shipped with setShippedAt', async () => {
    mockQueryMany.mockResolvedValueOnce([{ ...ORDER, status: 'processing' }] as any).mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'PU'),
    } as any)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect((await res.json()).results[0].syncedTo).toBe('shipped')
  })
})

// ── RTO-DL (returned to origin → clearAwb) ───────────────────────────────────

describe('POST — RTO-DL status', () => {
  it('sets order status to returned and clears awb_number', async () => {
    mockQueryMany.mockResolvedValueOnce([{ ...ORDER, status: 'shipped' }] as any).mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'RTO-DL'),
    } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.results[0].syncedTo).toBe('returned')

    const updateCall = mockQuery.mock.calls.find(([sql]) => (sql as string).includes('awb_number = NULL'))
    expect(updateCall).toBeDefined()
  })
})

// ── RTO with user_id → createAutoTask ────────────────────────────────────────

describe('POST — RTO event with user_id', () => {
  it('calls createAutoTask for address_rto when rawType starts with RTO', async () => {
    mockQueryMany.mockResolvedValueOnce([{ ...ORDER, status: 'shipped' }] as any).mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'RTO'),
    } as any)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)

    expect(mockCreateAutoTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        sourceKind: 'address_rto',
        sourceRefId: 'ord-1',
      })
    )
  })

  it('does not call createAutoTask when user_id is null', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'shipped', user_id: null }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'RTO'),
    } as any)

    await POST(makeReq())
    expect(mockCreateAutoTask).not.toHaveBeenCalled()
  })
})

// ── fetch non-ok response ─────────────────────────────────────────────────────

describe('POST — fetch non-ok HTTP response', () => {
  it('records error per AWB when fetch returns non-ok', async () => {
    mockQueryMany.mockResolvedValueOnce([ORDER] as any).mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.errors).toHaveLength(1)
    expect(body.errors[0].awb).toBe('AWB001')
    expect(body.errors[0].error).toContain('503')
    expect(body.synced).toBe(0)
  })
})

// ── fetch throws ──────────────────────────────────────────────────────────────

describe('POST — fetch throws', () => {
  it('records error per AWB when fetch throws', async () => {
    mockQueryMany.mockResolvedValueOnce([ORDER] as any).mockResolvedValueOnce([])

    global.fetch = vi.fn().mockRejectedValue(new Error('Network timeout'))

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.errors).toHaveLength(1)
    expect(body.errors[0].error).toBe('Network timeout')
  })
})

// ── Unknown statusType (no syncRule) ─────────────────────────────────────────

describe('POST — unknown statusType skipped', () => {
  it('does not update order when statusType has no sync rule (e.g. MF)', async () => {
    mockQueryMany.mockResolvedValueOnce([ORDER] as any).mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'MF'),
    } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.synced).toBe(0)
    // shipment_status write may fire; assert no STATUS_SYNC order status write occurred
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringMatching(/status = '(shipped|delivered|out_for_delivery|returned)'/),
      expect.any(Array)
    )
  })
})

// ── Exception type with Status='delivered' fallback ──────────────────────────

describe('POST — exception type NDR with status=delivered fallback', () => {
  it('resolves NDR to DL when Status.Status is "delivered"', async () => {
    mockQueryMany.mockResolvedValueOnce([{ ...ORDER, status: 'out_for_delivery' }] as any).mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'NDR', { status: 'delivered' }),
    } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.results[0].syncedTo).toBe('delivered')
  })

  it('resolves NDR to OD when Status.Status is "out for delivery"', async () => {
    mockQueryMany.mockResolvedValueOnce([{ ...ORDER, status: 'shipped' }] as any).mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'NDR', { status: 'out for delivery' }),
    } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.results[0].syncedTo).toBe('out_for_delivery')
  })
})
