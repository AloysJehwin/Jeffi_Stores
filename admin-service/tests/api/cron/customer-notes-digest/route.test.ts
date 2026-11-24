import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('@/lib/shared/customer-notes-notify', () => ({ sendNotesDigest: vi.fn() }))

import { GET } from '@admin/app/api/(internal)/cron/customer-notes-digest/route'
import { sendNotesDigest } from '@/lib/shared/customer-notes-notify'

const run = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/customer-notes-digest', { headers: auth ? { authorization: auth } : {} }))
const OK = 'Bearer test-cron-secret'

beforeEach(() => {
  vi.resetAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
})

describe('GET /api/cron/customer-notes-digest', () => {
  it('401 without the cron secret, with a wrong one, or with no secret configured, and does nothing', async () => {
    expect((await run()).status).toBe(401)
    expect((await run('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await run('Bearer undefined')).status).toBe(401)
    expect(sendNotesDigest).not.toHaveBeenCalled()
  })

  it('sends the owners one digest of the last 24h of notes (mail is mocked)', async () => {
    vi.mocked(sendNotesDigest).mockResolvedValue(3 as any)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, notes: 3 })
    expect(sendNotesDigest).toHaveBeenCalledWith(24)
  })

  it('500 with the message when the job throws', async () => {
    vi.mocked(sendNotesDigest).mockRejectedValue(new Error('mail down'))
    const res = await run(OK)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'mail down' })
  })

  it('500 with the default message when a non-error is thrown', async () => {
    vi.mocked(sendNotesDigest).mockRejectedValue('x')
    expect(await (await run(OK)).json()).toEqual({ error: 'Digest failed' })
  })
})
