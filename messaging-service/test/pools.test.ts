import { describe, it, expect, vi, beforeEach } from 'vitest'

const { lookupTenantContextById, tenantPool } = vi.hoisted(() => ({
  lookupTenantContextById: vi.fn(),
  tenantPool: vi.fn(),
}))
vi.mock('@jeffi/tenancy', () => ({ mainPool: () => ({ marker: 'main' }), lookupTenantContextById, tenantPool }))
vi.mock('../src/db.js', () => ({ db: { marker: 'main-db' } }))

import { poolsForTenant } from '../src/pools'
import { db } from '../src/db'

const PLATFORM = '00000000-0000-0000-0000-000000000000'

describe('poolsForTenant', () => {
  beforeEach(() => { lookupTenantContextById.mockReset(); tenantPool.mockReset() })

  it('the platform tenant uses the flagship DB for both pools and never looks up a context', async () => {
    const r = await poolsForTenant(PLATFORM)
    expect(r.ctx).toBeNull()
    expect(r.pool).toBe(db)
    expect(r.pools).toEqual({ tenant: db, platform: db })
    expect(lookupTenantContextById).not.toHaveBeenCalled()
  })

  it('a store tenant with its own RDS gets a tenant pool; platform stays the flagship', async () => {
    const ctx = { infra: { rdsEndpoint: 'rds://store1' } }
    lookupTenantContextById.mockResolvedValue(ctx)
    const tp = { marker: 'tenant-pool' }
    tenantPool.mockReturnValue(tp)
    const r = await poolsForTenant('t1')
    expect(tenantPool).toHaveBeenCalledWith(ctx)
    expect(r.pool).toBe(tp)
    expect(r.pools).toEqual({ tenant: tp, platform: db })
  })

  it('a messaging/documents-only workspace (no store DB) falls back to the flagship pool', async () => {
    lookupTenantContextById.mockResolvedValue({ infra: null })
    const r = await poolsForTenant('w1')
    expect(tenantPool).not.toHaveBeenCalled()
    expect(r.pool).toBe(db)
    expect(r.pools.tenant).toBe(db)
  })
})
