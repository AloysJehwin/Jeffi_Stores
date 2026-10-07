import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/loyalty/reconcile', () => ({ reconcileLoyalty: vi.fn() }))

import { GET } from '@/app/api/(internal)/cron/loyalty-reconcile/route'
import { reconcileLoyalty } from '@/lib/loyalty/reconcile'

const mockReconcile = reconcileLoyalty as ReturnType<typeof vi.fn>

function makeReq(secret?: string) {
  return new NextRequest('http://localhost/api/cron/loyalty-reconcile', {
    headers: secret ? { authorization: 'Bearer ' + secret } : {},
  })
}

describe('GET /api/cron/loyalty-reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-secret'
    mockReconcile.mockResolvedValue({ enabled: true, users: 3, earned: 120, more: false })
  })

  it('rejects a missing or wrong secret without running anything', async () => {
    expect((await GET(makeReq())).status).toBe(401)
    expect((await GET(makeReq('wrong'))).status).toBe(401)
    expect(mockReconcile).not.toHaveBeenCalled()
  })

  it('runs a full pass and reports what it did', async () => {
    const res = await GET(makeReq('test-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, enabled: true, users: 3, earned: 120, more: false })
    expect(mockReconcile).toHaveBeenCalledWith()
  })

  it('answers 500 with the reason when the pass fails', async () => {
    mockReconcile.mockRejectedValue(new Error('relation "loyalty_ledger" does not exist'))
    const res = await GET(makeReq('test-secret'))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('loyalty_ledger')
  })
})
