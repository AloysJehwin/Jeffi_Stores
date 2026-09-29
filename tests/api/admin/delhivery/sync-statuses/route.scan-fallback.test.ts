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
  id: 'ord-1', awb_number: 'AWB001', status: 'shipped',
  order_number: 'ORD-001', customer_name: 'John Doe',
  customer_email: 'john@example.com', user_id: 'user-1',
  delhivery_quoted_weight_kg: 1, delhivery_charged_weight_kg: null,
}

function makeShipmentData(awb: string, statusType: string, extra: Record<string, any> = {}) {
  return {
    ShipmentData: [{
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
    }],
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

// ── Exception type scan fallback ──────────────────────────────────────────────

describe('POST — exception type scan fallback', () => {
  it('resolves UD via scan ScanType fallback to known type', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'processing' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'UD', {
        status: '',
        scans: [
          { ScanDetail: { ScanType: 'PU', Scan: 'picked up' } },
        ],
      }),
    } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.results[0].syncedTo).toBe('shipped')
  })

  it('resolves UD via scan activity "out for delivery"', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'shipped' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'UD', {
        status: '',
        scans: [
          { ScanDetail: { ScanType: 'UD', Scan: 'out for delivery attempt' } },
        ],
      }),
    } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.results[0].syncedTo).toBe('out_for_delivery')
  })

  it('resolves HOLD via scan activity "rto delivered" to RTO-DL', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'shipped' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'HOLD', {
        status: '',
        scans: [
          { ScanDetail: { ScanType: 'HOLD', Scan: 'rto delivered to origin' } },
        ],
      }),
    } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.results[0].syncedTo).toBe('returned')
  })

  it('resolves LOST via scan activity "out for return" to RTO-OT', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'shipped' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'LOST', {
        status: '',
        scans: [
          { ScanDetail: { ScanType: 'LOST', Scan: 'out for return to sender' } },
        ],
      }),
    } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.results[0].syncedTo).toBe('out_for_delivery')
  })

  it('resolves MIS via scan activity "return in transit" to RTO-IT', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'shipped' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'MIS', {
        status: '',
        scans: [
          { ScanDetail: { ScanType: 'MIS', Scan: 'return in transit to hub' } },
        ],
      }),
    } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.results[0].syncedTo).toBe('shipped')
  })

  it('resolves UD via scan activity "rto initiated" to RTO', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'shipped' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'UD', {
        status: '',
        scans: [
          { ScanDetail: { ScanType: 'UD', Scan: 'rto initiated at facility' } },
        ],
      }),
    } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.results[0].syncedTo).toBe('shipped')
  })

  it('resolves UD via scan activity "in transit" to IT', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'processing' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'UD', {
        status: '',
        scans: [
          { ScanDetail: { ScanType: 'UD', Scan: 'in transit to destination' } },
        ],
      }),
    } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.results[0].syncedTo).toBe('shipped')
  })

  it('resolves UD via scan activity "picked up" to PU', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'processing' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'UD', {
        status: '',
        scans: [
          { ScanDetail: { ScanType: 'UD', Scan: 'picked up from sender' } },
        ],
      }),
    } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.results[0].syncedTo).toBe('shipped')
  })

  it('resolves UD via scan activity "manifested" to MF (no syncRule → skip)', async () => {
    mockQueryMany
      .mockResolvedValueOnce([ORDER] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'UD', {
        status: '',
        scans: [
          { ScanDetail: { ScanType: 'UD', Scan: 'manifested at origin' } },
        ],
      }),
    } as any)

    const res = await POST(makeReq())
    // MF has no syncRule → synced = 0
    expect((await res.json()).synced).toBe(0)
  })

  it('resolves UD via scan activity "delivered" to DL', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'out_for_delivery' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'UD', {
        status: '',
        scans: [
          { ScanDetail: { ScanType: 'UD', Scan: 'delivered to consignee' } },
        ],
      }),
    } as any)

    const res = await POST(makeReq())
    expect((await res.json()).results[0].syncedTo).toBe('delivered')
  })
})

// ── No email sent when customer_email absent ──────────────────────────────────

describe('POST — no email when customer info absent', () => {
  it('skips sendOrderStatusUpdate when customer_email is empty', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'out_for_delivery', customer_email: '' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'DL'),
    } as any)

    await POST(makeReq())
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

// ── Shipment entry with no Shipment object ────────────────────────────────────

describe('POST — malformed ShipmentData entries', () => {
  it('skips entry with no Shipment property', async () => {
    mockQueryMany
      .mockResolvedValueOnce([ORDER] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ShipmentData: [{ Shipment: null }, {}] }),
    } as any)

    const res = await POST(makeReq())
    expect((await res.json()).synced).toBe(0)
  })

  it('skips entry when AWB does not match any order in batch', async () => {
    mockQueryMany
      .mockResolvedValueOnce([ORDER] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('UNKNOWN_AWB', 'DL'),
    } as any)

    const res = await POST(makeReq())
    expect((await res.json()).synced).toBe(0)
  })

  it('handles empty ShipmentData array', async () => {
    mockQueryMany
      .mockResolvedValueOnce([ORDER] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ShipmentData: [] }),
    } as any)

    const res = await POST(makeReq())
    expect((await res.json()).synced).toBe(0)
  })
})

// ── statusDateTime absent path (no $2 param) ─────────────────────────────────

describe('POST — statusDateTime absent', () => {
  it('handles DL with no statusDateTime by using NOW()', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'out_for_delivery' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ShipmentData: [{
          Shipment: {
            AWB: 'AWB001',
            Status: { StatusType: 'DL', Status: '', StatusDateTime: null },
            Scans: [],
            DestRecieveDate: null,
            ReturnedDate: null,
          },
        }],
      }),
    } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.synced).toBe(1)
    const updateSql = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes('delivered_at')
    )
    expect((updateSql![0] as string)).toContain('delivered_at = NOW()')
  })
})
