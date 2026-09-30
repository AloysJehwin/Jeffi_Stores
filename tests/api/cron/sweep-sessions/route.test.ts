import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth-sessions', () => ({ sweepExpiredAdminSessions: vi.fn() }))

import { GET } from '@/app/api/cron/sweep-sessions/route'
import { sweepExpiredAdminSessions } from '@/lib/auth-sessions'

const mockSweep = vi.mocked(sweepExpiredAdminSessions)
const req = (auth?: string) =>
  new NextRequest('http://localhost/api/cron/sweep-sessions', { headers: auth ? { authorization: auth } : {} })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'secret'
})

describe('GET /api/cron/sweep-sessions', () => {
  it('401 without the cron bearer', async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('Bearer nope'))).status).toBe(401)
    expect(mockSweep).not.toHaveBeenCalled()
  })

  it('revokes stale admin sessions and reports the count', async () => {
    mockSweep.mockResolvedValue(['s1', 's2'])
    const res = await GET(req('Bearer secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, revoked: 2 })
  })

  it('500 when the sweep fails', async () => {
    mockSweep.mockRejectedValue(new Error('db down'))
    const res = await GET(req('Bearer secret'))
    expect(res.status).toBe(500)
  })
})
