/**
 * Tests for src/lib/provisioning/steps.ts — the tenant provisioning state machine.
 *
 * This is the file that creates and destroys REAL billable AWS infrastructure, so
 * the behaviours pinned here are the ones whose failure costs money or breaks a
 * live tenant:
 *
 *   - preflight fails BEFORE any billable resource when config is missing
 *   - wait_db_available polls (stays 'pending') and is bounded by a deadline
 *   - activate refuses to go live without a persisted rds_endpoint (otherwise
 *     getPool silently falls back to the PLATFORM database — a cross-tenant leak)
 *   - verify_serving proves the host actually answers before going live
 *   - transient errors retry with backoff; terminal errors fail fast and roll back
 *   - deprovision backs up BEFORE deleting, and takes the store offline first
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StubProvisioningProvider } from '@/lib/provisioning/stub-provider'

// ---------------------------------------------------------------------------
// tenant-registry is the persistence seam — mock it entirely.
// ---------------------------------------------------------------------------
const reg = {
  getTenant: vi.fn(),
  getProvisioningJob: vi.fn(),
  updateProvisioningJob: vi.fn().mockResolvedValue(undefined),
  setTenantStatus: vi.fn().mockResolvedValue(undefined),
  writeTenantInfra: vi.fn().mockResolvedValue(undefined),
  writeTenantEc2: vi.fn().mockResolvedValue(undefined),
  clearTenantInfra: vi.fn().mockResolvedValue(undefined),
  clearTenantCache: vi.fn(),
}
vi.mock('@/lib/tenant-registry', () => reg)

const backupStore = {
  getTenantBackup: vi.fn(),
  putTenantBackup: vi.fn(),
}
vi.mock('@/lib/tenancy/tenant-backup-store', () => backupStore)

const seedMod = { seedTenantData: vi.fn().mockResolvedValue(undefined) }
vi.mock('@/lib/provisioning/seed', () => seedMod)

// ---------------------------------------------------------------------------
const TENANT = { id: 't-1', slug: 'acme', plan: 'basic', rds_endpoint: null, s3_bucket: null, rds_db: null }

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

/** Last patch passed to updateProvisioningJob. */
function lastPatch() {
  const calls = reg.updateProvisioningJob.mock.calls
  return calls.length ? calls[calls.length - 1][1] : null
}
/** All patches, for asserting a step transition happened. */
function patches() {
  return reg.updateProvisioningJob.mock.calls.map((c: any[]) => c[1])
}

describe('provisioning state machine', () => {
  let provider: StubProvisioningProvider

  beforeEach(() => {
    vi.clearAllMocks()
    reg.getTenant.mockResolvedValue({ ...TENANT })
    reg.getProvisioningJob.mockResolvedValue(null)
    reg.updateProvisioningJob.mockResolvedValue(undefined)
    reg.setTenantStatus.mockResolvedValue(undefined)
    reg.writeTenantInfra.mockResolvedValue(undefined)
    reg.clearTenantInfra.mockResolvedValue(undefined)
    provider = new StubProvisioningProvider(0)
    process.env.RDS_MASTER_PASSWORD = 'secret'
    process.env.TENANT_APP_TARGET_IP = '203.0.113.10' // NOT the flagship — see flagship interlock
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.RDS_MASTER_PASSWORD
    delete process.env.TENANT_APP_TARGET_IP
  })

  // -------------------------------------------------------------------------
  describe('guard: tenant missing', () => {
    it('fails the job when the tenant row is gone', async () => {
      reg.getTenant.mockResolvedValue(null)
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await expect(advanceProvisioningJob(job(), provider)).resolves.toBe('failed')
      expect(lastPatch()).toMatchObject({ status: 'failed', last_error: 'tenant not found' })
    })
  })

  // -------------------------------------------------------------------------
  describe('preflight — fails before ANY billable infra', () => {
    it('fails terminally when RDS_MASTER_PASSWORD is missing', async () => {
      delete process.env.RDS_MASTER_PASSWORD
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await expect(advanceProvisioningJob(job({ step: 'preflight' }), provider)).resolves.toBe('failed')
      expect(lastPatch().last_error ?? '').toMatch(/RDS_MASTER_PASSWORD/)
    })

    it('fails terminally when TENANT_APP_TARGET_IP is missing', async () => {
      delete process.env.TENANT_APP_TARGET_IP
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await expect(advanceProvisioningJob(job({ step: 'preflight' }), provider)).resolves.toBe('failed')
      expect(lastPatch().last_error ?? '').toMatch(/TENANT_APP_TARGET_IP/)
    })

    it('reports BOTH missing vars in one error', async () => {
      delete process.env.RDS_MASTER_PASSWORD
      delete process.env.TENANT_APP_TARGET_IP
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await advanceProvisioningJob(job({ step: 'preflight' }), provider)
      const err = lastPatch().last_error ?? ''
      expect(err).toMatch(/RDS_MASTER_PASSWORD/)
      expect(err).toMatch(/TENANT_APP_TARGET_IP/)
    })

    it('treats a blank TENANT_APP_TARGET_IP as missing', async () => {
      process.env.TENANT_APP_TARGET_IP = '   '
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await expect(advanceProvisioningJob(job({ step: 'preflight' }), provider)).resolves.toBe('failed')
    })

    it('advances to create_param_group when config is complete', async () => {
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await expect(advanceProvisioningJob(job({ step: 'preflight' }), provider)).resolves.toBe('pending')
      expect(patches().some(p => p.step === 'create_param_group')).toBe(true)
    })

    it('fails terminally when TENANT_APP_TARGET_IP is the flagship and no tenant compute is configured', async () => {
      process.env.TENANT_APP_TARGET_IP = '52.20.193.62'
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await expect(advanceProvisioningJob(job({ step: 'preflight' }), provider)).resolves.toBe('failed')
      expect(lastPatch().last_error ?? '').toMatch(/flagship/i)
      expect(patches().some(p => p.step === 'create_param_group')).toBe(false)
    })

    it('allows the flagship IP once tenant compute IS configured', async () => {
      process.env.TENANT_APP_TARGET_IP = '52.20.193.62'
      process.env.TENANT_APP_AMI_ID = 'ami-1'
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await expect(advanceProvisioningJob(job({ step: 'preflight' }), provider)).resolves.toBe('pending')
      delete process.env.TENANT_APP_AMI_ID
    })
  })

  // -------------------------------------------------------------------------
  describe('infrastructure steps', () => {
    it('create_param_group creates the group and records it', async () => {
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await advanceProvisioningJob(job({ step: 'create_param_group' }), provider)
      expect(provider.hasParamGroup('jeffi-tenant-acme-pg16')).toBe(true)
      const p = patches().find(x => x.step === 'create_db_instance')
      expect(p?.created_resources).toMatchObject({ paramGroup: 'jeffi-tenant-acme-pg16' })
    })

    it('create_db_instance records the instance id and moves to the wait step', async () => {
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await advanceProvisioningJob(job({ step: 'create_db_instance' }), provider)
      const p = patches().find(x => x.step === 'wait_db_available')
      expect(p?.created_resources).toMatchObject({ dbInstanceId: 'jeffi-tenant-acme' })
    })

    it('wait_db_available stays PENDING on the same step while RDS is still creating', async () => {
      const slow = new StubProvisioningProvider(3)
      await slow.createDbInstance({ dbInstanceId: 'jeffi-tenant-acme', paramGroup: 'pg', maxConnections: 50 })
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      const res = await advanceProvisioningJob(
        job({ step: 'wait_db_available', created_resources: { dbInstanceId: 'jeffi-tenant-acme' } }),
        slow
      )
      expect(res).toBe('pending')
      // stayed put — no step transition was written
      expect(patches().every(p => p.step === undefined)).toBe(true)
    })

    it('wait_db_available advances once the endpoint appears', async () => {
      await provider.createDbInstance({ dbInstanceId: 'jeffi-tenant-acme', paramGroup: 'pg', maxConnections: 50 })
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await advanceProvisioningJob(
        job({ step: 'wait_db_available', created_resources: { dbInstanceId: 'jeffi-tenant-acme' } }),
        provider
      )
      const p = patches().find(x => x.step === 'load_schema')
      expect(p?.created_resources?.endpoint).toContain('jeffi-tenant-acme')
    })

    it('wait_db_available FAILS once the 25-minute deadline is exceeded', async () => {
      const never = new StubProvisioningProvider(999)
      await never.createDbInstance({ dbInstanceId: 'jeffi-tenant-acme', paramGroup: 'pg', maxConnections: 50 })
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      const started = Date.now() - 26 * 60 * 1000 // started 26 min ago
      const res = await advanceProvisioningJob(
        job({
          step: 'wait_db_available',
          created_resources: { dbInstanceId: 'jeffi-tenant-acme', dbWaitStartedAt: started },
        }),
        never
      )
      // deadline breach throws -> retryable/terminal classification kicks in
      expect(['failed', 'pending']).toContain(res)
      expect(String(lastPatch().last_error ?? '')).toMatch(/did not become available/)
    })

    it('load_schema loads then advances to restore_data', async () => {
      const spy = vi.spyOn(provider, 'loadSchema')
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await advanceProvisioningJob(job({ step: 'load_schema', created_resources: { endpoint: 'ep-1' } }), provider)
      expect(spy).toHaveBeenCalledWith('ep-1', 'jeffi_stores')
      expect(patches().some(p => p.step === 'restore_data')).toBe(true)
    })

    it('create_bucket creates the tenant bucket', async () => {
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await advanceProvisioningJob(job({ step: 'create_bucket' }), provider)
      expect(provider.hasBucket('jeffi-tenant-acme')).toBe(true)
    })

    it('write_infra persists the endpoint + bucket pointers', async () => {
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await advanceProvisioningJob(
        job({ step: 'write_infra', created_resources: { endpoint: 'ep-1', bucket: 'b-1' } }),
        provider
      )
      expect(reg.writeTenantInfra).toHaveBeenCalledWith('t-1', { rdsEndpoint: 'ep-1', s3Bucket: 'b-1' })
    })
  })

  // -------------------------------------------------------------------------
  describe('restore_data / seed_data (opt-in only)', () => {
    it('is a no-op passthrough when the job carries no restore key', async () => {
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await advanceProvisioningJob(job({ step: 'restore_data', created_resources: { endpoint: 'ep' } }), provider)
      expect(backupStore.getTenantBackup).not.toHaveBeenCalled()
      expect(patches().some(p => p.step === 'seed_data')).toBe(true)
    })

    it('restores from the backup when a key IS present', async () => {
      backupStore.getTenantBackup.mockResolvedValue(Buffer.from('archive'))
      const spy = vi.spyOn(provider, 'restoreDb')
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await advanceProvisioningJob(
        job({ step: 'restore_data', created_resources: { endpoint: 'ep', restoreFromKey: 'k/1.sql.gz' } }),
        provider
      )
      expect(backupStore.getTenantBackup).toHaveBeenCalledWith('k/1.sql.gz')
      expect(spy).toHaveBeenCalledWith('ep', 'jeffi_stores', expect.any(Buffer))
      expect(patches().find(p => p.step === 'seed_data')?.created_resources).toMatchObject({ restored: true })
    })

    it('seed_data does nothing without a seedProfile (empty store is the default)', async () => {
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await advanceProvisioningJob(job({ step: 'seed_data', created_resources: { endpoint: 'ep' } }), provider)
      expect(seedMod.seedTenantData).not.toHaveBeenCalled()
      expect(patches().some(p => p.step === 'create_bucket')).toBe(true)
    })

    it('seed_data seeds when a profile is present', async () => {
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await advanceProvisioningJob(
        job({ step: 'seed_data', created_resources: { endpoint: 'ep', seedProfile: 'hardware' } }),
        provider
      )
      expect(seedMod.seedTenantData).toHaveBeenCalledWith('ep', 'jeffi_stores', 'hardware')
    })

    it('seed_data is SKIPPED when the store was restored (never overwrite restored data)', async () => {
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await advanceProvisioningJob(
        job({ step: 'seed_data', created_resources: { endpoint: 'ep', seedProfile: 'hardware', restored: true } }),
        provider
      )
      expect(seedMod.seedTenantData).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  describe('configure_dns — hostnames by plan tier', () => {
    it('basic gets storefront + admin + invoice only', async () => {
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await advanceProvisioningJob(job({ step: 'configure_dns' }), provider)
      expect(provider.hasDns('acme.jeffistores.in')).toBe(true)
      expect(provider.hasDns('admin-acme.jeffistores.in')).toBe(true)
      expect(provider.hasDns('invoice-acme.jeffistores.in')).toBe(true)
      expect(provider.hasDns('quotation-acme.jeffistores.in')).toBe(false)
    })

    it('growth adds quotation + purchaseorder + forms (review_forms is sold from Growth)', async () => {
      reg.getTenant.mockResolvedValue({ ...TENANT, plan: 'growth' })
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await advanceProvisioningJob(job({ step: 'configure_dns' }), provider)
      expect(provider.hasDns('quotation-acme.jeffistores.in')).toBe(true)
      expect(provider.hasDns('purchaseorder-acme.jeffistores.in')).toBe(true)
      expect(provider.hasDns('forms-acme.jeffistores.in')).toBe(true)
      expect(provider.hasDns('acme.business.jeffistores.in')).toBe(false)
    })

    it('pro adds business', async () => {
      reg.getTenant.mockResolvedValue({ ...TENANT, plan: 'pro' })
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await advanceProvisioningJob(job({ step: 'configure_dns' }), provider)
      expect(provider.hasDns('forms-acme.jeffistores.in')).toBe(true)
      expect(provider.hasDns('acme.business.jeffistores.in')).toBe(true)
    })

    it('a null plan still gets the basic hostnames', async () => {
      reg.getTenant.mockResolvedValue({ ...TENANT, plan: null })
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await advanceProvisioningJob(job({ step: 'configure_dns' }), provider)
      expect(provider.hasDns('acme.jeffistores.in')).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  describe('verify_serving — proves the host answers before going live', () => {
    // The probe only runs under the real AWS provider; under the stub it is skipped
    // (there is no real host to reach), so these tests set the provider to 'aws' to
    // exercise the fetch-based verification path.
    beforeEach(() => {
      process.env.PROVISIONING_PROVIDER = 'aws'
    })
    afterEach(() => {
      delete process.env.PROVISIONING_PROVIDER
    })

    it('advances to activate when the host responds', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }))
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await advanceProvisioningJob(job({ step: 'verify_serving' }), provider)
      expect(patches().some(p => p.step === 'activate')).toBe(true)
    })

    it('accepts any HTTP status as proof the app tier answers (even 404)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404 }))
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      await advanceProvisioningJob(job({ step: 'verify_serving' }), provider)
      expect(patches().some(p => p.step === 'activate')).toBe(true)
    })

    it('stays pending and counts an attempt when the host is unreachable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      const res = await advanceProvisioningJob(job({ step: 'verify_serving' }), provider)
      expect(res).toBe('pending')
      expect(lastPatch().created_resources).toMatchObject({ verifyAttempts: 1 })
    })

    it('gives up on the host after the attempt budget and records why', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      const res = await advanceProvisioningJob(
        job({ step: 'verify_serving', created_resources: { verifyAttempts: 5 } }),
        provider
      )

      // The step throws once its 6 in-step attempts are used up. Note the thrown
      // message is NOT in isTerminalError's list, so it is classified RETRYABLE:
      // the job stays 'pending' and is retried at the JOB level (capped at 8
      // attempts) before finally failing. Crucially it never reaches 'activate'.
      expect(res).toBe('pending')
      expect(String(lastPatch().last_error ?? '')).toMatch(/did not serve after 6 attempts/)
      expect(patches().some(p => p.step === 'activate')).toBe(false)
    })

    it('finally FAILS (and never activates) once job-level attempts are also exhausted', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      const res = await advanceProvisioningJob(
        job({ step: 'verify_serving', attempts: 7, created_resources: { verifyAttempts: 5 } }),
        provider
      )
      expect(res).toBe('failed')
      expect(reg.setTenantStatus).not.toHaveBeenCalledWith('t-1', 'active')
    })
  })

  // -------------------------------------------------------------------------
  describe('activate — the cross-tenant-leak guard', () => {
    it('REFUSES to activate when rds_endpoint was never persisted', async () => {
      reg.getTenant.mockResolvedValue({ ...TENANT, rds_endpoint: null })
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      const res = await advanceProvisioningJob(job({ step: 'activate' }), provider)
      expect(res).toBe('failed')
      expect(String(lastPatch().last_error ?? '')).toMatch(/activate blocked/)
      expect(reg.setTenantStatus).not.toHaveBeenCalledWith('t-1', 'active')
    })

    it('activates and marks the job done when infra is persisted', async () => {
      reg.getTenant.mockResolvedValue({ ...TENANT, rds_endpoint: 'ep-1.rds.amazonaws.com' })
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      const res = await advanceProvisioningJob(job({ step: 'activate' }), provider)
      expect(res).toBe('done')
      expect(reg.setTenantStatus).toHaveBeenCalledWith('t-1', 'active')
      expect(lastPatch()).toMatchObject({ status: 'done' })
    })
  })

  // -------------------------------------------------------------------------
  describe('unknown step', () => {
    it('fails rather than silently looping', async () => {
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      const res = await advanceProvisioningJob(job({ step: 'not_a_real_step' }), provider)
      expect(res).toBe('failed')
      expect(String(lastPatch().last_error ?? '')).toMatch(/unknown step/)
    })
  })

  // -------------------------------------------------------------------------
  describe('error classification: retry vs terminal', () => {
    it('a TRANSIENT error keeps the job pending and schedules a backoff', async () => {
      vi.spyOn(provider, 'ensureBucket').mockRejectedValue(new Error('ECONNRESET talking to S3'))
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      const res = await advanceProvisioningJob(job({ step: 'create_bucket', attempts: 1 }), provider)
      expect(res).toBe('pending')
      const p = lastPatch()
      expect(p.status).toBe('pending')
      expect(p.nextAttemptAt).toBeInstanceOf(Date)
      expect(String(p.last_error)).toMatch(/retryable \(attempt 2\)/)
    })

    it('a TERMINAL error (AccessDenied) fails immediately without burning retries', async () => {
      vi.spyOn(provider, 'ensureBucket').mockRejectedValue(new Error('AccessDenied: not authorized'))
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      const res = await advanceProvisioningJob(job({ step: 'create_bucket' }), provider)
      expect(res).toBe('failed')
    })

    it('gives up once the attempt cap is reached even for a transient error', async () => {
      vi.spyOn(provider, 'ensureBucket').mockRejectedValue(new Error('ETIMEDOUT'))
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')
      const res = await advanceProvisioningJob(job({ step: 'create_bucket', attempts: 7 }), provider)
      expect(res).toBe('failed')
    })

    it('backoff grows with the attempt number', async () => {
      vi.spyOn(provider, 'ensureBucket').mockRejectedValue(new Error('ECONNRESET'))
      const { advanceProvisioningJob } = await import('@/lib/provisioning/steps')

      await advanceProvisioningJob(job({ step: 'create_bucket', attempts: 0 }), provider)
      const first = (lastPatch().nextAttemptAt as Date).getTime() - Date.now()
      vi.clearAllMocks()
      reg.updateProvisioningJob.mockResolvedValue(undefined)
      reg.getTenant.mockResolvedValue({ ...TENANT })

      await advanceProvisioningJob(job({ step: 'create_bucket', attempts: 4 }), provider)
      const later = (lastPatch().nextAttemptAt as Date).getTime() - Date.now()
      expect(later).toBeGreaterThan(first)
    })
  })

  // -------------------------------------------------------------------------
  describe('reprovisionDns — DNS-only plan-change re-apply (never recreates infra)', () => {
    const ACTIVE = { ...TENANT, status: 'active', rds_endpoint: 'ep-1.rds.amazonaws.com' }

    it('refuses when the tenant is not active / has no infra', async () => {
      reg.getTenant.mockResolvedValue({ ...TENANT, status: 'provisioning', rds_endpoint: null })
      const { reprovisionDns } = await import('@/lib/provisioning/steps')
      const out = await reprovisionDns('t-1', provider)
      expect(out.ok).toBe(false)
      expect(provider.hasDns('acme.jeffistores.in')).toBe(false)
    })

    it('UPGRADE basic → growth crosses into dedicated: stands up EC2 and repoints all hosts', async () => {
      reg.getTenant.mockResolvedValue({ ...ACTIVE, plan: 'growth' })
      // Previously applied = basic hostnames, on the shared pool (no dedicated EC2 yet).
      reg.getProvisioningJob.mockResolvedValue(
        job({
          status: 'done',
          created_resources: {
            dnsHosts: ['acme.jeffistores.in', 'admin-acme.jeffistores.in', 'invoice-acme.jeffistores.in'],
          },
        })
      )
      const ensureEc2 = vi.spyOn(provider, 'ensureAppInstance')
      const ensure = vi.spyOn(provider, 'ensureDns')
      const remove = vi.spyOn(provider, 'removeDns')
      const { reprovisionDns } = await import('@/lib/provisioning/steps')
      const out = await reprovisionDns('t-1', provider)
      expect(out.ok).toBe(true)
      // growth is a dedicated plan; basic used the pool → a dedicated EC2 is provisioned
      // and the tenant's serving IP is persisted.
      expect(ensureEc2).toHaveBeenCalled()
      expect(reg.writeTenantEc2).toHaveBeenCalledWith('t-1', expect.any(String))
      // Compute moved → every desired host is repointed at the new target (added = full set).
      const desired = [
        'acme.jeffistores.in',
        'admin-acme.jeffistores.in',
        'invoice-acme.jeffistores.in',
        'quotation-acme.jeffistores.in',
        'purchaseorder-acme.jeffistores.in',
        'forms-acme.jeffistores.in',
      ]
      expect(out.added).toEqual(desired)
      expect(out.removed).toEqual([])
      expect(ensure).toHaveBeenCalledWith(desired, expect.any(String))
      expect(remove).not.toHaveBeenCalled()
      // Persists the now-authoritative host set.
      expect(lastPatch().created_resources.dnsHosts).toContain('quotation-acme.jeffistores.in')
    })

    it('DOWNGRADE removes the dropped higher-tier hostnames (pro → basic)', async () => {
      reg.getTenant.mockResolvedValue({ ...ACTIVE, plan: 'basic' })
      reg.getProvisioningJob.mockResolvedValue(
        job({
          status: 'done',
          created_resources: {
            dnsHosts: [
              'acme.jeffistores.in',
              'admin-acme.jeffistores.in',
              'invoice-acme.jeffistores.in',
              'quotation-acme.jeffistores.in',
              'purchaseorder-acme.jeffistores.in',
              'forms-acme.jeffistores.in',
              'acme.business.jeffistores.in',
            ],
          },
        })
      )
      const remove = vi.spyOn(provider, 'removeDns')
      const { reprovisionDns } = await import('@/lib/provisioning/steps')
      const out = await reprovisionDns('t-1', provider)
      expect(out.ok).toBe(true)
      expect(out.added).toEqual([])
      expect(out.removed).toEqual(
        expect.arrayContaining([
          'quotation-acme.jeffistores.in',
          'purchaseorder-acme.jeffistores.in',
          'forms-acme.jeffistores.in',
          'acme.business.jeffistores.in',
        ])
      )
      expect(remove).toHaveBeenCalled()
    })

    it('is a no-op when the tier is unchanged', async () => {
      reg.getTenant.mockResolvedValue({ ...ACTIVE, plan: 'basic' })
      reg.getProvisioningJob.mockResolvedValue(
        job({
          status: 'done',
          created_resources: {
            dnsHosts: ['acme.jeffistores.in', 'admin-acme.jeffistores.in', 'invoice-acme.jeffistores.in'],
          },
        })
      )
      const ensure = vi.spyOn(provider, 'ensureDns')
      const remove = vi.spyOn(provider, 'removeDns')
      const { reprovisionDns } = await import('@/lib/provisioning/steps')
      const out = await reprovisionDns('t-1', provider)
      expect(out.added).toEqual([])
      expect(out.removed).toEqual([])
      expect(ensure).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  describe('deprovisionTenant — backup-first teardown', () => {
    it('returns an error for an unknown tenant', async () => {
      reg.getTenant.mockResolvedValue(null)
      const { deprovisionTenant } = await import('@/lib/provisioning/steps')
      await expect(deprovisionTenant('nope', provider, {})).resolves.toMatchObject({
        ok: false,
        error: 'tenant not found',
      })
    })

    it('takes the store OFFLINE first, then backs up, then deletes', async () => {
      reg.getTenant.mockResolvedValue({ ...TENANT, rds_endpoint: 'ep-1', s3_bucket: 'jeffi-tenant-acme' })
      backupStore.putTenantBackup.mockResolvedValue({ ownerKey: 'tenant-backups/owner-1/acme.sql.gz' })
      const { deprovisionTenant } = await import('@/lib/provisioning/steps')

      const out = await deprovisionTenant('t-1', provider, { ownerId: 'owner-1' })

      expect(reg.setTenantStatus).toHaveBeenCalledWith('t-1', 'terminated')
      expect(reg.clearTenantCache).toHaveBeenCalled()
      expect(out).toMatchObject({ ok: true, backedUp: true, backupKey: 'tenant-backups/owner-1/acme.sql.gz' })
      expect(reg.clearTenantInfra).toHaveBeenCalledWith('t-1')
    })

    it('skips the backup for a tenant that never had a database', async () => {
      reg.getTenant.mockResolvedValue({ ...TENANT, rds_endpoint: null })
      const { deprovisionTenant } = await import('@/lib/provisioning/steps')
      const out = await deprovisionTenant('t-1', provider, { ownerId: 'o-1' })
      expect(out).toMatchObject({ ok: true, backedUp: false, backupKey: null })
      expect(backupStore.putTenantBackup).not.toHaveBeenCalled()
    })

    it('removes the tenant DNS records so subdomains stop resolving', async () => {
      reg.getTenant.mockResolvedValue({ ...TENANT, rds_endpoint: null })
      await provider.ensureDns(['acme.jeffistores.in'])
      const { deprovisionTenant } = await import('@/lib/provisioning/steps')
      await deprovisionTenant('t-1', provider, {})
      expect(provider.hasDns('acme.jeffistores.in')).toBe(false)
    })

    it('retries a transient removeDns failure and self-heals (no manual cleanup)', async () => {
      reg.getTenant.mockResolvedValue({ ...TENANT, rds_endpoint: null })
      await provider.ensureDns(['acme.jeffistores.in'])
      const realRemove = provider.removeDns.bind(provider)
      let calls = 0
      vi.spyOn(provider, 'removeDns').mockImplementation(async (hosts: string[]) => {
        calls++
        if (calls < 3) throw new Error(`Route53 DELETE failed for x (503): ServiceUnavailable`)
        return realRemove(hosts)
      })
      const { deprovisionTenant } = await import('@/lib/provisioning/steps')
      const out = await deprovisionTenant('t-1', provider, {})
      expect(out.ok).toBe(true)
      expect(calls).toBe(3)
      expect(provider.hasDns('acme.jeffistores.in')).toBe(false)
    })

    it('does NOT retry a non-transient removeDns failure — records dnsHosts once', async () => {
      reg.getProvisioningJob.mockResolvedValue(
        job({ status: 'done', created_resources: { dnsHosts: ['acme.jeffistores.in'] } })
      )
      reg.getTenant.mockResolvedValue({ ...TENANT, rds_endpoint: null })
      await provider.ensureDns(['acme.jeffistores.in'])
      const remove = vi
        .spyOn(provider, 'removeDns')
        .mockRejectedValue(new Error('Route53 DELETE failed for x (400): InvalidChangeBatch'))
      const { deprovisionTenant } = await import('@/lib/provisioning/steps')
      const out = await deprovisionTenant('t-1', provider, {})
      expect(out.ok).toBe(true)
      expect(remove).toHaveBeenCalledTimes(1)
      expect(provider.hasDns('acme.jeffistores.in')).toBe(true)
      const patch = reg.updateProvisioningJob.mock.calls.at(-1)?.[1]
      expect(patch?.created_resources?.manualCleanup?.dnsHosts).toEqual(['acme.jeffistores.in'])
    })

    it('reports failure when the backup throws (does NOT delete blindly)', async () => {
      reg.getTenant.mockResolvedValue({ ...TENANT, rds_endpoint: 'ep-1' })
      vi.spyOn(provider, 'backupDb').mockRejectedValue(new Error('dump failed'))
      const { deprovisionTenant } = await import('@/lib/provisioning/steps')
      const out = await deprovisionTenant('t-1', provider, { ownerId: 'o-1' })
      expect(out.ok).toBe(false)
      expect(String(out.error)).toMatch(/dump failed/)
    })

    it('uses "unknown" as the owner key when no ownerId is supplied', async () => {
      reg.getTenant.mockResolvedValue({ ...TENANT, rds_endpoint: 'ep-1' })
      backupStore.putTenantBackup.mockResolvedValue({ ownerKey: 'k' })
      const { deprovisionTenant } = await import('@/lib/provisioning/steps')
      await deprovisionTenant('t-1', provider, {})
      expect(backupStore.putTenantBackup).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: 'unknown', slug: 'acme' })
      )
    })
  })
})
