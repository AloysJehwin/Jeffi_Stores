import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ resolveRequestTenant: vi.fn() }))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstanceFor: vi.fn() }))
vi.mock('@/lib/payments/dispute-records', () => ({ syncDisputes: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/financial/disputes/sync/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveRequestTenant } from '@/lib/shared/db'
import { getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import { syncDisputes } from '@/lib/payments/dispute-records'

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['financial'] }
const req = () => new NextRequest('http://localhost/api/admin/financial/disputes/sync', { method: 'POST' })
const INSTANCE = { id: 'rzp' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(resolveRequestTenant).mockResolvedValue({ tenantId: 't1' } as any)
  vi.mocked(getRazorpayInstanceFor).mockResolvedValue({ instance: INSTANCE } as any)
})

describe('POST /api/admin/financial/disputes/sync', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req())).status).toBe(401)
    expect(syncDisputes).not.toHaveBeenCalled()
  })

  it('returns 403 without financial:write', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req())).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('admin', ['financial'], 'financial:write')
    expect(syncDisputes).not.toHaveBeenCalled()
  })

  it('syncs disputes with the tenant Razorpay instance and returns the counts', async () => {
    vi.mocked(syncDisputes).mockResolvedValue({ fetched: 4, created: 2 } as any)
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, fetched: 4, created: 2 })
    expect(getRazorpayInstanceFor).toHaveBeenCalledWith('t1')
    expect(syncDisputes).toHaveBeenCalledWith(INSTANCE)
  })

  it('returns 502 with the Razorpay description when the sync fails', async () => {
    vi.mocked(syncDisputes).mockRejectedValue({ error: { description: 'Bad key' } })
    const res = await POST(req())
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Bad key' })
  })
})
