import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('@/lib/support/notify', () => ({ sweepUnreadAgentReplies: vi.fn() }))

import { GET } from '@admin/app/api/(internal)/cron/support-away-notify/route'
import { sweepUnreadAgentReplies } from '@/lib/support/notify'

const run = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/support-away-notify', { headers: auth ? { authorization: auth } : {} }))
const OK = 'Bearer test-cron-secret'

beforeEach(() => {
  vi.resetAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
})

describe('GET /api/cron/support-away-notify', () => {
  it('401 without the cron secret, with a wrong one, or with no secret configured, and does nothing', async () => {
    expect((await run()).status).toBe(401)
    expect((await run('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await run('Bearer undefined')).status).toBe(401)
    expect(sweepUnreadAgentReplies).not.toHaveBeenCalled()
  })

  it('notifies customers about agent replies left unread (mail and push are mocked)', async () => {
    vi.mocked(sweepUnreadAgentReplies).mockResolvedValue(2 as any)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, notified: 2 })
    expect(sweepUnreadAgentReplies).toHaveBeenCalledWith()
  })

  it('500 with the message when the job throws', async () => {
    vi.mocked(sweepUnreadAgentReplies).mockRejectedValue(new Error('mail down'))
    const res = await run(OK)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'mail down' })
  })

  it('500 with the default message when a non-error is thrown', async () => {
    vi.mocked(sweepUnreadAgentReplies).mockRejectedValue('x')
    expect(await (await run(OK)).json()).toEqual({ error: 'Sweep failed' })
  })
})
