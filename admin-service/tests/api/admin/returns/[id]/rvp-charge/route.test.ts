import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/payments/wallet', () => ({ tenantShipsOnPlatform: vi.fn() }))
vi.mock('@/lib/shared/activity', () => ({ logActivity: vi.fn(() => Promise.resolve()) }))

import { POST } from '@admin/app/api/(admin)/admin/returns/[id]/rvp-charge/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query } from '@/lib/shared/db'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { tenantShipsOnPlatform } from '@/lib/payments/wallet'
import { logActivity } from '@/lib/shared/activity'

const admin = { adminId: 'a1', username: 'admin', role: 'admin', scopes: [] }
const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 'rr1' }),
  })
const rr = { id: 'rr1', rvp_awb_number: 'AWB9', order_id: 'o1', order_number: 'ORD-1', user_id: 'u1' }

describe('POST /api/admin/returns/[id]/rvp-charge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(resolveTenantId).mockResolvedValue('t1' as never)
    vi.mocked(tenantShipsOnPlatform).mockResolvedValue(false)
  })

  it('returns 401 and 403', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call({ charge: 5 })).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call({ charge: 5 })).status).toBe(403)
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 400 for a missing, negative or non-numeric charge', async () => {
    expect((await call({})).status).toBe(400)
    expect((await call({ charge: -1 })).status).toBe(400)
    expect((await call({ charge: 'abc' })).status).toBe(400)
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown return and 409 without an RVP AWB', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null)
    expect((await call({ charge: 5 })).status).toBe(404)
    vi.mocked(queryOne).mockResolvedValueOnce({ ...rr, rvp_awb_number: null })
    expect((await call({ charge: 5 })).status).toBe(409)
    expect(query).not.toHaveBeenCalled()
  })

  it('records the exact charge without charging the wallet', async () => {
    vi.mocked(queryOne).mockResolvedValue(rr)
    const res = await call({ charge: 87.5 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, charge: 87.5, walletCharged: false })
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([87.5, 'rr1'])
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', metadata: { rvp_delivery_charge: 87.5, awb: 'AWB9' } }))
  })

  it('accepts a zero charge and warns for platform-account stores', async () => {
    vi.mocked(queryOne).mockResolvedValue(rr)
    vi.mocked(tenantShipsOnPlatform).mockResolvedValue(true)
    const body = await (await call({ charge: 0 })).json()
    expect(body.charge).toBe(0)
    expect(body.walletWarning).toMatch(/estimate/)
  })

  it('returns 500 when the update fails', async () => {
    vi.mocked(queryOne).mockResolvedValue(rr)
    vi.mocked(query).mockRejectedValue(new Error('db'))
    expect((await call({ charge: 5 })).status).toBe(500)
  })
})
