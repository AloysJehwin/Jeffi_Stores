import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/support/sessions', () => ({ touchPresence: vi.fn() }))
vi.mock('@/lib/support/http', () => ({ adminChat: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/support/sessions/[sessionId]/heartbeat/route'
import { touchPresence } from '@/lib/support/sessions'
import { adminChat } from '@/lib/support/http'

const ctx = { params: Promise.resolve({ sessionId: 's1' }) }
const req = (body = '') => new NextRequest('http://localhost/api/admin/support/sessions/s1/heartbeat', { method: 'POST', body })
const deny = (status: number) => NextResponse.json({ error: 'no' }, { status })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(adminChat).mockResolvedValue({ admin: { adminId: 'a1' }, session: { id: 's1', customer_last_seen_at: 'T0' } } as any)
  vi.mocked(touchPresence).mockResolvedValue('T1' as any)
})

describe('POST /api/admin/support/sessions/[sessionId]/heartbeat', () => {
  it('rejects unauthenticated and missing scope', async () => {
    vi.mocked(adminChat).mockResolvedValueOnce(deny(401))
    expect((await POST(req(), ctx)).status).toBe(401)
    vi.mocked(adminChat).mockResolvedValueOnce(deny(403))
    expect((await POST(req(), ctx)).status).toBe(403)
    expect(adminChat).toHaveBeenCalledWith(expect.anything(), 's1', 'customers:read', { passive: true })
    expect(touchPresence).not.toHaveBeenCalled()
  })

  it('records presence and returns the customer last-seen time', async () => {
    expect(await (await POST(req('{}'), ctx)).json()).toEqual({ ok: true, at: 'T1', customerLastSeenAt: 'T0' })
    expect(touchPresence).toHaveBeenCalledWith('s1', 'admin', false)
  })

  it('records leaving when the body says so', async () => {
    await POST(req('{"leaving":true}'), ctx)
    expect(touchPresence).toHaveBeenCalledWith('s1', 'admin', true)
  })

  it('propagates a presence failure', async () => {
    vi.mocked(touchPresence).mockRejectedValue(new Error('db'))
    await expect(POST(req(), ctx)).rejects.toThrow('db')
  })
})
