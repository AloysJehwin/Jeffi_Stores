import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const query = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))
const seed = vi.hoisted(() => ({ seedTenantSiteSettings: vi.fn() }))
vi.mock('@controller/lib/provisioning/seed-settings', () => seed)

import { POST } from '@controller/app/api/(internal)/internal/tenants/[id]/reseed-settings/route'

const infra = (over: Record<string, unknown> = {}) => ({
  tenant_id: 't-1',
  slug: 'acme',
  rds_endpoint: 'db.example',
  rds_port: 5432,
  rds_db: 'acme',
  iam_auth: false,
  db_secret_ref: 'ref',
  ...over,
})
const call = (body: unknown = {}, qs = '', auth: string | null = 'Bearer test-cron-secret') =>
  POST(
    new NextRequest(`http://localhost/api/internal/tenants/t-1/reseed-settings${qs}`, {
      method: 'POST',
      headers: auth ? { authorization: auth } : {},
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 't-1' }) }
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'test-cron-secret')
  query.mockResolvedValue({ rows: [infra()] })
  seed.seedTenantSiteSettings.mockResolvedValue({ written: 3 })
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/internal/tenants/[id]/reseed-settings', () => {
  it('rejects a missing or wrong secret', async () => {
    expect((await call({}, '', null)).status).toBe(401)
    expect((await call({}, '', 'Bearer x')).status).toBe(401)
    expect(seed.seedTenantSiteSettings).not.toHaveBeenCalled()
  })

  it('404s for an unknown tenant', async () => {
    query.mockResolvedValue({ rows: [] })
    expect((await call()).status).toBe(404)
  })

  it('409s for a tenant with no database yet', async () => {
    query.mockResolvedValue({ rows: [infra({ rds_endpoint: null })] })
    expect((await call()).status).toBe(409)
    expect(seed.seedTenantSiteSettings).not.toHaveBeenCalled()
  })

  it('fill-only reseed of one store', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ reseeded: true, tenantId: 't-1', written: 3 })
    expect(seed.seedTenantSiteSettings).toHaveBeenCalledWith(
      't-1',
      null,
      expect.objectContaining({ endpoint: 'db.example', dbName: 'acme', force: false })
    )
  })

  it('passes force through', async () => {
    await call({ force: true })
    expect(seed.seedTenantSiteSettings.mock.calls[0][2].force).toBe(true)
  })

  it('500s when the seed throws', async () => {
    seed.seedTenantSiteSettings.mockRejectedValue(new Error('conn'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'conn' })
  })

  it('?all=1 reseeds every active store and counts failures', async () => {
    query.mockResolvedValue({ rows: [infra(), infra({ tenant_id: 't-2', slug: 'beta' })] })
    seed.seedTenantSiteSettings.mockResolvedValueOnce({ written: 1 }).mockRejectedValueOnce(new Error('bad'))
    const res = await call({}, '?all=1')
    expect(await res.json()).toEqual({
      reseeded: 1,
      failed: 1,
      results: [
        { tenantId: 't-1', slug: 'acme', written: 1 },
        { tenantId: 't-2', slug: 'beta', error: 'bad' },
      ],
    })
  })
})
