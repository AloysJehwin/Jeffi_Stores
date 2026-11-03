import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const query = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-registry/shared', () => ({ controlPlanePool: () => ({ query }) }))
vi.mock('@/lib/tenant-registry/host-resolution', () => ({ clearTenantCache: vi.fn() }))
const getTenant = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-registry/tenants', () => ({ getTenant }))
vi.mock('@/lib/shipping/delhivery', () => ({ deactivateDelhiveryPickupLocation: vi.fn(async () => {}) }))
vi.mock('@/lib/tenancy/tenant-backup-store', () => ({ deleteTenantBackups: vi.fn(async () => ({ deleted: 0 })) }))
const k8s = vi.hoisted(() => ({
  k8sComputeEnabled: vi.fn(() => true),
  deleteTenantWorkload: vi.fn(async () => ['i-1']),
  terminateTenantInstance: vi.fn(async (_slug: string, id: string, terminate: (id: string) => Promise<void>) => {
    await terminate(id)
    return 'terminated'
  }),
}))
vi.mock('@/lib/k8s/tenant-compute', () => k8s)
const ec2 = vi.hoisted(() => ({ terminateInstance: vi.fn(async () => {}), deleteSnapshot: vi.fn(async () => {}) }))
vi.mock('@/lib/shared/ec2-client', () => ec2)
const secrets = vi.hoisted(() => ({ forceDeleteDbSecret: vi.fn(async () => {}) }))
vi.mock('@/lib/shared/db-secret', () => secrets)

import { purgeTenant } from '@/lib/tenant-registry/lifecycle'
import { purgeBlocker } from '@/lib/tenant-registry/purge-rule'

const PLATFORM = '00000000-0000-0000-0000-000000000000'

describe('purgeTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    query.mockImplementation(async (sql: string) =>
      sql.includes('FROM owner_tenants')
        ? { rows: [{ owner_id: 'o1' }] }
        : sql.includes('dbVolumeSnapshotId')
          ? { rows: [{ id: 'snap-1' }] }
          : { rows: [] }
    )
  })

  it('deletes a rolled-back (suspended) store, its servers, snapshot, secret and rows, and reopens the owner draft', async () => {
    getTenant.mockResolvedValue({ id: 't1', slug: 'fancy-park', status: 'suspended', rds_endpoint: null })
    expect(await purgeTenant('t1')).toEqual({ ok: true, deletedBackups: 0 })
    expect(k8s.deleteTenantWorkload).toHaveBeenCalledWith('fancy-park')
    expect(ec2.terminateInstance).toHaveBeenCalledWith('i-1')
    expect(ec2.deleteSnapshot).toHaveBeenCalledWith('snap-1')
    expect(secrets.forceDeleteDbSecret).toHaveBeenCalledWith('jeffi/tenant-db/fancy-park', expect.any(String))
    const sqls = query.mock.calls.map(c => c[0] as string)
    const del = sqls.find(s => s.includes('DELETE FROM tenants'))!
    for (const t of ['import_jobs', 'sheet_product_links', 'tenant_social_accounts', 'tenant_integration_credentials', 'razorpay_subscription_index', 'ai_provider_identities'])
      expect(del).toContain(`DELETE FROM ${t} WHERE tenant_id=$1`)
    expect(sqls.some(s => s.includes(`UPDATE onboarding_drafts SET status='draft'`))).toBe(true)
  })

  it('refuses while a database or server still exists, the store is live, or it is the platform', async () => {
    getTenant.mockResolvedValue({ id: 't1', slug: 'x', status: 'suspended', rds_endpoint: 'db.host' })
    expect((await purgeTenant('t1')).ok).toBe(false)
    getTenant.mockResolvedValue({ id: 't1', slug: 'x', status: 'suspended', rds_endpoint: null, ec2_instance_id: 'i-9' })
    expect((await purgeTenant('t1')).ok).toBe(false)
    getTenant.mockResolvedValue({ id: 't1', slug: 'x', status: 'active', rds_endpoint: null })
    expect((await purgeTenant('t1')).ok).toBe(false)
    expect((await purgeTenant(PLATFORM)).ok).toBe(false)
    expect(query.mock.calls.some(c => String(c[0]).includes('DELETE'))).toBe(false)
  })
})

describe('purgeBlocker', () => {
  it('allows terminated, rejected and bare suspended stores only', () => {
    expect(purgeBlocker({ id: 't', status: 'terminated' })).toBeNull()
    expect(purgeBlocker({ id: 't', status: 'rejected' })).toBeNull()
    expect(purgeBlocker({ id: 't', status: 'suspended', rds_endpoint: null })).toBeNull()
    expect(purgeBlocker({ id: 't', status: 'suspended' }, 1)).toMatch(/servers/)
    expect(purgeBlocker({ id: 't', status: 'deprovisioned' })).toMatch(/terminated/)
    expect(purgeBlocker({ id: PLATFORM, status: 'terminated' })).toMatch(/platform/)
  })
})
