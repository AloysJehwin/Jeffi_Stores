import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const pingDb = vi.hoisted(() => vi.fn())
const pingStoreDb = vi.hoisted(() => vi.fn())
const redis = vi.hoisted(() => ({ ping: vi.fn() }))

vi.mock('@/lib/shared/db', () => ({ pingDb, pingStoreDb }))
vi.mock('@/lib/shared/redis', () => ({ default: redis }))

import { GET } from '@storefront/app/api/ready/route'

describe('GET /api/ready (storefront)', () => {
  beforeEach(() => {
    pingDb.mockResolvedValue('ok')
    pingStoreDb.mockResolvedValue('ok')
    redis.ping.mockResolvedValue('PONG')
    delete process.env.SERVICE_TENANT_SLUG
    delete process.env.TENANT_DB_SLUG
  })
  afterEach(() => {
    delete process.env.SERVICE_TENANT_SLUG
  })

  it('is ready when db and redis answer', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ready', checks: { db: 'ok', redis: 'ok' } })
    expect(pingStoreDb).not.toHaveBeenCalled()
  })

  it('503s when the database is down', async () => {
    pingDb.mockRejectedValue(new Error('conn refused'))
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.status).toBe('not_ready')
    expect(body.checks.db).toBe('fail: conn refused')
  })

  it('reports redis degradation without failing readiness', async () => {
    redis.ping.mockRejectedValue(new Error('redis gone'))
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).checks.redis).toBe('degraded: redis gone')
  })

  it('flags an unexpected redis reply', async () => {
    redis.ping.mockResolvedValue('weird')
    expect((await (await GET()).json()).checks.redis).toBe('unexpected: weird')
  })

  it('also checks the pinned store database and fails when it is down', async () => {
    process.env.SERVICE_TENANT_SLUG = 'acme'
    expect((await GET()).status).toBe(200)
    expect(pingStoreDb).toHaveBeenCalledWith('acme')
    pingStoreDb.mockRejectedValue(new Error('store db down'))
    const res = await GET()
    expect(res.status).toBe(503)
    expect((await res.json()).checks.storeDb).toBe('fail: store db down')
  })
})
