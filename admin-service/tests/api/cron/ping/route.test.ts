import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const db = vi.hoisted(() => ({ queryOne: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: db.queryOne }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: vi.fn(async () => ({ tenantId: 't1', slug: 'acme' })) }))

import { GET } from '@admin/app/api/(internal)/cron/ping/route'

const req = (auth?: string) => new NextRequest('http://localhost/api/cron/ping', { headers: auth ? { authorization: auth } : {} })
const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'secret'
  process.env.MESSAGING_URL = 'http://msg:3101'
  process.env.DOCUMENTS_URL = 'http://docs:3102/'
  db.queryOne.mockResolvedValue({ ok: 1 })
  fetchMock.mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('GET /api/cron/ping', () => {
  it('401 without the cron bearer', async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('Bearer nope'))).status).toBe(401)
    expect(db.queryOne).not.toHaveBeenCalled()
  })

  it('reports the store, its database and its own messaging and document services', async () => {
    const res = await GET(req('Bearer secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, tenant: 'acme', db: 'ok', messaging: 'ok', documents: 'ok' })
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual(['http://msg:3101/healthz', 'http://docs:3102/healthz'])
  })

  it('flags a failing check without failing the request', async () => {
    db.queryOne.mockRejectedValue(new Error('down'))
    fetchMock.mockImplementation(async (url: string) => (url.startsWith('http://msg') ? { ok: false } : Promise.reject(new Error('refused'))))
    const json = await (await GET(req('Bearer secret'))).json()
    expect(json).toEqual({ ok: false, tenant: 'acme', db: 'error', messaging: 'error', documents: 'error' })
  })

  it('n/a for a service the pod has no URL for', async () => {
    delete process.env.MESSAGING_URL
    delete process.env.DOCUMENTS_URL
    const json = await (await GET(req('Bearer secret'))).json()
    expect(json).toMatchObject({ ok: true, messaging: 'n/a', documents: 'n/a' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
