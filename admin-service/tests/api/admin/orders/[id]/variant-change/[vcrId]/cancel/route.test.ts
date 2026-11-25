import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/orders/[id]/variant-change/[vcrId]/cancel/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'

const admin = { adminId: 'a1', username: 'admin', role: 'admin', scopes: [] }
const call = () =>
  POST(new NextRequest('http://localhost/x', { method: 'POST' }), {
    params: Promise.resolve({ id: 'o1', vcrId: 'v1' }),
  })

describe('POST /api/admin/orders/[id]/variant-change/[vcrId]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('returns 403 without orders:write', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call()).status).toBe(403)
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('returns 404 when the request does not belong to the order', async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual(['v1', 'o1'])
  })

  it('returns 400 for an already applied change', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: 'v1', status: 'applied' })
    expect((await call()).status).toBe(400)
    expect(queryOne).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for an already closed request', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: 'v1', status: 'rejected' })
    const res = await call()
    expect(await res.json()).toEqual({ success: true, alreadyClosed: true })
    expect(queryOne).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending request', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: 'v1', status: 'pending' })
    const res = await call()
    expect(await res.json()).toEqual({ success: true })
    expect(vi.mocked(queryOne).mock.calls[1][0]).toMatch(/status = 'cancelled'/)
    expect(vi.mocked(queryOne).mock.calls[1][1]).toEqual(['v1'])
  })

  it('returns 500 when the update fails', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 'v1', status: 'pending' }).mockRejectedValueOnce(new Error('db'))
    const res = await call()
    expect(res.status).toBe(500)
  })
})
