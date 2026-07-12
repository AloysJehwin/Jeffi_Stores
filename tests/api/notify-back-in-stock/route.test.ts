import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({ query: vi.fn() }))

import { POST } from '@/app/api/notify-back-in-stock/route'
import { query } from '@/lib/db'

const mockQuery = vi.mocked(query)

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/notify-back-in-stock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => { vi.clearAllMocks() })

describe('POST /api/notify-back-in-stock', () => {
  it('returns 400 when productId is missing', async () => {
    const res = await POST(makeReq({ email: 'a@b.com' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/productId/)
  })

  it('returns 400 when productId is not a string', async () => {
    const res = await POST(makeReq({ productId: 123, email: 'a@b.com' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when email is missing', async () => {
    const res = await POST(makeReq({ productId: 'prod-1' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/email/)
  })

  it('returns 400 when email is invalid', async () => {
    const res = await POST(makeReq({ productId: 'prod-1', email: 'not-an-email' }))
    expect(res.status).toBe(400)
  })

  it('inserts and returns ok on valid input', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any)
    const res = await POST(makeReq({ productId: 'prod-1', email: 'Test@Example.COM' }))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('back_in_stock_notify'),
      ['prod-1', 'test@example.com'],
    )
  })
})
