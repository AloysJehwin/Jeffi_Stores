import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn().mockResolvedValue([]),
  withTransaction: vi.fn(async (fn: any) => fn({ query: vi.fn() })),
}))
vi.mock('@/lib/orders/entitlements', () => ({
  grantOrderEntitlements: vi.fn().mockResolvedValue(2),
  revokeOrderEntitlements: vi.fn().mockResolvedValue(1),
}))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn().mockResolvedValue(undefined) }))

import { GET, POST } from '@controller/app/api/(admin)/admin/orders/[id]/entitlements/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, queryMany } from '@/lib/shared/db'
import { grantOrderEntitlements, revokeOrderEntitlements } from '@/lib/orders/entitlements'

const ID = '11111111-1111-4111-8111-111111111111'
const ITEM = '22222222-2222-4222-8222-222222222222'
const params = { params: Promise.resolve({ id: ID }) }
const ORDER = { id: ID, order_number: 'JS-1', user_id: 'u-1', payment_status: 'paid' }

function req(body?: any) {
  return new NextRequest(`http://localhost/api/admin/orders/${ID}/entitlements`, {
    method: body ? 'POST' : 'GET',
    ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
}

describe('/api/admin/orders/[id]/entitlements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a-1', role: 'admin', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([])
  })

  it('401 without an admin', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await POST(req({ action: 'revoke' }), params)).status).toBe(401)
  })

  it('403 without orders:write', async () => {
    vi.mocked(hasScope).mockImplementation((_r, _s, scope) => scope !== 'orders:write')
    expect((await POST(req({ action: 'revoke' }), params)).status).toBe(403)
  })

  it('GET lists digital lines', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ order_item_id: ITEM, status: 'active' }] as any)
    const res = await GET(req(), params)
    expect((await res.json()).entitlements).toHaveLength(1)
  })

  it('400 on an invalid body', async () => {
    expect((await POST(req({ action: 'nuke' }), params)).status).toBe(400)
  })

  it('revokes specific lines', async () => {
    vi.mocked(queryOne).mockResolvedValue(ORDER as any)
    const res = await POST(req({ action: 'revoke', orderItemIds: [ITEM] }), params)
    expect(res.status).toBe(200)
    expect(revokeOrderEntitlements).toHaveBeenCalledWith(expect.anything(), {
      orderId: ID,
      orderItemIds: [ITEM],
      reason: 'admin',
    })
  })

  it('re-grants for the order owner', async () => {
    vi.mocked(queryOne).mockResolvedValue(ORDER as any)
    const res = await POST(req({ action: 'grant' }), params)
    expect(res.status).toBe(200)
    expect(grantOrderEntitlements).toHaveBeenCalledWith(expect.anything(), { orderId: ID, userId: 'u-1' })
  })

  it('refuses to grant on an unpaid order', async () => {
    vi.mocked(queryOne).mockResolvedValue({ ...ORDER, payment_status: 'refunded' } as any)
    expect((await POST(req({ action: 'grant' }), params)).status).toBe(400)
    expect(grantOrderEntitlements).not.toHaveBeenCalled()
  })

  it('404 for an unknown order', async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    expect((await POST(req({ action: 'revoke' }), params)).status).toBe(404)
  })
})
