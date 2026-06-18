import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn().mockResolvedValue(null),
  queryMany: vi.fn().mockResolvedValue([]),
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  withTransaction: vi.fn().mockImplementation(async (fn: any) =>
    fn({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) })
  ),
}))

vi.mock('@/lib/orders', () => ({
  cancelOrder: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/customer-health', () => ({
  recomputeHealth: vi.fn().mockResolvedValue(null),
  getHealth: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/auto-tasks', () => ({
  createAutoTask: vi.fn().mockResolvedValue(null),
  completeAutoTask: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------

import { GET as cancelStaleGET } from '@/app/api/cron/cancel-stale-orders/route'
import { GET as computeHealthGET } from '@/app/api/cron/compute-health/route'

const CRON_SECRET = 'super-secret-cron-token'

function makeRequest(path: string, authHeader?: string) {
  const headers: Record<string, string> = {}
  if (authHeader !== undefined) {
    headers['authorization'] = authHeader
  }
  return new Request(`http://localhost${path}`, { method: 'GET', headers })
}

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
})

// ---------------------------------------------------------------------------
// cancel-stale-orders
// ---------------------------------------------------------------------------

describe('GET /api/cron/cancel-stale-orders', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await cancelStaleGET(makeRequest('/api/cron/cancel-stale-orders') as any)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 401 when CRON_SECRET env var is not set', async () => {
    delete process.env.CRON_SECRET
    const res = await cancelStaleGET(
      makeRequest('/api/cron/cancel-stale-orders', `Bearer ${CRON_SECRET}`) as any
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 when wrong secret is provided', async () => {
    const res = await cancelStaleGET(
      makeRequest('/api/cron/cancel-stale-orders', 'Bearer wrong-secret') as any
    )
    expect(res.status).toBe(401)
  })

  it('returns 200 with success=true when correct secret is provided', async () => {
    const res = await cancelStaleGET(
      makeRequest('/api/cron/cancel-stale-orders', `Bearer ${CRON_SECRET}`) as any
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('returns processed count of 0 when no stale orders exist', async () => {
    const { queryMany } = await import('@/lib/db')
    vi.mocked(queryMany).mockResolvedValueOnce([])

    const res = await cancelStaleGET(
      makeRequest('/api/cron/cancel-stale-orders', `Bearer ${CRON_SECRET}`) as any
    )
    const body = await res.json()
    expect(body.processed).toBe(0)
    expect(body.cancelled).toBe(0)
  })

  it('counts cancelled and failed results correctly', async () => {
    const { queryMany } = await import('@/lib/db')
    vi.mocked(queryMany).mockResolvedValueOnce([
      { id: 'o1', order_number: '001', order_type: 'direct' },
      { id: 'o2', order_number: '002', order_type: 'cart' },
    ])

    const { cancelOrder } = await import('@/lib/orders')
    vi.mocked(cancelOrder)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'already cancelled' })

    const res = await cancelStaleGET(
      makeRequest('/api/cron/cancel-stale-orders', `Bearer ${CRON_SECRET}`) as any
    )
    const body = await res.json()
    expect(body.cancelled).toBe(1)
    expect(body.failed).toBe(1)
    expect(body.processed).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// compute-health
// ---------------------------------------------------------------------------

describe('GET /api/cron/compute-health', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await computeHealthGET(makeRequest('/api/cron/compute-health') as any)
    expect(res.status).toBe(401)
  })

  it('returns 401 when wrong secret is provided', async () => {
    const res = await computeHealthGET(
      makeRequest('/api/cron/compute-health', 'Bearer wrong') as any
    )
    expect(res.status).toBe(401)
  })

  it('returns 200 with success=true when correct secret is provided', async () => {
    const res = await computeHealthGET(
      makeRequest('/api/cron/compute-health', `Bearer ${CRON_SECRET}`) as any
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('returns processed=0 when no users need recomputation', async () => {
    const { queryMany } = await import('@/lib/db')
    vi.mocked(queryMany).mockResolvedValueOnce([])

    const res = await computeHealthGET(
      makeRequest('/api/cron/compute-health', `Bearer ${CRON_SECRET}`) as any
    )
    const body = await res.json()
    expect(body.processed).toBe(0)
  })
})
