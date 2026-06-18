import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
}))

import { GET } from '@/app/api/orders/[id]/track/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'

const USER = { userId: 'user-1' }
const PARAMS = { params: { id: 'order-123' } }

const MOCK_SHIPMENT_DATA = {
  ShipmentData: [
    {
      Shipment: {
        AWB: 'AWB123456',
        Status: {
          Status: 'Transit',
          StatusType: 'UD',
          StatusDateTime: '2024-01-10T10:00:00',
          Instructions: '',
        },
        PickUpDate: '2024-01-08',
        ExpectedDeliveryDate: '2024-01-12',
        Origin: 'Mumbai',
        Destination: 'Delhi',
        Scans: [
          {
            ScanDetail: {
              ScanDateTime: '2024-01-10T10:00:00',
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

function makeRequest() {
  return new Request('http://localhost/api/orders/order-123/track', { method: 'GET' })
}

describe('GET /api/orders/[id]/track', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 404 when order not found', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns tracking null when no AWB number', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ awb_number: null, status: 'pending' })
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tracking).toBeNull()
  })

  it('returns 500 when fetch throws (network error)', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ awb_number: 'AWB123456', status: 'shipped' })

    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'))

    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(500)
  })

  it('returns tracking data on success', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ awb_number: 'AWB123456', status: 'shipped' })

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(MOCK_SHIPMENT_DATA),
    } as any)

    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tracking).toBeDefined()
    expect(body.tracking.awb).toBe('AWB123456')
    expect(body.tracking.status).toBe('Transit')
    expect(body.tracking.scans).toHaveLength(1)
  })

  it('returns 502 when Delhivery API returns error', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ awb_number: 'AWB123456', status: 'shipped' })

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
    } as any)

    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(502)
  })

  it('returns tracking null when no shipment data in response', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ awb_number: 'AWB123456', status: 'shipped' })

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ ShipmentData: [] }),
    } as any)

    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tracking).toBeNull()
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockRejectedValue(new Error('DB error'))
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(500)
  })
})
