import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('@/lib/push/devices', () => ({ pruneDevices: vi.fn() }))

import { GET } from '@admin/app/api/(internal)/cron/prune-push-devices/route'
import { pruneDevices } from '@/lib/push/devices'

const run = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/prune-push-devices', { headers: auth ? { authorization: auth } : {} }))
const OK = 'Bearer test-cron-secret'

beforeEach(() => {
  vi.resetAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
})

describe('GET /api/cron/prune-push-devices', () => {
  it('401 without the cron secret, with a wrong one, or with no secret configured, and does nothing', async () => {
    expect((await run()).status).toBe(401)
    expect((await run('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await run('Bearer undefined')).status).toBe(401)
    expect(pruneDevices).not.toHaveBeenCalled()
  })

  it('drops app installs not seen for 270 days and reports the count', async () => {
    vi.mocked(pruneDevices).mockResolvedValue(12 as any)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, pruned: 12 })
    expect(pruneDevices).toHaveBeenCalledWith(270)
  })

  it('500 with the message when the job throws', async () => {
    vi.mocked(pruneDevices).mockRejectedValue(new Error('db down'))
    const res = await run(OK)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'db down' })
  })

  it('500 with the default message when a non-error is thrown', async () => {
    vi.mocked(pruneDevices).mockRejectedValue('x')
    expect(await (await run(OK)).json()).toEqual({ error: 'Prune failed' })
  })
})
