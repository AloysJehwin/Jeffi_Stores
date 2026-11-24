import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('@/lib/drive/files', () => ({ purgeTrash: vi.fn() }))

import { GET } from '@admin/app/api/(internal)/cron/drive-purge-trash/route'
import { purgeTrash } from '@/lib/drive/files'

const run = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/drive-purge-trash', { headers: auth ? { authorization: auth } : {} }))
const OK = 'Bearer test-cron-secret'

beforeEach(() => {
  vi.resetAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
})

describe('GET /api/cron/drive-purge-trash', () => {
  it('401 without the cron secret, with a wrong one, or with no secret configured, and does nothing', async () => {
    expect((await run()).status).toBe(401)
    expect((await run('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await run('Bearer undefined')).status).toBe(401)
    expect(purgeTrash).not.toHaveBeenCalled()
  })

  it('purges Drive files trashed for 30 days and reports how many', async () => {
    vi.mocked(purgeTrash).mockResolvedValue(4 as any)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, purged: 4 })
    expect(purgeTrash).toHaveBeenCalledWith(30)
  })

  it('500 with the message when the job throws', async () => {
    vi.mocked(purgeTrash).mockRejectedValue(new Error('storage down'))
    const res = await run(OK)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'storage down' })
  })

  it('500 with the default message when a non-error is thrown', async () => {
    vi.mocked(purgeTrash).mockRejectedValue('x')
    expect(await (await run(OK)).json()).toEqual({ error: 'Purge failed' })
  })
})
