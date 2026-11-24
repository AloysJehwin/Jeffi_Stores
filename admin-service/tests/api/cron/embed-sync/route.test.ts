import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('@/lib/shared/embed-products', () => ({ backfillProductEmbeddings: vi.fn() }))

import { GET } from '@admin/app/api/(internal)/cron/embed-sync/route'
import { backfillProductEmbeddings } from '@/lib/shared/embed-products'

const run = (auth?: string) => GET(new NextRequest('http://localhost/api/cron/embed-sync', { headers: auth ? { authorization: auth } : {} }))
const OK = 'Bearer test-cron-secret'

beforeEach(() => {
  vi.resetAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
})

describe('GET /api/cron/embed-sync', () => {
  it('401 without the cron secret, with a wrong one, or with no secret configured, and does nothing', async () => {
    expect((await run()).status).toBe(401)
    expect((await run('Bearer wrong')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await run('Bearer undefined')).status).toBe(401)
    expect(backfillProductEmbeddings).not.toHaveBeenCalled()
  })

  it('embeds only the products that are missing an embedding', async () => {
    vi.mocked(backfillProductEmbeddings).mockResolvedValue({ embedded: 7 } as any)
    const res = await run(OK)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, embedded: 7 })
    expect(backfillProductEmbeddings).toHaveBeenCalledWith({ onlyMissing: true })
  })

  it('500 with the message when the job throws', async () => {
    vi.mocked(backfillProductEmbeddings).mockRejectedValue(new Error('embedder down'))
    const res = await run(OK)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'embedder down' })
  })

  it('500 with the default message when a non-error is thrown', async () => {
    vi.mocked(backfillProductEmbeddings).mockRejectedValue('x')
    expect(await (await run(OK)).json()).toEqual({ error: 'Embed sync failed' })
  })
})
