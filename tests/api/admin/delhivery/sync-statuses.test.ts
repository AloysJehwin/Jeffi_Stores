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
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/delhivery/sync-statuses/route'
import { query, queryMany } from '@/lib/db'
import { sendOrderStatusUpdate } from '@/lib/email'
import { createAutoTask, completeAutoTask } from '@/lib/auto-tasks'
import { restoreOrderStock } from '@/lib/order-stock'
import { sendOrderDeliveredSMS, sendOutForDeliverySMS } from '@/lib/sms'
import { fetchDelhiveryInvoiceCharges } from '@/lib/delhivery'

const mockQuery = vi.mocked(query)
const mockQueryMany = vi.mocked(queryMany)
const mockSendEmail = vi.mocked(sendOrderStatusUpdate)
const mockCreateAutoTask = vi.mocked(createAutoTask)
const mockCompleteAutoTask = vi.mocked(completeAutoTask)
const mockRestoreStock = vi.mocked(restoreOrderStock)
const mockDeliveredSMS = vi.mocked(sendOrderDeliveredSMS)
const mockOfdSMS = vi.mocked(sendOutForDeliverySMS)
const mockInvoiceCharges = vi.mocked(fetchDelhiveryInvoiceCharges)

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
})

afterEach(() => {
  // CRON_SECRET and DELHIVERY_API_KEY are captured as module-level constants at
  // import time; env mutation here has no effect on the route handler.
})

// ── Auth / config guards ──────────────────────────────────────────────────────
// NOTE: DELHIVERY_TOKEN and CRON_SECRET are captured at module load time as
// module-level constants, so env mutations in beforeEach/afterEach have no
// effect on the already-imported module. The 503 path requires a fresh module
// import via vi.isolateModules() with DELHIVERY_API_KEY absent.

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

  it('returns 503 when DELHIVERY_API_KEY not configured (isolated module)', async () => {
    // Save and clear the key so the freshly-imported module sees it as undefined
    const saved = process.env.DELHIVERY_API_KEY
    delete process.env.DELHIVERY_API_KEY

    vi.resetModules()
    const { POST: freshPost } = await import('@/app/api/admin/delhivery/sync-statuses/route')

    // Restore before assertions so other tests are unaffected
    process.env.DELHIVERY_API_KEY = saved

    const res = await freshPost(makeReq())
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/not configured/)
  })
})

// ── No orders ─────────────────────────────────────────────────────────────────

describe('POST — no orders with AWB', () => {
  it('returns synced:0 total:0 when no orders found', async () => {
    mockQueryMany.mockResolvedValueOnce([])   // orders
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
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'out_for_delivery' }] as any)
      .mockResolvedValueOnce([])   // rvp orders

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'DL'),
    } as any)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.synced).toBe(1)
    expect(body.results[0].syncedTo).toBe('delivered')

    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes('UPDATE orders')
    )
    expect(updateCall).toBeDefined()
    expect((updateCall![1] as any[])[0]).toBe('ord-1')

    expect(mockSendEmail).toHaveBeenCalledWith(
      'john@example.com', 'John Doe', 'ORD-001', 'ord-1', 'delivered', 'out_for_delivery'
    )
  })

  it('does not update order when onlyIfCurrent guard fails (already delivered)', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'delivered' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'DL'),
    } as any)

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.synced).toBe(0)
    // shipment_status write may still fire; assert STATUS_SYNC status write did not
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("status = 'delivered'"), expect.any(Array)
    )
  })
})

// ── PU (picked up) ────────────────────────────────────────────────────────────

describe('POST — PU status (picked up → shipped)', () => {
  it('updates order to shipped with setShippedAt', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'processing' }] as any)
      .mockResolvedValueOnce([])

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
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'shipped' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'RTO-DL'),
    } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.results[0].syncedTo).toBe('returned')

    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes('awb_number = NULL')
    )
    expect(updateCall).toBeDefined()
  })
})

// ── RTO with user_id → createAutoTask ────────────────────────────────────────

describe('POST — RTO event with user_id', () => {
  it('calls createAutoTask for address_rto when rawType starts with RTO', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'shipped' }] as any)
      .mockResolvedValueOnce([])

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
    mockQueryMany
      .mockResolvedValueOnce([ORDER] as any)
      .mockResolvedValueOnce([])

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
    mockQueryMany
      .mockResolvedValueOnce([ORDER] as any)
      .mockResolvedValueOnce([])

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
    mockQueryMany
      .mockResolvedValueOnce([ORDER] as any)
      .mockResolvedValueOnce([])

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
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'out_for_delivery' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'NDR', { status: 'delivered' }),
    } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.results[0].syncedTo).toBe('delivered')
  })

  it('resolves NDR to OD when Status.Status is "out for delivery"', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'shipped' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'NDR', { status: 'out for delivery' }),
    } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.results[0].syncedTo).toBe('out_for_delivery')
  })
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

// ── RVP loop ──────────────────────────────────────────────────────────────────

const RVP = {
  id: 'rr-1', rvp_awb_number: 'RVP001',
  order_id: 'ord-1', user_id: 'user-1', order_number: 'ORD-001',
}

describe('POST — RVP return request loop', () => {
  it('marks received_at when destReceiveDate is set', async () => {
    mockQueryMany
      .mockResolvedValueOnce([])        // orders — so we skip order loop
      // orders loop returns early with synced:0 total:0 before rvp... need orders > 0
      // Actually when orders.length === 0 the route returns early.
      // We need at least one order to get past the early return:
    // Re-design: provide one order that won't sync, then RVP data
    mockQueryMany.mockReset()
    mockQueryMany
      .mockResolvedValueOnce([ORDER] as any)           // orders (will get no matching shipment → synced=0)
      .mockResolvedValueOnce([RVP] as any)              // rvp requests

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ShipmentData: [] }),       // orders fetch → nothing synced
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ShipmentData: [{
            Shipment: {
              AWB: 'RVP001',
              Status: { StatusType: 'DL', Status: 'delivered', StatusDateTime: '2024-06-10T10:00:00' },
              Scans: [],
              DestRecieveDate: '2024-06-10',
              ReturnedDate: null,
            },
          }],
        }),
      } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.rvp.received).toBe(1)

    const rvpUpdate = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes('UPDATE return_requests')
    )
    expect(rvpUpdate).toBeDefined()
    expect((rvpUpdate![1] as any[])[0]).toBe('rr-1')
    expect((rvpUpdate![1] as any[])[1]).toBe('2024-06-10')

    expect(mockCompleteAutoTask).toHaveBeenCalledWith('schedule_pickup', 'ord-1')
    expect(mockCreateAutoTask).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKind: 'inspect_refund', userId: 'user-1' })
    )
  })

  it('marks received when ReturnedDate is set (destReceiveDate null)', async () => {
    mockQueryMany
      .mockResolvedValueOnce([ORDER] as any)
      .mockResolvedValueOnce([RVP] as any)

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ShipmentData: [{
            Shipment: {
              AWB: 'RVP001',
              Status: { StatusType: 'DL', Status: '', StatusDateTime: null },
              Scans: [],
              DestRecieveDate: null,
              ReturnedDate: '2024-06-11',
            },
          }],
        }),
      } as any)

    const res = await POST(makeReq())
    expect((await res.json()).rvp.received).toBe(1)
    const rvpUpdate = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes('UPDATE return_requests')
    )
    expect((rvpUpdate![1] as any[])[1]).toBe('2024-06-11')
  })

  it('marks received when statusLabel is "delivered" (both date fields null)', async () => {
    mockQueryMany
      .mockResolvedValueOnce([ORDER] as any)
      .mockResolvedValueOnce([RVP] as any)

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ShipmentData: [{
            Shipment: {
              AWB: 'RVP001',
              Status: { StatusType: 'DL', Status: 'delivered', StatusDateTime: '2024-06-12T09:00:00' },
              Scans: [],
              DestRecieveDate: null,
              ReturnedDate: null,
            },
          }],
        }),
      } as any)

    const res = await POST(makeReq())
    expect((await res.json()).rvp.received).toBe(1)
  })

  it('skips RVP entry not yet received at warehouse', async () => {
    mockQueryMany
      .mockResolvedValueOnce([ORDER] as any)
      .mockResolvedValueOnce([RVP] as any)

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ShipmentData: [{
            Shipment: {
              AWB: 'RVP001',
              Status: { StatusType: 'IT', Status: 'in transit', StatusDateTime: null },
              Scans: [],
              DestRecieveDate: null,
              ReturnedDate: null,
            },
          }],
        }),
      } as any)

    const res = await POST(makeReq())
    expect((await res.json()).rvp.received).toBe(0)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('does not call completeAutoTask when user_id is null', async () => {
    mockQueryMany
      .mockResolvedValueOnce([ORDER] as any)
      .mockResolvedValueOnce([{ ...RVP, user_id: null }] as any)

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ShipmentData: [{
            Shipment: {
              AWB: 'RVP001',
              Status: { StatusType: 'DL', Status: 'delivered', StatusDateTime: null },
              Scans: [],
              DestRecieveDate: '2024-06-10',
              ReturnedDate: null,
            },
          }],
        }),
      } as any)

    const res = await POST(makeReq())
    expect((await res.json()).rvp.received).toBe(1)
    expect(mockCompleteAutoTask).not.toHaveBeenCalled()
    expect(mockCreateAutoTask).not.toHaveBeenCalled()
  })

  it('records rvp error when RVP fetch returns non-ok', async () => {
    mockQueryMany
      .mockResolvedValueOnce([ORDER] as any)
      .mockResolvedValueOnce([RVP] as any)

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) } as any)

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.rvp.errors).toHaveLength(1)
    expect(body.rvp.errors[0].awb).toBe('RVP001')
  })

  it('records rvp error when RVP fetch throws', async () => {
    mockQueryMany
      .mockResolvedValueOnce([ORDER] as any)
      .mockResolvedValueOnce([RVP] as any)

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockRejectedValueOnce(new Error('RVP network error'))

    const res = await POST(makeReq())
    const body = await res.json()
    expect(body.rvp.errors).toHaveLength(1)
    expect(body.rvp.errors[0].error).toBe('RVP network error')
  })

  it('skips RVP entry when AWB does not match any return request', async () => {
    mockQueryMany
      .mockResolvedValueOnce([ORDER] as any)
      .mockResolvedValueOnce([RVP] as any)

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ShipmentData: [] }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeShipmentData('DIFFERENT_AWB', 'DL', { destReceiveDate: '2024-06-10' }),
      } as any)

    const res = await POST(makeReq())
    expect((await res.json()).rvp.received).toBe(0)
  })

  it('handles rvpRequests queryMany failure gracefully (returns [])', async () => {
    mockQueryMany
      .mockResolvedValueOnce([ORDER] as any)
      .mockRejectedValueOnce(new Error('RVP query failed'))  // rvp queryMany throws → caught → []

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
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'shipped' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'OT'),
    } as any)

    expect((await (await POST(makeReq())).json()).results[0].syncedTo).toBe('out_for_delivery')
  })

  it('syncs OD to out_for_delivery', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'shipped' }] as any)
      .mockResolvedValueOnce([])

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
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'confirmed' }] as any)
      .mockResolvedValueOnce([])

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
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'shipped' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'RTO-IT'),
    } as any)

    const body = await (await POST(makeReq())).json()
    expect(body.results[0].syncedTo).toBe('shipped')
    expect(mockCreateAutoTask).toHaveBeenCalled()
  })
})

// ── EDD + charged-weight + billing side-effects ──────────────────────────────

describe('POST — EDD, charged weight and delivery billing', () => {
  it('updates estimated_delivery_date when Delhivery returns an EDD', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'processing' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'IT', {
        shipmentExtra: { ExpectedDeliveryDate: '2024-06-15' },
      }),
    } as any)

    await POST(makeReq())
    const eddUpdate = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes('estimated_delivery_date')
    )
    expect(eddUpdate).toBeDefined()
  })

  it('computes delhivery_extra_charge when charged weight exceeds quoted weight', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{
        ...ORDER, status: 'shipped',
        shipping_amount: 100, delhivery_quoted_weight_kg: 1,
        delhivery_charged_weight_kg: null,
      }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'IT', {
        shipmentExtra: { ChargedWeight: 2 },
      }),
    } as any)

    await POST(makeReq())
    const wtUpdate = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes('delhivery_charged_weight_kg = $2')
    )
    expect(wtUpdate).toBeDefined()
    // extra = ((2/1)-1)*100 = 100
    expect((wtUpdate![1] as any[])[2]).toBe(100)
  })

  it('leaves extra charge null when charged weight not above quoted', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{
        ...ORDER, status: 'shipped',
        shipping_amount: 100, delhivery_quoted_weight_kg: 5,
        delhivery_charged_weight_kg: null,
      }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'IT', {
        shipmentExtra: { ChargedWeight: 2 },
      }),
    } as any)

    await POST(makeReq())
    const wtUpdate = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes('delhivery_charged_weight_kg = $2')
    )
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
    const codUpdate = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes('cod_collected')
    )
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
    expect(mockInvoiceCharges).toHaveBeenCalledWith('AWB001')
    const billUpdate = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes('delhivery_billed_amount')
    )
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
    const billUpdate = mockQuery.mock.calls.find(([sql]) =>
      (sql as string).includes('delhivery_billed_amount')
    )
    expect(billUpdate).toBeUndefined()
  })
})

// ── SMS notifications ─────────────────────────────────────────────────────────

describe('POST — SMS notifications', () => {
  it('sends delivered SMS when notification_channel is sms on delivery', async () => {
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'out_for_delivery', notification_channel: 'sms', phone: '9876543210' }] as any)
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
      .mockResolvedValueOnce([{ ...ORDER, status: 'out_for_delivery', notification_channel: 'email', phone: '9876543210' }] as any)
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
    mockQueryMany
      .mockResolvedValueOnce([{ ...ORDER, status: 'shipped' }] as any)
      .mockResolvedValueOnce([])

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeShipmentData('AWB001', 'RTO-DL'),
    } as any)

    await POST(makeReq())
    expect(mockRestoreStock).toHaveBeenCalledWith('ord-1')
  })
})
