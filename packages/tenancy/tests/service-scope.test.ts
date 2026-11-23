import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock pools so resolveServiceScope's controlPlanePool().query is intercepted.
const query = vi.fn()
vi.mock('../src/pools', () => ({
  controlPlanePool: () => ({ query }),
  PLATFORM_TENANT_ID: '00000000-0000-0000-0000-000000000000',
}))

import { resolveServiceScope, scopeSql, inScope } from '../src/service-scope'

const PLATFORM_ID = '00000000-0000-0000-0000-000000000000'

const SAVE = {
  slug: process.env.SERVICE_TENANT_SLUG,
  skip: process.env.SERVICE_SKIP_STORE_TENANTS,
}
function restoreEnv() {
  for (const [k, v] of Object.entries({ SERVICE_TENANT_SLUG: SAVE.slug, SERVICE_SKIP_STORE_TENANTS: SAVE.skip })) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

describe('resolveServiceScope', () => {
  beforeEach(() => {
    query.mockReset()
    delete process.env.SERVICE_TENANT_SLUG
    delete process.env.SERVICE_SKIP_STORE_TENANTS
  })
  afterEach(restoreEnv)

  it('platform scope (no slug), not skipping store tenants by default', async () => {
    const s = await resolveServiceScope()
    expect(s).toEqual({ tenantId: null, skipStoreTenants: false })
    expect(query).not.toHaveBeenCalled()
  })

  it('platform scope skipping store tenants when flagged', async () => {
    process.env.SERVICE_SKIP_STORE_TENANTS = 'true'
    const s = await resolveServiceScope()
    expect(s).toEqual({ tenantId: null, skipStoreTenants: true })
  })

  it('resolves a tenant id for a configured slug', async () => {
    process.env.SERVICE_TENANT_SLUG = 'acme'
    query.mockResolvedValue({ rows: [{ id: 't-9' }] })
    const s = await resolveServiceScope()
    expect(s).toEqual({ tenantId: 't-9', skipStoreTenants: false })
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM tenants WHERE slug = $1'), ['acme'])
  })

  it('trims whitespace around the slug', async () => {
    process.env.SERVICE_TENANT_SLUG = '  acme  '
    query.mockResolvedValue({ rows: [{ id: 't-9' }] })
    await resolveServiceScope()
    expect(query).toHaveBeenCalledWith(expect.anything(), ['acme'])
  })

  it('throws when the configured slug has no tenant', async () => {
    process.env.SERVICE_TENANT_SLUG = 'ghost'
    query.mockResolvedValue({ rows: [] })
    await expect(resolveServiceScope()).rejects.toThrow('SERVICE_TENANT_SLUG "ghost" is not a tenant')
  })
})

describe('scopeSql', () => {
  it('scopes to a single tenant id', () => {
    const r = scopeSql({ tenantId: 't-1', skipStoreTenants: false }, 'x.tenant_id', 3)
    expect(r).toEqual({ sql: 'x.tenant_id = $3', params: ['t-1'] })
  })

  it('emits the platform-or-not-store fragment when skipping store tenants', () => {
    const r = scopeSql({ tenantId: null, skipStoreTenants: true }, 'x.tenant_id', 1)
    expect(r.params).toEqual([])
    expect(r.sql).toContain(`x.tenant_id = '${PLATFORM_ID}'`)
    expect(r.sql).toContain("'store' = ANY(st.service_types)")
  })

  it('emits true for an unscoped platform pod', () => {
    const r = scopeSql({ tenantId: null, skipStoreTenants: false }, 'x.tenant_id', 1)
    expect(r).toEqual({ sql: 'true', params: [] })
  })
})

describe('inScope', () => {
  it('always true for an unscoped (platform) pod', () => {
    expect(inScope({ tenantId: null, skipStoreTenants: false }, 'anything')).toBe(true)
    expect(inScope({ tenantId: null, skipStoreTenants: false }, null)).toBe(true)
  })

  it('true only for the matching tenant when scoped', () => {
    const s = { tenantId: 't-1', skipStoreTenants: false }
    expect(inScope(s, 't-1')).toBe(true)
    expect(inScope(s, 't-2')).toBe(false)
    expect(inScope(s, null)).toBe(false)
  })
})
