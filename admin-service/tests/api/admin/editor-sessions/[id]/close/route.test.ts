import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/admin/editor-sessions', () => ({ cancelSession: vi.fn(), saveSession: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/editor-sessions/[id]/close/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { cancelSession, saveSession } from '@/lib/admin/editor-sessions'

const ID = '11111111-1111-4111-8111-111111111111'
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) })
const req = (body: unknown) => new NextRequest('http://localhost/x', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('POST editor-sessions/[id]/close', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1' } as any)
    vi.mocked(saveSession).mockResolvedValue(true as any)
    vi.mocked(cancelSession).mockResolvedValue(true as any)
  })

  it('401s without a session', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req({ action: 'save' }), ctx())).status).toBe(401)
  })

  it('400s on a bad id and a bad action', async () => {
    expect((await POST(req({ action: 'save' }), ctx('nope'))).status).toBe(400)
    expect((await POST(req({ action: 'nuke' }), ctx())).status).toBe(400)
    expect((await POST(req('bad'), ctx())).status).toBe(400)
    expect(saveSession).not.toHaveBeenCalled()
  })

  it('saves or cancels as the admin', async () => {
    expect(await (await POST(req({ action: 'save' }), ctx())).json()).toEqual({ success: true })
    expect(saveSession).toHaveBeenCalledWith(ID, 'a1')
    expect(cancelSession).not.toHaveBeenCalled()
    await POST(req({ action: 'cancel' }), ctx())
    expect(cancelSession).toHaveBeenCalledWith(ID, 'a1')
  })

  it('404s when the session is gone or not the admins', async () => {
    vi.mocked(cancelSession).mockResolvedValue(false as any)
    expect((await POST(req({ action: 'cancel' }), ctx())).status).toBe(404)
  })
})
