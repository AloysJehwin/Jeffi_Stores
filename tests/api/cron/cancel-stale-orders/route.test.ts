import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockQueryMany = vi.fn()
const mockCancelOrder = vi.fn()

vi.mock('@/lib/shared/db', () => ({ queryMany: mockQueryMany, query: vi.fn().mockResolvedValue({ rows: [] }) }))
vi.mock('@/lib/orders/orders', () => ({ cancelOrder: mockCancelOrder }))

function makeReq(secret = 'test-secret') {
  return new NextRequest('http://localhost/api/cron/cancel-stale-orders', {
    headers: { authorization: 'Bearer ' + secret },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-secret'
  mockQueryMany.mockResolvedValue([])
  mockCancelOrder.mockResolvedValue({ success: true })
})

describe('GET /api/cron/cancel-stale-orders', () => {
  it('returns 401 with wrong secret', async () => {
    const { GET } = await import('@/app/api/(internal)/cron/cancel-stale-orders/route')
    expect((await GET(makeReq('wrong-secret'))).status).toBe(401)
  })

  it('returns 200 with no stale orders', async () => {
    const { GET } = await import('@/app/api/(internal)/cron/cancel-stale-orders/route')
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect((await res.json()).cancelled).toBe(0)
  })

  it('cancels stale orders — reports success + failure', async () => {
    mockQueryMany.mockResolvedValue([
      { id: 'o1', order_number: 'ORD-001', order_type: 'standard' },
      { id: 'o2', order_number: 'ORD-002', order_type: 'direct' },
    ])
    mockCancelOrder.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, reason: 'locked' })
    const { GET } = await import('@/app/api/(internal)/cron/cancel-stale-orders/route')
    const res = await GET(makeReq())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.cancelled).toBe(1)
    expect(body.failed).toBe(1)
  })

  it('returns 500 on unexpected error', async () => {
    mockQueryMany.mockRejectedValue(new Error('db fail'))
    const { GET } = await import('@/app/api/(internal)/cron/cancel-stale-orders/route')
    expect((await GET(makeReq())).status).toBe(500)
  })
})
