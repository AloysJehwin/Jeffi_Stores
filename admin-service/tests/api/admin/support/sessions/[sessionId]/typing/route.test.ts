import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/support/events', () => ({ publishSupportEvent: vi.fn() }))
vi.mock('@/lib/support/http', () => ({ adminChat: vi.fn(), agentRef: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/support/sessions/[sessionId]/typing/route'
import { publishSupportEvent } from '@/lib/support/events'
import { adminChat, agentRef } from '@/lib/support/http'

const ctx = { params: Promise.resolve({ sessionId: 's1' }) }
const req = (body: unknown = {}) =>
  new NextRequest('http://localhost/api/admin/support/sessions/s1/typing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(adminChat).mockResolvedValue({ admin: { adminId: 'a1' }, session: { id: 's1' } } as any)
  vi.mocked(agentRef).mockResolvedValue({ id: 'a1', name: 'Agent' } as any)
})

describe('POST /api/admin/support/sessions/[sessionId]/typing', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(adminChat).mockResolvedValueOnce(deny(401))
    expect((await POST(req(), ctx)).status).toBe(401)
    vi.mocked(adminChat).mockResolvedValueOnce(deny(403))
    expect((await POST(req(), ctx)).status).toBe(403)
    expect(adminChat).toHaveBeenCalledWith(expect.anything(), 's1', 'customers:write', { passive: true })
    expect(publishSupportEvent).not.toHaveBeenCalled()
  })

  it('publishes a typing-on event under the agent name by default', async () => {
    expect(await (await POST(req(), ctx)).json()).toEqual({ ok: true })
    expect(publishSupportEvent).toHaveBeenCalledWith({ kind: 'typing', sessionId: 's1', who: 'admin', name: 'Agent', on: true })
  })

  it('publishes typing-off when on is false', async () => {
    await POST(req({ on: false }), ctx)
    expect(publishSupportEvent).toHaveBeenCalledWith(expect.objectContaining({ on: false }))
  })

  it('propagates a publish failure', async () => {
    vi.mocked(publishSupportEvent).mockRejectedValue(new Error('bus'))
    await expect(POST(req(), ctx)).rejects.toThrow('bus')
  })
})
