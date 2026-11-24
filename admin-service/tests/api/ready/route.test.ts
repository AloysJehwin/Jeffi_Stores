import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ pingDb: vi.fn(), pingStoreDb: vi.fn() }))
vi.mock('@/lib/shared/redis', () => ({ default: { ping: vi.fn() } }))

import { GET } from '@admin/app/api/ready/route'
import { pingDb, pingStoreDb } from '@/lib/shared/db'
import redis from '@/lib/shared/redis'

const ping = redis.ping as unknown as ReturnType<typeof vi.fn>

describe('GET /api/ready', () => {
  const old = { s: process.env.SERVICE_TENANT_SLUG, t: process.env.TENANT_DB_SLUG }
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.SERVICE_TENANT_SLUG
    delete process.env.TENANT_DB_SLUG
    vi.mocked(pingDb).mockResolvedValue('ok' as never)
    ping.mockResolvedValue('PONG')
  })
  afterEach(() => {
    if (old.s !== undefined) process.env.SERVICE_TENANT_SLUG = old.s
    if (old.t !== undefined) process.env.TENANT_DB_SLUG = old.t
  })

  it('is ready when the database and redis answer', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ready', checks: { db: 'ok', redis: 'ok' } })
    expect(pingStoreDb).not.toHaveBeenCalled()
  })

  it('returns 503 when the database does not answer', async () => {
    vi.mocked(pingDb).mockRejectedValue(new Error('refused'))
    const res = await GET()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ status: 'not_ready', checks: { db: 'fail: refused' } })
  })

  it('also checks the pinned store database and fails when it is down', async () => {
    process.env.SERVICE_TENANT_SLUG = 'shop'
    vi.mocked(pingStoreDb).mockRejectedValue(new Error('no store db'))
    const res = await GET()
    expect(pingStoreDb).toHaveBeenCalledWith('shop')
    expect(res.status).toBe(503)
    expect((await res.json()).checks.storeDb).toBe('fail: no store db')
  })

  it('stays ready, reporting degraded, when redis fails', async () => {
    ping.mockRejectedValue(new Error('redis down'))
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).checks.redis).toBe('degraded: redis down')
  })

  it('reports an unexpected redis reply without failing', async () => {
    ping.mockResolvedValue('NOPE')
    const body = await (await GET()).json()
    expect(body.checks.redis).toBe('unexpected: NOPE')
  })
})
