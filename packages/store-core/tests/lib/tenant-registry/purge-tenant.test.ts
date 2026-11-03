import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const query = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-registry/shared', () => ({ controlPlanePool: () => ({ query }) }))
vi.mock('@/lib/tenant-registry/host-resolution', () => ({ clearTenantCache: vi.fn() }))
const getTenant = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-registry/tenants', () => ({ getTenant }))
vi.mock('@/lib/shipping/delhivery', () => ({ deactivateDelhiveryPickupLocation: vi.fn(async () => {}) }))
vi.mock('@/lib/tenancy/tenant-backup-store', () => ({ deleteTenantBackups: vi.fn(async () => ({ deleted: 0 })) }))
const k8s = vi.hoisted(() => ({ k8sComputeEnabled: vi.fn(() => true), deleteTenantWorkload: vi.fn(async () => {}) }))
vi.mock('@/lib/k8s/tenant-compute', () => k8s)

import { purgeTenant } from '@/lib/tenant-registry/lifecycle'

describe('purgeTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    query.mockImplementation(async (sql: string) =>
      sql.includes('FROM owner_tenants') ? { rows: [{ owner_id: 'o1' }] } : { rows: [] }
    )
  })

  it('deletes a rolled-back (suspended) store, its workload, and reopens the owner draft', async () => {
    getTenant.mockResolvedValue({ id: 't1', slug: 'fancy-park', status: 'suspended', rds_endpoint: null })
    expect(await purgeTenant('t1')).toEqual({ ok: true, deletedBackups: 0 })
    expect(k8s.deleteTenantWorkload).toHaveBeenCalledWith('fancy-park')
    const sqls = query.mock.calls.map(c => c[0] as string)
    expect(sqls.some(s => s.startsWith('DELETE FROM tenants'))).toBe(true)
    expect(sqls.some(s => s.includes(`UPDATE onboarding_drafts SET status='draft'`))).toBe(true)
  })

  it('refuses while a database still exists or the store is live', async () => {
    getTenant.mockResolvedValue({ id: 't1', slug: 'x', status: 'suspended', rds_endpoint: 'db.host' })
    expect((await purgeTenant('t1')).ok).toBe(false)
    getTenant.mockResolvedValue({ id: 't1', slug: 'x', status: 'active', rds_endpoint: null })
    expect((await purgeTenant('t1')).ok).toBe(false)
    expect(query.mock.calls.some(c => String(c[0]).startsWith('DELETE'))).toBe(false)
  })
})
