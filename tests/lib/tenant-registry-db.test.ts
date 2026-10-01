/**
 * Tests for the DATABASE-backed half of src/lib/tenant-registry.ts.
 *
 * The pure host-parsing logic is covered in tenant-registry.test.ts; this file
 * mocks pg and exercises the control-plane pool construction, the provisioning
 * job persistence layer, tenant/infra mutations, the drift sweep, custom-domain
 * validation, and the host-resolution cache.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// pg mock — Pool must be a real constructor (`new Pool(cfg)` is called in src).
// ---------------------------------------------------------------------------
const poolQuery = vi.fn()
const poolOn = vi.fn()
const capturedConfigs: any[] = []
function PoolCtor(this: any, config: any) {
  capturedConfigs.push(config)
  this.query = poolQuery
  this.on = poolOn
}
vi.mock('pg', () => ({ Pool: PoolCtor, default: { Pool: PoolCtor } }))
vi.mock('@aws-sdk/rds-signer', () => ({
  Signer: vi.fn().mockImplementation(function (this: any) {
    this.getAuthToken = vi.fn().mockResolvedValue('iam-token')
  }),
}))
vi.mock('fs', () => {
  const existsSync = vi.fn().mockReturnValue(false)
  const readFileSync = vi.fn().mockReturnValue('CERT')
  return { default: { existsSync, readFileSync }, existsSync, readFileSync }
})

/** Queue the next pool.query results, in order. */
function queueRows(...results: Array<{ rows?: any[]; rowCount?: number }>) {
  poolQuery.mockReset()
  for (const r of results) {
    poolQuery.mockResolvedValueOnce({ rows: r.rows ?? [], rowCount: r.rowCount ?? r.rows?.length ?? 0 })
  }
  poolQuery.mockResolvedValue({ rows: [], rowCount: 0 })
}

async function importRegistry() {
  vi.resetModules()
  // The control-plane pool is cached on globalThis for hot-reload safety; clear it
  // so each test builds a fresh pool against the env under test.
  delete (globalThis as any).__cpPool
  capturedConfigs.length = 0
  return import('@/lib/tenant-registry')
}

describe('tenant-registry (database layer)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    poolQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    process.env.CONTROL_PLANE_DATABASE_URL = 'postgres://localhost/jeffi_control_plane'
    delete process.env.CONTROL_PLANE_IAM_AUTH
  })
  afterEach(() => {
    delete process.env.CONTROL_PLANE_DATABASE_URL
    delete process.env.CONTROL_PLANE_IAM_AUTH
    delete (globalThis as any).__cpPool
  })

  // -------------------------------------------------------------------------
  describe('controlPlanePool', () => {
    it('uses the configured connection string', async () => {
      const { controlPlanePool } = await importRegistry()
      controlPlanePool()
      expect(capturedConfigs[0].connectionString).toBe('postgres://localhost/jeffi_control_plane')
    })

    it('returns the SAME pool on subsequent calls (cached on globalThis)', async () => {
      const { controlPlanePool } = await importRegistry()
      const a = controlPlanePool()
      const b = controlPlanePool()
      expect(a).toBe(b)
      expect(capturedConfigs).toHaveLength(1)
    })

    it('registers an idle-error handler so the pool self-heals', async () => {
      const { controlPlanePool } = await importRegistry()
      controlPlanePool()
      expect(poolOn).toHaveBeenCalledWith('error', expect.any(Function))
    })

    it('throws a clear error when nothing is configured', async () => {
      delete process.env.CONTROL_PLANE_DATABASE_URL
      const savedDb = process.env.DATABASE_URL
      delete process.env.DATABASE_URL
      const { controlPlanePool } = await importRegistry()
      expect(() => controlPlanePool()).toThrow(/Control-plane DB not configured/)
      if (savedDb) process.env.DATABASE_URL = savedDb
    })

    it('derives a local control-plane URL from DATABASE_URL outside production', async () => {
      delete process.env.CONTROL_PLANE_DATABASE_URL
      const saved = process.env.DATABASE_URL
      process.env.DATABASE_URL = 'postgres://user@localhost:5432/jeffi_production_ready'
      const { controlPlanePool } = await importRegistry()
      controlPlanePool()
      expect(capturedConfigs[0].connectionString).toContain('/jeffi_control_plane')
      if (saved) process.env.DATABASE_URL = saved
      else delete process.env.DATABASE_URL
    })

    it('builds an IAM-auth config when CONTROL_PLANE_IAM_AUTH=true', async () => {
      delete process.env.CONTROL_PLANE_DATABASE_URL
      process.env.CONTROL_PLANE_IAM_AUTH = 'true'
      process.env.CONTROL_PLANE_RDS_HOST = 'cp.rds.amazonaws.com'
      const { controlPlanePool } = await importRegistry()
      controlPlanePool()
      expect(capturedConfigs[0].host).toBe('cp.rds.amazonaws.com')
      expect(capturedConfigs[0].database).toBe('jeffi_control_plane')
      // password is a callback so a fresh IAM token is signed per connection
      expect(typeof capturedConfigs[0].password).toBe('function')
      delete process.env.CONTROL_PLANE_RDS_HOST
    })
  })

  // -------------------------------------------------------------------------
  describe('reconcileOrphanedTenants — the drift sweep', () => {
    it('returns the ids it suspended', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 't-1' }, { id: 't-2' }], rowCount: 2 })
      await expect(mod.reconcileOrphanedTenants()).resolves.toEqual(['t-1', 't-2'])
    })

    it('returns an empty list when nothing has drifted', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [], rowCount: 0 })
      await expect(mod.reconcileOrphanedTenants()).resolves.toEqual([])
    })

    it('only targets ACTIVE tenants that have no rds_endpoint', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [], rowCount: 0 })
      await mod.reconcileOrphanedTenants()
      const sql = String(poolQuery.mock.calls[0][0])
      expect(sql).toMatch(/status='suspended'/)
      expect(sql).toMatch(/t\.status='active'/)
      expect(sql).toMatch(/rds_endpoint IS NOT NULL/)
    })
  })

  // -------------------------------------------------------------------------
  describe('addCustomDomain validation', () => {
    it('rejects a malformed domain before touching the database', async () => {
      const mod = await importRegistry()
      await expect(mod.addCustomDomain('t-1', 'not a domain')).resolves.toEqual({
        ok: false,
        error: 'Invalid domain format',
      })
    })

    it('rejects a jeffistores.in subdomain', async () => {
      const mod = await importRegistry()
      await expect(mod.addCustomDomain('t-1', 'acme.jeffistores.in')).resolves.toEqual({
        ok: false,
        error: 'Cannot use a jeffistores.in subdomain as a custom domain',
      })
    })

    it('strips scheme and path before validating', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ max: 3, used: 0 }] }, { rows: [] }, { rows: [{ id: 'd-1', domain: 'shop.acme.com' }] })
      const out = await mod.addCustomDomain('t-1', 'https://shop.acme.com/path')
      expect(out.ok).toBe(true)
    })

    it('refuses when the plan allows no custom domains', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ max: 0, used: 0 }] })
      await expect(mod.addCustomDomain('t-1', 'shop.acme.com')).resolves.toEqual({
        ok: false,
        error: 'Custom domains are available on Pro plan and above',
      })
    })

    it('refuses once the plan quota is used up', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ max: 2, used: 2 }] })
      const out: any = await mod.addCustomDomain('t-1', 'shop.acme.com')
      expect(out.ok).toBe(false)
      expect(out.error).toMatch(/Domain limit reached \(2/)
    })

    it('refuses a domain that is already registered', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ max: 5, used: 1 }] }, { rows: [{ exists: 1 }] })
      await expect(mod.addCustomDomain('t-1', 'shop.acme.com')).resolves.toEqual({
        ok: false,
        error: 'This domain is already registered',
      })
    })

    it('inserts with a verification token on success', async () => {
      const mod = await importRegistry()
      queueRows(
        { rows: [{ max: 5, used: 0 }] },
        { rows: [] },
        { rows: [{ id: 'd-1', domain: 'shop.acme.com', status: 'pending' }] }
      )
      const out: any = await mod.addCustomDomain('t-1', 'shop.acme.com')
      expect(out.ok).toBe(true)
      const insertArgs = poolQuery.mock.calls[2][1]
      expect(insertArgs[1]).toBe('shop.acme.com')
      expect(String(insertArgs[2])).toMatch(/^jeffi-verify-/)
    })
  })

  // -------------------------------------------------------------------------
  describe('provisioning job persistence', () => {
    it('enqueueProvisioning inserts a job when none is in flight', async () => {
      const mod = await importRegistry()
      // 1st query = "is a job already pending/running?", 2nd = the INSERT
      queueRows({ rows: [] }, { rows: [{ id: 'job-1', step: 'preflight', status: 'pending' }] })
      await expect(mod.enqueueProvisioning('t-1')).resolves.toMatchObject({ id: 'job-1' })
      expect(String(poolQuery.mock.calls[1][0])).toMatch(/INSERT INTO provisioning_jobs/i)
    })

    it('enqueueProvisioning REUSES an in-flight job instead of creating a duplicate', async () => {
      // Critical: a second INSERT would mean a second provisioning run for the same
      // tenant — i.e. a second billable RDS instance.
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'job-existing', status: 'running' }] })
      await expect(mod.enqueueProvisioning('t-1')).resolves.toMatchObject({ id: 'job-existing' })
      expect(poolQuery).toHaveBeenCalledTimes(1) // no INSERT issued
    })

    it('enqueueProvisioning carries a restoreFromKey through to the job', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] }, { rows: [{ id: 'job-1' }] })
      await mod.enqueueProvisioning('t-1', { restoreFromKey: 'backups/acme.sql.gz' })
      expect(JSON.stringify(poolQuery.mock.calls[1][1])).toContain('backups/acme.sql.gz')
    })

    it('getProvisioningJob returns the newest job, or null', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'job-9' }] })
      await expect(mod.getProvisioningJob('t-1')).resolves.toMatchObject({ id: 'job-9' })

      queueRows({ rows: [] })
      await expect(mod.getProvisioningJob('t-1')).resolves.toBeNull()
    })

    it('updateProvisioningJob patches ONLY the supplied fields', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.updateProvisioningJob('job-1', { step: 'create_bucket', status: 'pending' })
      const sql = String(poolQuery.mock.calls[0][0])
      expect(sql).toMatch(/step=\$1/)
      expect(sql).toMatch(/status=\$2/)
      expect(sql).not.toMatch(/last_error=/)
    })

    it('updateProvisioningJob increments attempts when asked', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.updateProvisioningJob('job-1', { bumpAttempts: true })
      expect(String(poolQuery.mock.calls[0][0])).toMatch(/attempts = attempts \+ 1/)
    })

    it('updateProvisioningJob clears the backoff timer on a clean transition', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.updateProvisioningJob('job-1', { clearNextAttempt: true })
      expect(String(poolQuery.mock.calls[0][0])).toMatch(/next_attempt_at = NULL/)
    })

    it('updateProvisioningJob records next_attempt_at for a backoff', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      const when = new Date(Date.now() + 30_000)
      await mod.updateProvisioningJob('job-1', { nextAttemptAt: when })
      expect(String(poolQuery.mock.calls[0][0])).toMatch(/next_attempt_at=\$/)
      expect(poolQuery.mock.calls[0][1]).toContain(when.toISOString())
    })

    it('updateProvisioningJob serialises created_resources as jsonb', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.updateProvisioningJob('job-1', { created_resources: { bucket: 'b-1' } })
      expect(String(poolQuery.mock.calls[0][0])).toMatch(/created_resources=\$1::jsonb/)
      expect(poolQuery.mock.calls[0][1][0]).toBe(JSON.stringify({ bucket: 'b-1' }))
    })

    it('activeProvisioningJobs respects the backoff timer', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'job-1' }] })
      await mod.activeProvisioningJobs()
      expect(String(poolQuery.mock.calls[0][0])).toMatch(/next_attempt_at/)
    })
  })

  // -------------------------------------------------------------------------
  describe('tenant + infra mutations', () => {
    it('setTenantStatus updates the row', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.setTenantStatus('t-1', 'active')
      expect(poolQuery.mock.calls[0][1]).toEqual(expect.arrayContaining(['active', 't-1']))
    })

    it('writeTenantInfra persists endpoint + bucket', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.writeTenantInfra('t-1', { rdsEndpoint: 'ep-1', s3Bucket: 'b-1' })
      expect(poolQuery.mock.calls[0][1]).toEqual(expect.arrayContaining(['t-1', 'ep-1', 'b-1']))
    })

    it('clearTenantInfra nulls the pointers so nothing routes at deleted infra', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.clearTenantInfra('t-1')
      expect(String(poolQuery.mock.calls[0][0])).toMatch(/rds_endpoint\s*=\s*NULL/i)
    })

    it('saveLinkedAccountId stores the Razorpay Route account', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.saveLinkedAccountId('t-1', 'acc_123')
      expect(poolQuery.mock.calls[0][1]).toEqual(expect.arrayContaining(['acc_123', 't-1']))
    })

    it('getTenantBySubscriptionId returns null when unknown', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await expect(mod.getTenantBySubscriptionId('sub_missing')).resolves.toBeNull()
    })

    it('getTenantBySubscriptionId returns the tenant when found', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 't-1', slug: 'acme', status: 'active' }] })
      await expect(mod.getTenantBySubscriptionId('sub_1')).resolves.toMatchObject({ slug: 'acme' })
    })

    it('getTenant returns null for an unknown id', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await expect(mod.getTenant('nope')).resolves.toBeNull()
    })

    it('setTenantInstanceState records running/stopped', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.setTenantInstanceState('t-1', 'stopped')
      expect(poolQuery.mock.calls[0][1]).toEqual(expect.arrayContaining(['stopped', 't-1']))
    })
  })

  // -------------------------------------------------------------------------
  describe('owners + bank verification', () => {
    it('getOwnerById returns null when absent', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await expect(mod.getOwnerById('o-1')).resolves.toBeNull()
    })

    it('hasVerifiedBank is false with no verified account', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await expect(mod.hasVerifiedBank('o-1')).resolves.toBe(false)
    })

    it('getOwnerBankAccount returns null when absent', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await expect(mod.getOwnerBankAccount('o-1')).resolves.toBeNull()
    })

    it('getDraft returns null when the owner has no draft', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await expect(mod.getDraft('o-1')).resolves.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  describe('host resolution cache', () => {
    it('caches a resolved host so a repeat lookup does not re-query', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 't-1', slug: 'acme', status: 'active', rds_endpoint: 'ep' }] })
      await mod.resolveTenantFromHost('acme.jeffistores.in')
      const afterFirst = poolQuery.mock.calls.length
      await mod.resolveTenantFromHost('acme.jeffistores.in')
      expect(poolQuery.mock.calls.length).toBe(afterFirst)
    })

    it('clearTenantCache forces the next lookup back to the database', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 't-1', slug: 'acme', status: 'active', rds_endpoint: 'ep' }] })
      await mod.resolveTenantFromHost('acme.jeffistores.in')
      const afterFirst = poolQuery.mock.calls.length
      mod.clearTenantCache()
      await mod.resolveTenantFromHost('acme.jeffistores.in')
      expect(poolQuery.mock.calls.length).toBeGreaterThan(afterFirst)
    })

    it('a platform host resolves to null without any query at all', async () => {
      const mod = await importRegistry()
      poolQuery.mockClear()
      await expect(mod.resolveTenantFromHost('jeffistores.in')).resolves.toBeNull()
      expect(poolQuery).not.toHaveBeenCalled()
    })
  })
})
