import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateUser: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
}))

import { GET } from '@/app/api/orders/[id]/track-rvp/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'

const USER = { userId: 'user-1' }
const PARAMS = { params: Promise.resolve({ id: 'order-123' }) }

const MOCK_SHIPMENT_DATA = {
  ShipmentData: [
    {
      Shipment: {
        AWB: 'RVP123456',
        Status: {
          Status: 'Transit',
          StatusType: 'UD',
          StatusDateTime: '2024-01-10T10:00:00',
          Instructions: '',
        },
        PickUpDate: '2024-01-08',
        ExpectedDeliveryDate: '2024-01-12',
        Origin: 'Delhi',
        Destination: 'Mumbai',
        OrderType: 'RETURN',
        ReverseInTransit: true,
        DestRecieveDate: null,
        ReturnedDate: null,
        Scans: [],
      },
    },
  ],
}

function makeRequest() {
  return new Request('http://localhost/api/orders/order-123/track-rvp', { method: 'GET' })
}

describe('GET /api/orders/[id]/track-rvp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(null)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns tracking null when no return request found', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tracking).toBeNull()
  })

  it('returns tracking null when no rvp_awb_number', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ rvp_awb_number: null })
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tracking).toBeNull()
  })

  it('returns 500 when fetch throws (network error)', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ rvp_awb_number: 'RVP123456' })

    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'))

    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(500)
  })

  it('returns tracking data on success', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ rvp_awb_number: 'RVP123456' })

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(MOCK_SHIPMENT_DATA),
    } as any)

    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tracking).toBeDefined()
    expect(body.tracking.awb).toBe('RVP123456')
    expect(body.tracking.orderType).toBe('RETURN')
    expect(body.tracking.reverseInTransit).toBe(true)
  })

  it('returns 502 when Delhivery API returns error', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ rvp_awb_number: 'RVP123456' })

    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false } as any)

    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(502)
  })

  it('returns tracking null when API returns empty shipment data', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ rvp_awb_number: 'RVP123456' })

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
    vi.mocked(jwt.authenticateUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockRejectedValue(new Error('DB error'))
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(500)
  })
})
