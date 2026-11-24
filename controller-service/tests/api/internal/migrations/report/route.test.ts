import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const run = vi.hoisted(() => ({ runTenantSchemaReport: vi.fn() }))
vi.mock('@controller/lib/tenant-migrations', () => run)

import { POST } from '@controller/app/api/internal/migrations/report/route'

const call = (body: unknown = {}, auth: string | null = 'Bearer test-cron-secret') =>
  POST(
    new NextRequest('http://localhost/api/internal/migrations/report', {
      method: 'POST',
      headers: auth ? { authorization: auth } : {},
      body: JSON.stringify(body),
    })
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'test-cron-secret')
  run.runTenantSchemaReport.mockResolvedValue({ stores: [], failed: 0 })
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/internal/migrations/report', () => {
  it('rejects a missing or wrong secret', async () => {
    expect((await call({}, null)).status).toBe(401)
    expect((await call({}, 'Bearer x')).status).toBe(401)
    expect(run.runTenantSchemaReport).not.toHaveBeenCalled()
  })

  it('reports all stores, or one by slug', async () => {
    const res = await call({ slug: 'acme' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, result: { stores: [], failed: 0 } })
    expect(run.runTenantSchemaReport).toHaveBeenCalledWith({ slug: 'acme' })
  })

  it('answers 500 when a store could not be read', async () => {
    run.runTenantSchemaReport.mockResolvedValue({ stores: [], failed: 1 })
    const res = await call()
    expect(res.status).toBe(500)
    expect((await res.json()).ok).toBe(false)
  })
})
