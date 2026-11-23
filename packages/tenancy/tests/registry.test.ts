import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const cpQuery = vi.fn()
vi.mock('../src/pools', () => ({
  controlPlanePool: () => ({ query: cpQuery }),
  PLATFORM_TENANT_ID: '00000000-0000-0000-0000-000000000000',
}))

const ENV = { ...process.env }
beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  process.env = { ...ENV }
})

// Fresh module each time so the registry cache starts empty.
async function load() {
  vi.resetModules()
  return import('../src/registry')
}

const activeRow = (over: Partial<any> = {}) => ({
  id: 't-1',
  slug: 'acme',
  display_name: 'Acme',
  status: 'active',
  instance_state: 'ready',
  plan: 'pro',
  rds_endpoint: 'tenant.rds.amazonaws.com',
  rds_db: 'jeffi_stores',
  rds_port: 5432,
  rds_user: 'app_user',
  db_secret_ref: null,
  iam_auth: true,
  s3_bucket: 'acme-bkt',
  region: 'us-east-1',
  ...over,
})

describe('lookupTenantContextBySlug — toCtx mapping', () => {
  it('maps an active tenant row to a full context with infra', async () => {
    cpQuery.mockResolvedValue({ rows: [activeRow()] })
    const m = await load()
    const ctx = await m.lookupTenantContextBySlug('acme')
    expect(ctx).toMatchObject({
      tenantId: 't-1',
      slug: 'acme',
      displayName: 'Acme',
      plan: 'pro',
      infra: { rdsEndpoint: 'tenant.rds.amazonaws.com', rdsDb: 'jeffi_stores', rdsPort: 5432, iamAuth: true, s3Bucket: 'acme-bkt', region: 'us-east-1' },
    })
    const [sql, params] = cpQuery.mock.calls[0]
    expect(sql).toContain('t.slug = $1')
    expect(params).toEqual(['acme'])
  })

  it('applies infra defaults when fields are null', async () => {
    cpQuery.mockResolvedValue({ rows: [activeRow({ rds_db: null, rds_port: null, iam_auth: false, region: null, rds_user: null, db_secret_ref: null, s3_bucket: null })] })
    const m = await load()
    const ctx = await m.lookupTenantContextBySlug('acme')
    expect(ctx!.infra).toMatchObject({ rdsDb: 'jeffi_stores', rdsPort: 5432, iamAuth: false, region: 'us-east-1', rdsUser: null, dbSecretRef: null, s3Bucket: null })
  })

  it('returns null infra when the row has no rds_endpoint', async () => {
    cpQuery.mockResolvedValue({ rows: [activeRow({ rds_endpoint: null })] })
    const m = await load()
    const ctx = await m.lookupTenantContextBySlug('acme')
    expect(ctx!.infra).toBeNull()
  })

  it('returns null for a non-active tenant', async () => {
    cpQuery.mockResolvedValue({ rows: [activeRow({ status: 'suspended' })] })
    const m = await load()
    expect(await m.lookupTenantContextBySlug('acme')).toBeNull()
  })

  it('returns null for a migrating instance', async () => {
    cpQuery.mockResolvedValue({ rows: [activeRow({ instance_state: 'migrating' })] })
    const m = await load()
    expect(await m.lookupTenantContextBySlug('acme')).toBeNull()
  })

  it('returns null when there is no row', async () => {
    cpQuery.mockResolvedValue({ rows: [] })
    const m = await load()
    expect(await m.lookupTenantContextBySlug('ghost')).toBeNull()
  })
})

describe('caching', () => {
  it('serves a cached result without a second query', async () => {
    cpQuery.mockResolvedValue({ rows: [activeRow()] })
    const m = await load()
    await m.lookupTenantContextBySlug('acme')
    await m.lookupTenantContextBySlug('acme')
    expect(cpQuery).toHaveBeenCalledTimes(1)
  })

  it('clearTenantCache forces a re-query', async () => {
    cpQuery.mockResolvedValue({ rows: [activeRow()] })
    const m = await load()
    await m.lookupTenantContextBySlug('acme')
    m.clearTenantCache()
    await m.lookupTenantContextBySlug('acme')
    expect(cpQuery).toHaveBeenCalledTimes(2)
  })
})

describe('lookupTenantContextById', () => {
  it('queries by id', async () => {
    cpQuery.mockResolvedValue({ rows: [activeRow()] })
    const m = await load()
    await m.lookupTenantContextById('t-1')
    expect(cpQuery.mock.calls[0][0]).toContain('t.id = $1')
    expect(cpQuery.mock.calls[0][1]).toEqual(['t-1'])
  })
})

describe('resolveTenantFromHost', () => {
  it('looks up by slug for a store subdomain', async () => {
    cpQuery.mockResolvedValue({ rows: [activeRow()] })
    const m = await load()
    const ctx = await m.resolveTenantFromHost('acme.jeffistores.in')
    expect(ctx!.slug).toBe('acme')
    expect(cpQuery.mock.calls[0][0]).toContain('t.slug = $1')
    expect(cpQuery.mock.calls[0][1]).toEqual(['acme'])
  })

  it('looks up by custom domain for an external host', async () => {
    cpQuery.mockResolvedValue({ rows: [activeRow({ slug: 'cust' })] })
    const m = await load()
    const ctx = await m.resolveTenantFromHost('shop.example.com')
    expect(ctx!.slug).toBe('cust')
    const [sql, params] = cpQuery.mock.calls[0]
    expect(sql).toContain('tenant_custom_domains')
    expect(params).toEqual(['shop.example.com'])
  })

  it('returns null without querying for the bare root domain', async () => {
    const m = await load()
    const ctx = await m.resolveTenantFromHost('jeffistores.in')
    expect(ctx).toBeNull()
    expect(cpQuery).not.toHaveBeenCalled()
  })

  it('strips the port from the host before resolving', async () => {
    cpQuery.mockResolvedValue({ rows: [activeRow()] })
    const m = await load()
    await m.resolveTenantFromHost('acme.jeffistores.in:443')
    expect(cpQuery.mock.calls[0][1]).toEqual(['acme'])
  })
})
