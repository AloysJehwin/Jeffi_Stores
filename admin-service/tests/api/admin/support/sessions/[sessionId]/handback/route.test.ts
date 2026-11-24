import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/support/sessions', () => ({ getSessionDto: vi.fn() }))
vi.mock('@/lib/support/admin', () => ({ handBackToAi: vi.fn() }))
vi.mock('@/lib/support/http', () => ({ adminChat: vi.fn(), agentRef: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/support/sessions/[sessionId]/handback/route'
import { getSessionDto } from '@/lib/support/sessions'
import { handBackToAi } from '@/lib/support/admin'
import { adminChat, agentRef } from '@/lib/support/http'

const ctx = { params: Promise.resolve({ sessionId: 's1' }) }
const req = () => new NextRequest('http://localhost/api/admin/support/sessions/s1/handback', { method: 'POST' })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })
const session = { id: 's1', status: 'open' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(adminChat).mockResolvedValue({ admin: { adminId: 'a1' }, session } as any)
  vi.mocked(agentRef).mockResolvedValue({ id: 'a1', name: 'Agent' } as any)
  vi.mocked(getSessionDto).mockResolvedValue({ id: 's1', handler: 'ai' } as any)
})

describe('POST /api/admin/support/sessions/[sessionId]/handback', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(adminChat).mockResolvedValueOnce(deny(401))
    expect((await POST(req(), ctx)).status).toBe(401)
    vi.mocked(adminChat).mockResolvedValueOnce(deny(403))
    expect((await POST(req(), ctx)).status).toBe(403)
    expect(adminChat).toHaveBeenCalledWith(expect.anything(), 's1', 'customers:write')
    expect(handBackToAi).not.toHaveBeenCalled()
  })

  it('returns 409 for a closed chat', async () => {
    vi.mocked(adminChat).mockResolvedValue({ admin: { adminId: 'a1' }, session: { ...session, status: 'closed' } } as any)
    expect((await POST(req(), ctx)).status).toBe(409)
    expect(handBackToAi).not.toHaveBeenCalled()
  })

  it('hands the chat back to the assistant', async () => {
    expect(await (await POST(req(), ctx)).json()).toEqual({ session: { id: 's1', handler: 'ai' } })
    expect(handBackToAi).toHaveBeenCalledWith(session, { id: 'a1', name: 'Agent' })
  })

  it('propagates a failure', async () => {
    vi.mocked(handBackToAi).mockRejectedValue(new Error('db'))
    await expect(POST(req(), ctx)).rejects.toThrow('db')
  })
})
