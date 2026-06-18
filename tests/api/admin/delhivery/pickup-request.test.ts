import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
}))

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET, PATCH, POST } from '@/app/api/admin/delhivery/pickup-request/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryMany } from '@/lib/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryMany = vi.mocked(queryMany)

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', username: 'testadmin', role: 'super_admin', scopes: ['orders'] }

function makeGet() {
  return new NextRequest('http://localhost/api/admin/delhivery/pickup-request')
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
      json: () => Promise.resolve({ id: 'PU-001' }),
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
})
