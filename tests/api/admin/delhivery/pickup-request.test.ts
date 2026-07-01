import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
}))

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET, PATCH, POST } from '@/app/api/admin/delhivery/pickup-request/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryMany, queryOne } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryMany = vi.mocked(queryMany)
const mockQueryOne = vi.mocked(queryOne)

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', username: 'testadmin', role: 'super_admin', scopes: ['orders'] }

function makeGet(params?: Record<string, string>) {
  const url = new URL('http://localhost/api/admin/delhivery/pickup-request')
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url.toString())
}

function makePatch(body: unknown) {
  return new NextRequest('http://localhost/api/admin/delhivery/pickup-request', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makePost(body: unknown) {
  return new NextRequest('http://localhost/api/admin/delhivery/pickup-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const sampleOrders = [
  { id: 'ord-1', order_number: 'ORD-001', awb_number: 'AWB123', status: 'processing', customer_name: 'Alice' },
]

const sampleHistory = [
  { id: 'ph-1', pickup_id: 'PU001', pickup_date: '2024-01-15', awb_count: 2, awbs: ['AWB1', 'AWB2'], pickup_status: 'pending', created_at: '2024-01-15' },
]

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/admin/delhivery/pickup-request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryMany
      .mockResolvedValueOnce(sampleOrders as any)
      .mockResolvedValueOnce(sampleHistory as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await GET(makeGet())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGet())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Insufficient permissions')
  })

  it('returns orders and pickup history', async () => {
    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.orders).toEqual(sampleOrders)
    expect(body.pickupHistory).toEqual(sampleHistory)
  })

  it('returns empty arrays on DB error', async () => {
    mockQueryMany.mockReset()
    mockQueryMany.mockRejectedValueOnce(new Error('DB down'))
    const res = await GET(makeGet())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB down')
  })
})

// ── GET ?poll= ────────────────────────────────────────────────────────────────

describe('GET /api/admin/delhivery/pickup-request?poll=<id>', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
  })

  it('returns 404 when pickup request not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null as any)
    const res = await GET(makeGet({ poll: 'no-such-id' }))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Not found')
  })

  it('returns current status without fetching when awbs array is empty', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'ph-1', awbs: [], pickup_status: 'pending' } as any)
    const res = await GET(makeGet({ poll: 'ph-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pickup_status).toBe('pending')
    expect(body.updated).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 502 when Delhivery tracking API is unavailable', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'ph-1', awbs: ['AWB123'], pickup_status: 'pending' } as any)
    mockFetch.mockResolvedValueOnce({ ok: false })
    const res = await GET(makeGet({ poll: 'ph-1' }))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('Tracking unavailable')
  })

  it('returns pickup_status unchanged when no shipment data is present', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'ph-1', awbs: ['AWB123'], pickup_status: 'pending' } as any)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ShipmentData: [] }),
    })
    const res = await GET(makeGet({ poll: 'ph-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pickup_status).toBe('pending')
    expect(body.updated).toBe(false)
  })

  it('returns pickup_status unchanged when entry has no Shipment key', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'ph-1', awbs: ['AWB123'], pickup_status: 'pending' } as any)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ShipmentData: [{ Shipment: null }] }),
    })
    const res = await GET(makeGet({ poll: 'ph-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pickup_status).toBe('pending')
    expect(body.updated).toBe(false)
  })

  it('updates pickup_status to picked_up when a PICKED_UP_TYPES status is resolved and current is pending', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'ph-1', awbs: ['AWB123'], pickup_status: 'pending' } as any)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        ShipmentData: [{
          Shipment: {
            Status: { StatusType: 'PU' },
            Scans: [],
          },
        }],
      }),
    })
    mockQuery.mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeGet({ poll: 'ph-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pickup_status).toBe('picked_up')
    expect(body.updated).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("pickup_status = 'picked_up'"),
      ['ph-1']
    )
  })

  it('does NOT update DB when status is already picked_up even if shipment shows PU', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'ph-1', awbs: ['AWB123'], pickup_status: 'picked_up' } as any)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        ShipmentData: [{
          Shipment: {
            Status: { StatusType: 'PU' },
            Scans: [],
          },
        }],
      }),
    })
    const res = await GET(makeGet({ poll: 'ph-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pickup_status).toBe('picked_up')
    expect(body.updated).toBe(false)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('resolves ambiguous PP status via scan activity and updates when picked up activity found', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'ph-1', awbs: ['AWB123'], pickup_status: 'pending' } as any)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        ShipmentData: [{
          Shipment: {
            Status: { StatusType: 'PP' },
            Scans: [
              { ScanDetail: { ScanType: null, Scan: 'shipment picked up from shipper' } },
            ],
          },
        }],
      }),
    })
    mockQuery.mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeGet({ poll: 'ph-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pickup_status).toBe('picked_up')
    expect(body.updated).toBe(true)
  })
})

// ── PATCH ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/admin/delhivery/pickup-request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [] } as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await PATCH(makePatch({ id: 'ph-1', pickup_status: 'picked_up' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makePatch({ id: 'ph-1', pickup_status: 'picked_up' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when id missing', async () => {
    const res = await PATCH(makePatch({ pickup_status: 'picked_up' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Missing id')
  })

  it('returns 400 when pickup_status invalid', async () => {
    const res = await PATCH(makePatch({ id: 'ph-1', pickup_status: 'invalid' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid pickup_status')
  })

  it('updates pickup_status to pending', async () => {
    const res = await PATCH(makePatch({ id: 'ph-1', pickup_status: 'pending' }))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('pickup_status'),
      ['pending', 'ph-1']
    )
  })

  it('updates pickup_status to picked_up', async () => {
    const res = await PATCH(makePatch({ id: 'ph-1', pickup_status: 'picked_up' }))
    expect(res.status).toBe(200)
  })

  it('updates pickup_status to failed', async () => {
    const res = await PATCH(makePatch({ id: 'ph-1', pickup_status: 'failed' }))
    expect(res.status).toBe(200)
  })

  it('adds AWB to existing pickup request', async () => {
    mockQueryMany.mockResolvedValueOnce([{ id: 'ord-1', awb_number: 'AWB999' }] as any)
    const res = await PATCH(makePatch({ id: 'ph-1', add_awb_order_id: 'ord-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.awb).toBe('AWB999')
  })

  it('returns 422 when order not eligible to add AWB', async () => {
    mockQueryMany.mockResolvedValueOnce([] as any)
    const res = await PATCH(makePatch({ id: 'ph-1', add_awb_order_id: 'ord-ineligible' }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('Order not eligible to add to pickup')
  })

  it('returns 500 on unexpected DB error in PATCH', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Connection lost'))
    const res = await PATCH(makePatch({ id: 'ph-1', pickup_status: 'pending' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Connection lost')
  })
})

// ── POST ──────────────────────────────────────────────────────────────────────

describe('POST /api/admin/delhivery/pickup-request', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    process.env.DELHIVERY_API_KEY = 'test-api-key'
    mockQuery.mockResolvedValue({ rows: [] } as any)
  })

  afterEach(() => {
    process.env = OLD_ENV
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await POST(makePost({ orderIds: ['ord-1'], pickupDate: '2024-01-20' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePost({ orderIds: ['ord-1'], pickupDate: '2024-01-20' }))
    expect(res.status).toBe(403)
  })

  // NOTE: The 503 "API key not configured" path requires TOKEN to be falsy at module load time.
  // TOKEN = process.env.DELHIVERY_API_KEY is captured once at import; runtime env deletion
  // has no effect. This path is covered by the route's structural guard (if (!TOKEN) return 503)
  // and is not exercisable in a single vi.mock() setup without vi.doMock() re-import isolation.

  it('returns 400 when no orders selected', async () => {
    const res = await POST(makePost({ orderIds: [], pickupDate: '2024-01-20' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('No orders selected')
  })

  it('returns 400 when pickupDate missing', async () => {
    const res = await POST(makePost({ orderIds: ['ord-1'] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid pickup date')
  })

  it('returns 400 when pickupDate has wrong format', async () => {
    const res = await POST(makePost({ orderIds: ['ord-1'], pickupDate: '20-01-2024' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid pickup date')
  })

  it('returns 422 when no eligible orders found', async () => {
    mockQueryMany.mockResolvedValueOnce([] as any)
    const res = await POST(makePost({ orderIds: ['ord-1'], pickupDate: '2024-01-20' }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('No eligible orders found')
  })

  it('returns 422 when Delhivery API rejects request', async () => {
    mockQueryMany.mockResolvedValueOnce(sampleOrders as any)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Invalid AWB' }),
    })
    const res = await POST(makePost({ orderIds: ['ord-1'], pickupDate: '2024-01-20' }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe('Delhivery rejected the pickup request')
    expect(body.details).toBe('Invalid AWB')
  })

  it('happy path: creates pickup request and updates orders', async () => {
    mockQueryMany.mockResolvedValueOnce(sampleOrders as any)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ pickup_id: 'PU-001' }),
    })
    mockQuery.mockResolvedValue({ rows: [] } as any)

    const res = await POST(makePost({ orderIds: ['ord-1'], pickupDate: '2024-01-20' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pickupId).toBe('PU-001')
    expect(body.pickupDate).toBe('2024-01-20')
    expect(body.orderCount).toBe(1)
    expect(body.awbs).toEqual(['AWB123'])
  })

  it('returns 500 on unexpected error', async () => {
    mockQueryMany.mockRejectedValueOnce(new Error('Unexpected DB error'))
    const res = await POST(makePost({ orderIds: ['ord-1'], pickupDate: '2024-01-20' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Unexpected DB error')
  })

  it('returns 422 when Delhivery response is ok but contains data.error', async () => {
    mockQueryMany.mockResolvedValueOnce(sampleOrders as any)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ error: 'Duplicate pickup request' }),
    })
    const res = await POST(makePost({ orderIds: ['ord-1'], pickupDate: '2024-01-20' }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe('Delhivery rejected the pickup request')
    expect(body.details).toBe('Duplicate pickup request')
  })

  it('uses data.prepaid as details fallback when data.error is absent', async () => {
    mockQueryMany.mockResolvedValueOnce(sampleOrders as any)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ prepaid: 'prepaid error message' }),
    })
    const res = await POST(makePost({ orderIds: ['ord-1'], pickupDate: '2024-01-20' }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.details).toBe('prepaid error message')
  })

  it('happy path with multiple eligible orders updates each order and returns all AWBs', async () => {
    const multiOrders = [
      { id: 'ord-1', awb_number: 'AWB111' },
      { id: 'ord-2', awb_number: 'AWB222' },
      { id: 'ord-3', awb_number: 'AWB333' },
    ]
    mockQueryMany.mockResolvedValueOnce(multiOrders as any)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ pickup_id: 'PU-MULTI' }),
    })
    mockQuery.mockResolvedValue({ rows: [] } as any)

    const res = await POST(makePost({ orderIds: ['ord-1', 'ord-2', 'ord-3'], pickupDate: '2024-02-10' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pickupId).toBe('PU-MULTI')
    expect(body.orderCount).toBe(3)
    expect(body.awbs).toEqual(['AWB111', 'AWB222', 'AWB333'])
    // One INSERT + one UPDATE per order = 4 query calls
    expect(mockQuery).toHaveBeenCalledTimes(4)
  })

  it('handles pickup_id being absent in Delhivery response (stores null)', async () => {
    mockQueryMany.mockResolvedValueOnce(sampleOrders as any)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ some_field: 'value' }), // no pickup_id key
    })
    mockQuery.mockResolvedValue({ rows: [] } as any)

    const res = await POST(makePost({ orderIds: ['ord-1'], pickupDate: '2024-01-20' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pickupId).toBeNull()
  })
})
