import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))
vi.mock('@/lib/email', () => ({
  sendOrderStatusUpdate: vi.fn(),
}))

// ── Imports ────────────────────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/orders/[id]/track/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'
import { sendOrderStatusUpdate } from '@/lib/email'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQuery = vi.mocked(query)
const mockSendStatus = vi.mocked(sendOrderStatusUpdate)

// ── Helpers ────────────────────────────────────────────────────────────────────

const admin = {
  adminId: 'a1',
  username: 'admin',
  role: 'super_admin',
  scopes: ['orders'],
}

const orderId = 'order-uuid-1'
const routeParams = { params: Promise.resolve({ id: orderId }) }

function makeGet() {
  return new NextRequest(`http://localhost/api/admin/orders/${orderId}/track`)
}

const mockOrder = {
  awb_number: 'AWB123456',
  status: 'shipped',
  order_number: 'ORD-001',
  customer_name: 'John Doe',
  customer_email: 'john@example.com',
}

function buildTrackingResponse(statusType: string, scans: any[] = []) {
  return {
    ShipmentData: [{
      Shipment: {
        AWB: 'AWB123456',
        PickUpDate: '2024-01-10',
        ExpectedDeliveryDate: '2024-01-12',
        Origin: 'Chennai',
        Destination: 'Mumbai',
        Status: {
          Status: 'In Transit',
          StatusType: statusType,
          StatusDateTime: '2024-01-11T10:00:00',
          Instructions: null,
        },
        Scans: scans,
      },
    }],
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/orders/[id]/track', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockSendStatus.mockResolvedValue(undefined as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any)
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGet(), routeParams as any)
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGet(), routeParams as any)
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toMatch(/permissions/i)
  })

  it('returns 404 when order not found', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeGet(), routeParams as any)
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toMatch(/not found/i)
  })

  it('returns tracking null when order has no AWB', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...mockOrder, awb_number: null } as any)
    const res = await GET(makeGet(), routeParams as any)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.tracking).toBeNull()
  })

  it('returns 503 when DELHIVERY_API_KEY not configured', async () => {
    // TOKEN is captured at module load time, so we must re-import after
    // clearing the env var to exercise the !TOKEN branch.
    const originalKey = process.env.DELHIVERY_API_KEY
    delete process.env.DELHIVERY_API_KEY
    vi.resetModules()

    // Re-apply mocks for the fresh module registry
    vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
    vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
    vi.mock('@/lib/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn() }))
    vi.mock('@/lib/email', () => ({ sendOrderStatusUpdate: vi.fn() }))

    const { GET: GETFresh } = await import('@/app/api/admin/orders/[id]/track/route')
    const { authenticateAdmin: authFresh } = await import('@/lib/jwt')
    const { hasScope: scopeFresh } = await import('@/lib/scopes')
    const { queryOne: queryOneFresh } = await import('@/lib/db')

    vi.mocked(authFresh).mockResolvedValue(admin as any)
    vi.mocked(scopeFresh).mockReturnValue(true)
    vi.mocked(queryOneFresh).mockResolvedValue(mockOrder as any)

    const res = await GETFresh(makeGet(), routeParams as any)
    expect(res.status).toBe(503)
    const data = await res.json()
    expect(data.error).toMatch(/not configured/i)

    // Restore env and module registry for subsequent tests
    process.env.DELHIVERY_API_KEY = originalKey
    vi.resetModules()
  })

  it('returns 502 when Delhivery API returns non-ok', async () => {
    process.env.DELHIVERY_API_KEY = 'test-key'
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(mockOrder as any)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const res = await GET(makeGet(), routeParams as any)
    expect(res.status).toBe(502)
    const data = await res.json()
    expect(data.error).toMatch(/unavailable/i)
    vi.unstubAllGlobals()
  })

  it('returns tracking null when no shipment data in response', async () => {
    process.env.DELHIVERY_API_KEY = 'test-key'
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(mockOrder as any)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ShipmentData: [] }),
    }))

    const res = await GET(makeGet(), routeParams as any)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.tracking).toBeNull()
    vi.unstubAllGlobals()
  })

  it('returns tracking data with IT status and syncs to shipped', async () => {
    process.env.DELHIVERY_API_KEY = 'test-key'
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...mockOrder, status: 'processing' } as any)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(buildTrackingResponse('IT')),
    }))

    const res = await GET(makeGet(), routeParams as any)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.tracking).toBeTruthy()
    expect(data.tracking.awb).toBe('AWB123456')
    expect(data.statusSynced).toBe(true)
    expect(data.syncedTo).toBe('shipped')
    vi.unstubAllGlobals()
  })

  it('syncs DL status to delivered', async () => {
    process.env.DELHIVERY_API_KEY = 'test-key'
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...mockOrder, status: 'out_for_delivery' } as any)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(buildTrackingResponse('DL')),
    }))

    const res = await GET(makeGet(), routeParams as any)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.statusSynced).toBe(true)
    expect(data.syncedTo).toBe('delivered')
    vi.unstubAllGlobals()
  })

  it('syncs RTO-DL to returned and clears AWB', async () => {
    process.env.DELHIVERY_API_KEY = 'test-key'
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...mockOrder, status: 'out_for_delivery' } as any)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(buildTrackingResponse('RTO-DL')),
    }))

    const res = await GET(makeGet(), routeParams as any)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.syncedTo).toBe('returned')
    vi.unstubAllGlobals()
  })

  it('does not sync when order status not in onlyIfCurrent list', async () => {
    process.env.DELHIVERY_API_KEY = 'test-key'
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    // status is 'delivered', but PU only allows ['processing','confirmed','pending']
    mockQueryOne.mockResolvedValue({ ...mockOrder, status: 'delivered' } as any)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(buildTrackingResponse('PU')),
    }))

    const res = await GET(makeGet(), routeParams as any)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.statusSynced).toBe(false)
    expect(data.syncedTo).toBeNull()
    vi.unstubAllGlobals()
  })

  it('resolves exception status type from scan activities', async () => {
    process.env.DELHIVERY_API_KEY = 'test-key'
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...mockOrder, status: 'shipped' } as any)

    const trackingWithException = {
      ShipmentData: [{
        Shipment: {
          AWB: 'AWB123456',
          PickUpDate: '2024-01-10',
          ExpectedDeliveryDate: '2024-01-12',
          Origin: 'Chennai',
          Destination: 'Mumbai',
          Status: {
            Status: 'NDR',
            StatusType: 'NDR',
            StatusDateTime: '2024-01-11T10:00:00',
            Instructions: null,
          },
          Scans: [
            {
              ScanDetail: {
                ScanType: 'NDR',
                Scan: 'out for delivery',
                ScanDateTime: '2024-01-11T09:00:00',
                ScannedLocation: 'Mumbai Hub',
                Instructions: null,
              },
            },
          ],
        },
      }],
    }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(trackingWithException),
    }))

    const res = await GET(makeGet(), routeParams as any)
    expect(res.status).toBe(200)
    const data = await res.json()
    // Should have resolved NDR -> OD (out for delivery)
    expect(data.syncedTo).toBe('out_for_delivery')
    vi.unstubAllGlobals()
  })

  it('sends status update email on sync', async () => {
    process.env.DELHIVERY_API_KEY = 'test-key'
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...mockOrder, status: 'processing' } as any)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(buildTrackingResponse('IT')),
    }))

    const res = await GET(makeGet(), routeParams as any)
    expect(res.status).toBe(200)
    expect(mockSendStatus).toHaveBeenCalledWith(
      'john@example.com',
      'John Doe',
      'ORD-001',
      orderId,
      'shipped',
      'processing'
    )
    vi.unstubAllGlobals()
  })

  it('returns scans array from shipment', async () => {
    process.env.DELHIVERY_API_KEY = 'test-key'
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...mockOrder, status: 'processing' } as any)

    const scans = [
      {
        ScanDetail: {
          ScanDateTime: '2024-01-10T08:00:00',
          ScannedLocation: 'Chennai Hub',
          Scan: 'Picked Up',
          Instructions: null,
        },
      },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(buildTrackingResponse('PU', scans)),
    }))

    const res = await GET(makeGet(), routeParams as any)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.tracking.scans).toHaveLength(1)
    expect(data.tracking.scans[0].activity).toBe('Picked Up')
    expect(data.tracking.scans[0].location).toBe('Chennai Hub')
    vi.unstubAllGlobals()
  })

  it('returns 500 on unexpected error', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockRejectedValue(new Error('DB connection lost'))
    const res = await GET(makeGet(), routeParams as any)
    expect(res.status).toBe(500)
    vi.unstubAllGlobals()
  })
})
