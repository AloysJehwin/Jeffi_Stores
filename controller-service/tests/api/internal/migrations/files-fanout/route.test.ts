import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const run = vi.hoisted(() => ({ runMigrationFilesFanout: vi.fn() }))
vi.mock('@controller/lib/tenant-migrations', () => run)

import { POST } from '@controller/app/api/internal/migrations/files-fanout/route'

const call = (body: unknown = {}, auth: string | null = 'Bearer test-cron-secret') =>
  POST(
    new NextRequest('http://localhost/api/internal/migrations/files-fanout', {
      method: 'POST',
      headers: auth ? { authorization: auth } : {},
      body: JSON.stringify(body),
    })
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'test-cron-secret')
  run.runMigrationFilesFanout.mockResolvedValue({ total: 2, failed: 0 })
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/internal/migrations/files-fanout', () => {
  it('rejects a missing or wrong secret', async () => {
    expect((await call({}, null)).status).toBe(401)
    expect((await call({}, 'Bearer x')).status).toBe(401)
    expect(run.runMigrationFilesFanout).not.toHaveBeenCalled()
  })

  it('applies for the given sha and slug', async () => {
    const res = await call({ gitSha: 'abc', slug: 'acme' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, result: { total: 2, failed: 0 } })
    expect(run.runMigrationFilesFanout).toHaveBeenCalledWith('abc', { slug: 'acme' })
  })

  it('falls back to GIT_SHA, then a manual label', async () => {
    vi.stubEnv('GIT_SHA', 'envsha')
    await call({})
    expect(run.runMigrationFilesFanout).toHaveBeenLastCalledWith('envsha', { slug: undefined })
    vi.stubEnv('GIT_SHA', '')
    await call({})
    expect(run.runMigrationFilesFanout.mock.calls[1][0]).toMatch(/^manual-\d+$/)
  })

  it('answers 500 when a store failed', async () => {
    run.runMigrationFilesFanout.mockResolvedValue({ total: 2, failed: 1 })
    const res = await call({ gitSha: 'abc' })
    expect(res.status).toBe(500)
    expect((await res.json()).ok).toBe(false)
  })
})
