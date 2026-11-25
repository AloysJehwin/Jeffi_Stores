import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const db = vi.hoisted(() => ({ pingDb: vi.fn(), pingStoreDb: vi.fn() }))
vi.mock('@/lib/shared/db', () => db)
const redis = vi.hoisted(() => ({ ping: vi.fn() }))
vi.mock('@/lib/shared/redis', () => ({ default: redis }))

import { GET } from '@controller/app/api/ready/route'

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.SERVICE_TENANT_SLUG
  delete process.env.TENANT_DB_SLUG
  db.pingDb.mockResolvedValue('ok')
  db.pingStoreDb.mockResolvedValue('ok')
  redis.ping.mockResolvedValue('PONG')
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/ready', () => {
  it('is ready when the database and redis answer', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ready', checks: { db: 'ok', redis: 'ok' } })
    expect(db.pingStoreDb).not.toHaveBeenCalled()
  })

  it('answers 503 when the database fails', async () => {
    db.pingDb.mockRejectedValue(new Error('refused'))
    const res = await GET()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ status: 'not_ready', checks: { db: 'fail: refused' } })
  })

  it('reports redis trouble without failing readiness', async () => {
    redis.ping.mockRejectedValue(new Error('down'))
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).checks.redis).toBe('degraded: down')
  })

  it('also checks the pinned store database', async () => {
    vi.stubEnv('SERVICE_TENANT_SLUG', 'acme')
    db.pingStoreDb.mockRejectedValue(new Error('no store db'))
    const res = await GET()
    expect(db.pingStoreDb).toHaveBeenCalledWith('acme')
    expect(res.status).toBe(503)
    expect((await res.json()).checks.storeDb).toBe('fail: no store db')
  })
})
