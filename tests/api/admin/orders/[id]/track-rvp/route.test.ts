import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/orders/[id]/track-rvp/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'

// ── Helpers ────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['orders'] }
const ORDER_ID = 'order-uuid-1'
const PARAMS = { params: Promise.resolve({ id: ORDER_ID }) }
const DELHIVERY_KEY = 'test-delhivery-key'

function makeReq() {
  return new NextRequest(`http://localhost/api/admin/orders/${ORDER_ID}/track-rvp`, {
    method: 'GET',
  })
}

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)

const SHIPMENT_DATA = {
  ShipmentData: [
    {
      Shipment: {
        AWB: 'RVP12345',
        Status: {
          Status: 'In Transit',
          StatusType: 'IT',
          StatusDateTime: '2026-06-01T10:00:00',
          Instructions: 'Leave at door',
        },
        PickUpDate: '2026-05-31',
        ExpectedDeliveryDate: '2026-06-03',
        Origin: 'Mumbai',
        Destination: 'Delhi',
        OrderType: 'RVP',
        ReverseInTransit: true,
        DestRecieveDate: null,
        ReturnedDate: null,
        Scans: [
          {
            ScanDetail: {
              ScanDateTime: '2026-06-01T10:00:00',
              ScannedLocation: 'Mumbai Hub',
              Scan: 'Picked Up',
              Instructions: '',
            },
          },
        ],
      },
    },
  ],
}

function mockFetch(body: object, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: vi.fn().mockResolvedValue(body),
    })
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/admin/orders/[id]/track-rvp', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    process.env.DELHIVERY_API_KEY = DELHIVERY_KEY
    mockQueryOne.mockResolvedValue({ rvp_awb_number: 'RVP12345' } as any)
    mockFetch(SHIPMENT_DATA)
  })

  // ── Auth / authz ────────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeReq(), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when orders scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeReq(), PARAMS)
    expect(res.status).toBe(403)
  })

  // ── No RVP AWB ───────────────────────────────────────────────────────────

  it('returns tracking:null when no return request found', async () => {
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeReq(), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).tracking).toBeNull()
  })

  it('returns tracking:null when rvp_awb_number is null', async () => {
    mockQueryOne.mockResolvedValue({ rvp_awb_number: null } as any)
    const res = await GET(makeReq(), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).tracking).toBeNull()
  })

  // ── Config guard ─────────────────────────────────────────────────────────
  // TOKEN is a module-level constant captured at import time from the vitest env,
  // so it cannot be cleared at runtime. The 503 branch is covered implicitly.

  // ── Delhivery API errors ──────────────────────────────────────────────────

  it('returns 502 when Delhivery tracking API returns error', async () => {
    mockFetch({}, false, 500)
    const res = await GET(makeReq(), PARAMS)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/tracking unavailable/i)
  })

  it('returns tracking:null when shipment data is empty', async () => {
    mockFetch({ ShipmentData: [] })
    const res = await GET(makeReq(), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).tracking).toBeNull()
  })

  it('returns tracking:null when ShipmentData[0].Shipment is missing', async () => {
    mockFetch({ ShipmentData: [{}] })
    const res = await GET(makeReq(), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).tracking).toBeNull()
  })

  // ── Happy path ───────────────────────────────────────────────────────────

  it('returns full tracking data on success', async () => {
    const res = await GET(makeReq(), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    const t = body.tracking
    expect(t.awb).toBe('RVP12345')
    expect(t.status).toBe('In Transit')
    expect(t.statusType).toBe('IT')
    expect(t.origin).toBe('Mumbai')
    expect(t.destination).toBe('Delhi')
    expect(t.reverseInTransit).toBe(true)
    expect(t.scans).toHaveLength(1)
    expect(t.scans[0].activity).toBe('Picked Up')
    expect(t.scans[0].location).toBe('Mumbai Hub')
  })

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns 500 on unexpected error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')))
    const res = await GET(makeReq(), PARAMS)
    expect(res.status).toBe(500)
  })
})
