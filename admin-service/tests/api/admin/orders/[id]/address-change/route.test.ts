import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/shared/activity', () => ({ logActivity: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/orders/address-change', () => ({ applyAddressChange: vi.fn() }))
vi.mock('@/lib/shared/address-change-email', () => ({
  sendAddressChangeDecisionEmail: vi.fn(() => Promise.resolve()),
}))

import { POST } from '@admin/app/api/(admin)/admin/orders/[id]/address-change/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { applyAddressChange } from '@/lib/orders/address-change'
import { sendAddressChangeDecisionEmail } from '@/lib/shared/address-change-email'

const admin = { adminId: 'a1', username: 'admin', role: 'admin', scopes: ['orders:write'] }
const RID = '11111111-1111-4111-8111-111111111111'
const call = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/admin/orders/o1/address-change', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'o1' }) }
  )
const addr = { postal_code: '600001' }
const orderRow = { order_number: 'ORD-1', user_id: 'u1', customer_email: 'c@x.in', customer_name: 'C' }

describe('POST /api/admin/orders/[id]/address-change', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call({ requestId: RID, action: 'approve' })).status).toBe(401)
  })

  it('returns 403 without orders:write', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call({ requestId: RID, action: 'approve' })).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('admin', ['orders:write'], 'orders:write')
    expect(applyAddressChange).not.toHaveBeenCalled()
  })

  it('returns 400 for a bad request id', async () => {
    expect((await call({ requestId: 'nope', action: 'approve' })).status).toBe(400)
  })

  it('returns 400 when rejecting without a reason', async () => {
    expect((await call({ requestId: RID, action: 'reject', adminNotes: '  ' })).status).toBe(400)
  })

  it('approves, applies the change and emails the customer', async () => {
    vi.mocked(applyAddressChange).mockResolvedValue({
      applied: true,
      newAddress: addr,
      userId: 'u1',
      orderNumber: 'ORD-1',
      gstSplitChanged: true,
    } as never)
    vi.mocked(queryOne).mockResolvedValue(orderRow)
    const res = await call({ requestId: RID, action: 'approve', adminNotes: ' ok ' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, status: 'approved', gstSplitChanged: true })
    expect(applyAddressChange).toHaveBeenCalledWith({ requestId: RID, orderId: 'o1', adminId: 'a1', adminNotes: 'ok' })
    expect(sendAddressChangeDecisionEmail).toHaveBeenCalledWith(
      expect.objectContaining({ customerEmail: 'c@x.in', decision: 'approved', orderNumber: 'ORD-1' })
    )
  })

  it('maps an approve failure reason to its status', async () => {
    vi.mocked(applyAddressChange).mockResolvedValue({ applied: false, reason: 'not_pending', message: 'gone' } as never)
    const res = await call({ requestId: RID, action: 'approve' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'gone', reason: 'not_pending' })
    expect(sendAddressChangeDecisionEmail).not.toHaveBeenCalled()
  })

  it('rejects a pending request and records the reason', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: RID, new_address_snapshot: addr } as never)
      .mockResolvedValueOnce(orderRow)
    const res = await call({ requestId: RID, action: 'reject', adminNotes: 'bad pin' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, status: 'rejected' })
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual(['a1', 'bad pin', RID, 'o1'])
    expect(sendAddressChangeDecisionEmail).toHaveBeenCalledWith(expect.objectContaining({ decision: 'rejected', adminNotes: 'bad pin' }))
  })

  it('returns 404 when there is no pending request to reject', async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    expect((await call({ requestId: RID, action: 'reject', adminNotes: 'x' })).status).toBe(404)
  })

  it('returns 500 when applying throws', async () => {
    vi.mocked(applyAddressChange).mockRejectedValue(new Error('boom'))
    const res = await call({ requestId: RID, action: 'approve' })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('boom')
  })
})
