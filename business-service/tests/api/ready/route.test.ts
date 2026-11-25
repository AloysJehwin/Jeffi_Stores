import { describe, it, expect, vi, beforeEach } from 'vitest'

const pingDb = vi.hoisted(() => vi.fn())
const redis = vi.hoisted(() => ({ ping: vi.fn() }))

vi.mock('@/lib/shared/db', () => ({ pingDb, pingStoreDb: vi.fn() }))
vi.mock('@/lib/shared/redis', () => ({ default: redis }))

import { GET } from '@business/app/api/ready/route'

describe('GET /api/ready (business)', () => {
  beforeEach(() => {
    pingDb.mockResolvedValue('ok')
    redis.ping.mockResolvedValue('PONG')
  })

  it('is ready when the database answers', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('ready')
  })

  it('503s when the database is down', async () => {
    pingDb.mockRejectedValue(new Error('down'))
    const res = await GET()
    expect(res.status).toBe(503)
    expect((await res.json()).checks.db).toBe('fail: down')
  })
})
