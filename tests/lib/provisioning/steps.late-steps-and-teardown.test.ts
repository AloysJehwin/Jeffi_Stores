/**
 * Extra coverage for src/lib/provisioning/steps.ts — the steps the primary
 * steps.test.ts intentionally skips because they were added later:
 *   - generate_legals (non-fatal; success + failure)
 *   - ensure_compute (shared-target fallback / dedicated EC2 / shared pool)
 *   - setup_delhivery (registered / skipped / non-fatal error)
 *   - rollbackProvisioning (DNS + EC2 + bucket + DB teardown, status reconcile)
 *
 * Same seams as steps.test.ts: tenant-registry, tenant-backup-store and seed are
 * mocked. Additionally the dynamically-imported modules these steps reach for —
 * ../legals/provision, ../pool-autoscale, ../delhivery — are mocked, plus the
 * getKyc/getDraft/controlPlanePool trio used by setup_delhivery.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StubProvisioningProvider } from '@/lib/provisioning/stub-provider'

// ── tenant-registry (persistence + setup_delhivery lookups) ──────────────────
const reg = {
  getTenant: vi.fn(),
  getProvisioningJob: vi.fn(),
  updateProvisioningJob: vi.fn().mockResolvedValue(undefined),
  setTenantStatus: vi.fn().mockResolvedValue(undefined),
  writeTenantInfra: vi.fn().mockResolvedValue(undefined),
  writeTenantEc2: vi.fn().mockResolvedValue(undefined),
  clearTenantInfra: vi.fn().mockResolvedValue(undefined),
  clearTenantCache: vi.fn(),
  getKyc: vi.fn(),
  getDraft: vi.fn(),
  controlPlanePool: vi.fn(),
}
vi.mock('@/lib/tenant-registry', () => reg)

vi.mock('@/lib/tenancy/tenant-backup-store', () => ({ getTenantBackup: vi.fn(), putTenantBackup: vi.fn() }))
vi.mock('@/lib/provisioning/seed', () => ({ seedTenantData: vi.fn() }))

// ── dynamically-imported step dependencies ───────────────────────────────────
const legals = { generateTenantLegals: vi.fn() }
vi.mock('@/lib/legals/provision', () => legals)

const poolAuto = { ensurePoolInstance: vi.fn(), deletePoolIfEmpty: vi.fn() }
vi.mock('@/lib/tenancy/pool-autoscale', () => poolAuto)

const delhivery = { createDelhiveryPickupLocation: vi.fn() }
vi.mock('@/lib/shipping/delhivery', () => delhivery)

vi.mock('@/lib/provisioning/user-data', () => ({ appBootUserData: () => '#!/bin/sh boot' }))

const TENANT = {
  id: 't-1',
  slug: 'acme',
  display_name: 'Acme',
  plan: 'basic',
  rds_endpoint: null,
  s3_bucket: null,
  rds_db: null,
}

function job(over: Partial<any> = {}): any {
  return {
    id: 'job-1',
    tenant_id: 't-1',
    step: 'preflight',
    status: 'pending',
    attempts: 0,
    last_error: null,
    created_resources: {},
    ...over,
  }
}
function patches() {
  return reg.updateProvisioningJob.mock.calls.map((c: any[]) => c[1])
}
function lastPatch() {
  const c = reg.updateProvisioningJob.mock.calls
  return c.length ? c[c.length - 1][1] : null
}

beforeEach(() => {
  vi.clearAllMocks()
  reg.getTenant.mockResolvedValue({ ...TENANT })
  reg.getProvisioningJob.mockResolvedValue(null)
  reg.updateProvisioningJob.mockResolvedValue(undefined)
  reg.controlPlanePool.mockReturnValue({ query: vi.fn().mockResolvedValue({ rows: [] }) })
  reg.getKyc.mockResolvedValue(null)
  reg.getDraft.mockResolvedValue(null)
  poolAuto.ensurePoolInstance.mockResolvedValue({ ip: '10.0.0.9' })
  poolAuto.deletePoolIfEmpty.mockResolvedValue(undefined)
  legals.generateTenantLegals.mockResolvedValue(undefined)
  delhivery.createDelhiveryPickupLocation.mockResolvedValue({ ok: true })
  process.env.RDS_MASTER_PASSWORD = 'secret'
  process.env.TENANT_APP_TARGET_IP = '203.0.113.10' // NOT the flagship — see flagship interlock
})
afterEach(() => {
  delete process.env.RDS_MASTER_PASSWORD
  delete process.env.TENANT_APP_TARGET_IP
  delete process.env.TENANT_APP_AMI_ID
  delete process.env.POOL_INSTANCE_ID
  delete process.env.TENANT_DEDICATED_EC2_TYPE
})

// ── generate_legals — non-fatal ──────────────────────────────────────────────
describe('generate_legals', () => {
  it('generates legals and advances to seed_settings', async () => {
    const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
    await advanceProvisioningJob(
      job({ step: 'generate_legals', created_resources: { endpoint: 'ep' } }),
      new StubProvisioningProvider(0)
    )
    expect(legals.generateTenantLegals).toHaveBeenCalledWith('t-1', 'ep')
    const p = patches().find(x => x.step === 'seed_settings')
    expect(p?.created_resources).toMatchObject({ legalsGenerated: true })
  })

  it('records the error but still advances when legals generation throws (non-fatal)', async () => {
    legals.generateTenantLegals.mockRejectedValue(new Error('template render failed'))
    const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
    await advanceProvisioningJob(
      job({ step: 'generate_legals', created_resources: { endpoint: 'ep' } }),
      new StubProvisioningProvider(0)
    )
    const p = patches().find(x => x.step === 'seed_settings')
    expect(p?.created_resources?.legalsError).toMatch(/template render failed/)
  })
})

// ── seed_settings — non-fatal onboarding → site_settings copy ─────────────────
describe('seed_settings', () => {
  it('advances to ensure_compute and skips when no owner is recorded', async () => {
    reg.controlPlanePool.mockReturnValue({ query: vi.fn().mockResolvedValue({ rows: [] }) })
    const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
    await advanceProvisioningJob(
      job({ step: 'seed_settings', created_resources: { endpoint: 'ep' } }),
      new StubProvisioningProvider(0)
    )
    const p = patches().find(x => x.step === 'ensure_compute')
    expect(p?.created_resources?.settingsSeeded).toMatch(/skipped/)
  })

  it('is non-fatal when the owner lookup throws — still advances to ensure_compute', async () => {
    reg.controlPlanePool.mockImplementation(() => {
      throw new Error('control plane down')
    })
    const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
    await advanceProvisioningJob(
      job({ step: 'seed_settings', created_resources: { endpoint: 'ep' } }),
      new StubProvisioningProvider(0)
    )
    const p = patches().find(x => x.step === 'ensure_compute')
    expect(p?.created_resources?.settingsError).toMatch(/control plane down/)
  })
})

// ── ensure_compute — three compute modes ─────────────────────────────────────
describe('ensure_compute', () => {
  it('falls back to the shared TENANT_APP_TARGET_IP when EC2 is not configured', async () => {
    // No TENANT_APP_AMI_ID and no POOL_INSTANCE_ID → shared-target mode.
    const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
    await advanceProvisioningJob(
      job({ step: 'ensure_compute', created_resources: {} }),
      new StubProvisioningProvider(0)
    )
    const p = patches().find(x => x.step === 'setup_delhivery')
    expect(p?.created_resources).toMatchObject({ ec2Target: '203.0.113.10', computeMode: 'shared-target' })
    expect(reg.writeTenantEc2).toHaveBeenCalledWith('t-1', '203.0.113.10', undefined)
  })

  it('REFUSES to serve a tenant from the flagship app instance', async () => {
    process.env.TENANT_APP_TARGET_IP = '52.20.193.62'
    const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
    await advanceProvisioningJob(
      job({ step: 'ensure_compute', created_resources: {} }),
      new StubProvisioningProvider(0)
    )
    const failed = patches().find(x => x.status === 'failed')
    expect(failed?.last_error).toMatch(/compute blocked/i)
    expect(patches().find(x => x.step === 'setup_delhivery')).toBeUndefined()
  })

  it('provisions a DEDICATED EC2 for a higher-tier plan when EC2 is configured', async () => {
    process.env.TENANT_APP_AMI_ID = 'ami-1'
    reg.getTenant.mockResolvedValue({ ...TENANT, plan: 'growth' })
    const provider = new StubProvisioningProvider(0)
    const spy = vi.spyOn(provider, 'ensureAppInstance')
    const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
    await advanceProvisioningJob(job({ step: 'ensure_compute', created_resources: {} }), provider)
    expect(spy).toHaveBeenCalled()
    const p = patches().find(x => x.step === 'setup_delhivery')
    expect(p?.created_resources).toMatchObject({ computeMode: 'dedicated' })
    expect(p?.created_resources?.ec2InstanceId).toMatch(/^i-stub/)
  })

  it('does not re-launch a dedicated EC2 when one is already recorded', async () => {
    process.env.TENANT_APP_AMI_ID = 'ami-1'
    reg.getTenant.mockResolvedValue({ ...TENANT, plan: 'pro' })
    const provider = new StubProvisioningProvider(0)
    const spy = vi.spyOn(provider, 'ensureAppInstance')
    const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
    await advanceProvisioningJob(
      job({ step: 'ensure_compute', created_resources: { ec2InstanceId: 'i-existing', ec2Target: '9.9.9.9' } }),
      provider
    )
    expect(spy).not.toHaveBeenCalled()
  })

  it('uses the shared pool for a Basic plan when EC2 is configured', async () => {
    process.env.POOL_INSTANCE_ID = 'i-pool'
    const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
    await advanceProvisioningJob(
      job({ step: 'ensure_compute', created_resources: {} }),
      new StubProvisioningProvider(0)
    )
    expect(poolAuto.ensurePoolInstance).toHaveBeenCalled()
    const p = patches().find(x => x.step === 'setup_delhivery')
    expect(p?.created_resources).toMatchObject({ computeMode: 'pool', ec2Target: '10.0.0.9' })
  })

  it('does not persist an EC2 target when the resolved IP is empty', async () => {
    delete process.env.TENANT_APP_TARGET_IP // shared-target with empty IP
    process.env.TENANT_APP_TARGET_IP = '' // ec2Configured is false → shared-target=''
    const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
    await advanceProvisioningJob(
      job({ step: 'ensure_compute', created_resources: {} }),
      new StubProvisioningProvider(0)
    )
    expect(reg.writeTenantEc2).not.toHaveBeenCalled()
  })
})

// ── setup_delhivery — non-fatal pickup registration ──────────────────────────
describe('setup_delhivery', () => {
  it('registers the pickup location from the onboarding warehouse config', async () => {
    reg.controlPlanePool.mockReturnValue({ query: vi.fn().mockResolvedValue({ rows: [{ owner_id: 'o-1' }] }) })
    reg.getDraft.mockResolvedValue({
      data: {
        wh: {
          sellerPhone: '9876543210',
          originPincode: '600001',
          pickupLocation: 'WH1',
          sellerAddress: 'Addr',
          sellerName: 'Acme',
        },
      },
    })
    const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
    await advanceProvisioningJob(
      job({ step: 'setup_delhivery', created_resources: {} }),
      new StubProvisioningProvider(0)
    )
    expect(delhivery.createDelhiveryPickupLocation).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '9876543210', pincode: '600001', name: 'WH1' })
    )
    const p = patches().find(x => x.step === 'configure_dns')
    expect(p?.created_resources).toMatchObject({ delhiveryPickup: 'created' })
  })

  it('records an error string (not created) when Delhivery returns not-ok', async () => {
    reg.controlPlanePool.mockReturnValue({ query: vi.fn().mockResolvedValue({ rows: [{ owner_id: 'o-1' }] }) })
    reg.getDraft.mockResolvedValue({ data: { wh: { sellerPhone: '9876543210', originPincode: '600001' } } })
    delhivery.createDelhiveryPickupLocation.mockResolvedValue({ ok: false, error: 'dupe name' })
    const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
    await advanceProvisioningJob(
      job({ step: 'setup_delhivery', created_resources: {} }),
      new StubProvisioningProvider(0)
    )
    const p = patches().find(x => x.step === 'configure_dns')
    expect(p?.created_resources?.delhiveryPickup).toMatch(/error: dupe name/)
  })

  it('skips when there is no warehouse config', async () => {
    const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
    await advanceProvisioningJob(
      job({ step: 'setup_delhivery', created_resources: {} }),
      new StubProvisioningProvider(0)
    )
    expect(delhivery.createDelhiveryPickupLocation).not.toHaveBeenCalled()
    const p = patches().find(x => x.step === 'configure_dns')
    expect(p?.created_resources?.delhiveryPickup).toMatch(/skipped/)
  })

  it('is non-fatal when the lookup throws — still advances to configure_dns', async () => {
    reg.controlPlanePool.mockImplementation(() => {
      throw new Error('control plane down')
    })
    const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
    await advanceProvisioningJob(
      job({ step: 'setup_delhivery', created_resources: {} }),
      new StubProvisioningProvider(0)
    )
    const p = patches().find(x => x.step === 'configure_dns')
    expect(p?.created_resources?.delhiveryPickup).toMatch(/error:/)
  })
})

// ── rollbackProvisioning — teardown of a failed job's resources ──────────────
describe('rollbackProvisioning', () => {
  it('removes DNS, dedicated EC2, bucket, DB and reconciles the tenant to suspended', async () => {
    const provider = new StubProvisioningProvider(0)
    // Stand up resources so the removals are observable.
    await provider.ensureDns(['acme.jeffistores.in'])
    await provider.ensureBucket('jeffi-tenant-acme')
    const { instanceId } = await provider.ensureAppInstance({ name: 'x', instanceType: 't4g.small' })
    await provider.createDbInstance({ dbInstanceId: 'jeffi-tenant-acme', paramGroup: 'pg', maxConnections: 50 })

    reg.getProvisioningJob.mockResolvedValue(
      job({
        created_resources: {
          dnsHosts: ['acme.jeffistores.in'],
          ec2InstanceId: instanceId,
          bucket: 'jeffi-tenant-acme',
          dbInstanceId: 'jeffi-tenant-acme',
          paramGroup: 'pg',
        },
      })
    )
    const { rollbackProvisioning } = await import('@/lib/provisioning/steps')
    await rollbackProvisioning('t-1', provider)

    expect(provider.hasDns('acme.jeffistores.in')).toBe(false)
    expect(provider.hasInstance(instanceId)).toBe(false)
    expect(provider.hasBucket('jeffi-tenant-acme')).toBe(false)
    expect(reg.clearTenantInfra).toHaveBeenCalledWith('t-1')
    expect(reg.setTenantStatus).toHaveBeenCalledWith('t-1', 'suspended')
    expect(lastPatch()).toMatchObject({ status: 'failed', last_error: 'rolled back' })
  })

  it('derives hostnames from the slug when the job did not record any', async () => {
    const provider = new StubProvisioningProvider(0)
    await provider.ensureDns(['acme.jeffistores.in'])
    reg.getProvisioningJob.mockResolvedValue(job({ created_resources: {} }))
    const remove = vi.spyOn(provider, 'removeDns')
    const { rollbackProvisioning } = await import('@/lib/provisioning/steps')
    await rollbackProvisioning('t-1', provider)
    // Derived from tenantHostnames(slug, plan) — includes the storefront host.
    expect(remove).toHaveBeenCalledWith(expect.arrayContaining(['acme.jeffistores.in']))
  })

  it('handles a missing job/tenant without throwing (no hosts to remove)', async () => {
    reg.getProvisioningJob.mockResolvedValue(null)
    reg.getTenant.mockResolvedValue(null)
    const provider = new StubProvisioningProvider(0)
    const remove = vi.spyOn(provider, 'removeDns')
    const { rollbackProvisioning } = await import('@/lib/provisioning/steps')
    await expect(rollbackProvisioning('t-1', provider)).resolves.toBeUndefined()
    expect(remove).not.toHaveBeenCalled()
    expect(reg.setTenantStatus).toHaveBeenCalledWith('t-1', 'suspended')
  })
})

// ── deprovision: pool reclaim + already-active-tenant path ───────────────────
describe('deprovisionTenant — pool reclaim branch', () => {
  it('reclaims the shared pool (deletePoolIfEmpty) for a Basic tenant with no dedicated EC2', async () => {
    reg.getTenant.mockResolvedValue({ ...TENANT, rds_endpoint: null })
    const { deprovisionTenant } = await import('@/lib/provisioning/steps')
    const out = await deprovisionTenant('t-1', new StubProvisioningProvider(0), { ownerId: 'o-1' })
    expect(out.ok).toBe(true)
    expect(poolAuto.deletePoolIfEmpty).toHaveBeenCalled()
  })

  it('terminates a dedicated EC2 instead of touching the pool when one was recorded', async () => {
    reg.getTenant.mockResolvedValue({ ...TENANT, rds_endpoint: null })
    const provider = new StubProvisioningProvider(0)
    const { instanceId } = await provider.ensureAppInstance({ name: 'x', instanceType: 't4g.small' })
    reg.getProvisioningJob.mockResolvedValue(job({ created_resources: { ec2InstanceId: instanceId } }))
    const del = vi.spyOn(provider, 'deleteAppInstance')
    const { deprovisionTenant } = await import('@/lib/provisioning/steps')
    await deprovisionTenant('t-1', provider, {})
    expect(del).toHaveBeenCalledWith(instanceId)
    expect(poolAuto.deletePoolIfEmpty).not.toHaveBeenCalled()
  })
})
