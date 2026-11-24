import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/payments/rzp-account', () => ({ razorpayAccountFor: vi.fn() }))
vi.mock('@/lib/payments/rzp-settlements', () => ({ syncRazorpaySettlements: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/financial/razorpay-settlements/sync/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'
import { syncRazorpaySettlements } from '@/lib/payments/rzp-settlements'

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['financial'] }
const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/admin/financial/razorpay-settlements/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'own' } as any)
})

describe('POST /api/admin/financial/razorpay-settlements/sync', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req())).status).toBe(401)
  })

  it('returns 403 without financial:write', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req())).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('admin', ['financial'], 'financial:write')
    expect(syncRazorpaySettlements).not.toHaveBeenCalled()
  })

  it('returns 404 for a Route store', async () => {
    vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'route' } as any)
    expect((await POST(req())).status).toBe(404)
    expect(syncRazorpaySettlements).not.toHaveBeenCalled()
  })

  it('runs an incremental sync by default', async () => {
    vi.mocked(syncRazorpaySettlements).mockResolvedValue({ synced: 3 } as any)
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ synced: 3 })
    expect(syncRazorpaySettlements).toHaveBeenCalledWith({ full: false })
  })

  it('runs a full sync only when full is exactly true', async () => {
    vi.mocked(syncRazorpaySettlements).mockResolvedValue({ synced: 9 } as any)
    await POST(req({ full: true }))
    expect(syncRazorpaySettlements).toHaveBeenLastCalledWith({ full: true })
    await POST(req({ full: 'true' }))
    expect(syncRazorpaySettlements).toHaveBeenLastCalledWith({ full: false })
  })

  it('maps a sync failure to an error response', async () => {
    vi.mocked(syncRazorpaySettlements).mockRejectedValue(Object.assign(new Error('Razorpay rejected'), { status: 401 }))
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Razorpay rejected')
  })
})
