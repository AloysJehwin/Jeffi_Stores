import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/admin-agent/conversations', () => ({ deleteConversation: vi.fn(), updateConversation: vi.fn() }))

import { PATCH, DELETE } from '@admin/app/api/(admin)/admin/agent/conversations/[id]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { deleteConversation, updateConversation } from '@/lib/admin-agent/conversations'

const ctx = { params: Promise.resolve({ id: 'c1' }) }
const req = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/admin/agent/conversations/c1', { method, body: body === undefined ? undefined : JSON.stringify(body) })

describe('agent conversations [id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(updateConversation).mockResolvedValue(true as any)
    vi.mocked(deleteConversation).mockResolvedValue(true as any)
  })

  const cases = [
    { name: 'PATCH', call: () => PATCH(req('PATCH', { title: 'x' }), ctx), fn: updateConversation },
    { name: 'DELETE', call: () => DELETE(req('DELETE'), ctx), fn: deleteConversation },
  ]
  for (const { name, call, fn } of cases) {
    it(`${name} 401s without a session`, async () => {
      vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
      expect((await call()).status).toBe(401)
      expect(fn).not.toHaveBeenCalled()
    })
    it(`${name} 403s without agent:write`, async () => {
      vi.mocked(hasScope).mockReturnValue(false)
      expect((await call()).status).toBe(403)
      expect(hasScope).toHaveBeenCalledWith('manager', [], 'agent:write')
    })
    it(`${name} 404s for someone else's chat`, async () => {
      vi.mocked(fn).mockResolvedValue(false as any)
      expect((await call()).status).toBe(404)
    })
  }

  it('PATCH applies only well-typed fields', async () => {
    const res = await PATCH(req('PATCH', { title: 'New', shared: true, junk: 1 }), ctx)
    expect(res.status).toBe(200)
    expect(updateConversation).toHaveBeenCalledWith('a1', 'c1', { title: 'New', shared: true })
    await PATCH(req('PATCH', { title: 5, shared: 'yes' }), ctx)
    expect(updateConversation).toHaveBeenLastCalledWith('a1', 'c1', {})
  })

  it('PATCH tolerates a bad body', async () => {
    const r = new NextRequest('http://localhost/x', { method: 'PATCH', body: 'nope' })
    expect((await PATCH(r, ctx)).status).toBe(200)
    expect(updateConversation).toHaveBeenCalledWith('a1', 'c1', {})
  })

  it('DELETE removes the owner chat', async () => {
    const res = await DELETE(req('DELETE'), ctx)
    expect(await res.json()).toEqual({ ok: true })
    expect(deleteConversation).toHaveBeenCalledWith('a1', 'c1')
  })
})
