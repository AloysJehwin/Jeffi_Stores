import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/replies/admin', () => ({ decideAsAdmin: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/replies/actions/[id]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { decideAsAdmin } from '@/lib/replies/admin'

const admin = { adminId: 'a1', username: 'a', role: 'admin', scopes: ['orders:write'] }
const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 'r1' }),
  })

describe('POST /api/admin/replies/actions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call({ decision: 'approve' })).status).toBe(401)
    expect(decideAsAdmin).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid decision', async () => {
    expect((await call({ decision: 'maybe' })).status).toBe(400)
    expect((await call({})).status).toBe(400)
    expect(decideAsAdmin).not.toHaveBeenCalled()
  })

  it('relays the helper refusal (scope or state)', async () => {
    vi.mocked(decideAsAdmin).mockResolvedValue({ ok: false, error: 'Insufficient permissions', status: 403 } as never)
    const res = await call({ decision: 'reject' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Insufficient permissions' })
  })

  it('approves with the admin id and a scope checker bound to the caller', async () => {
    vi.mocked(decideAsAdmin).mockResolvedValue({ ok: true } as never)
    vi.mocked(hasScope).mockReturnValue(true)
    const res = await call({ decision: 'approve', note: 'ok' })
    expect(await res.json()).toEqual({ success: true })
    const [id, actor, decision, note] = vi.mocked(decideAsAdmin).mock.calls[0]
    expect([id, decision, note]).toEqual(['r1', 'approve', 'ok'])
    expect(actor.adminId).toBe('a1')
    expect(actor.hasScope('orders:write')).toBe(true)
    expect(hasScope).toHaveBeenCalledWith('admin', ['orders:write'], 'orders:write')
  })

  it('propagates a helper failure', async () => {
    vi.mocked(decideAsAdmin).mockRejectedValue(new Error('db'))
    await expect(call({ decision: 'approve' })).rejects.toThrow('db')
  })
})
