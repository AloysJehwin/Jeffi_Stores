/**
 * Coverage extension for src/lib/tenant-registry.ts.
 *
 * tenant-registry-db.test.ts covers pool construction, the provisioning job layer,
 * the drift sweep, custom-domain validation and the host cache. This file exercises
 * the remaining data-layer functions — tenant CRUD, billing rollups, owners/bank,
 * KYC, drafts, Meta social accounts/posts, integration credentials, custom-domain
 * lifecycle, plan queries and the slug-context resolver — including their branches.
 *
 * Same mock shape as the sibling file: pg.Pool is a real constructor, rds-signer and
 * fs are stubbed, and each test queues pool.query results in call order.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
const poolQuery = vi.fn()
const poolOn = vi.fn()
const clientQuery = vi.fn()
const clientRelease = vi.fn()
const poolConnect = vi.fn()
const capturedConfigs: any[] = []
function PoolCtor(this: any, config: any) {
  capturedConfigs.push(config)
  this.query = poolQuery
  this.on = poolOn
  this.connect = poolConnect
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

/** Queue the next pool.query results, in order; extra calls resolve empty. */
function queueRows(...results: Array<{ rows?: any[]; rowCount?: number }>) {
  poolQuery.mockReset()
  for (const r of results) {
    poolQuery.mockResolvedValueOnce({ rows: r.rows ?? [], rowCount: r.rowCount ?? (r.rows?.length ?? 0) })
  }
  poolQuery.mockResolvedValue({ rows: [], rowCount: 0 })
}

/** Queue results for the transactional client used inside createTenant. */
function queueClient(...results: Array<{ rows?: any[]; rowCount?: number }>) {
  clientQuery.mockReset()
  for (const r of results) {
    clientQuery.mockResolvedValueOnce({ rows: r.rows ?? [], rowCount: r.rowCount ?? (r.rows?.length ?? 0) })
  }
  clientQuery.mockResolvedValue({ rows: [], rowCount: 0 })
}

async function importRegistry() {
  vi.resetModules()
  delete (globalThis as any).__cpPool
  capturedConfigs.length = 0
  return import('@/lib/tenant-registry')
}

describe('tenant-registry (data layer, extended)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    poolQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    clientQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    poolConnect.mockResolvedValue({ query: clientQuery, release: clientRelease })
    process.env.CONTROL_PLANE_DATABASE_URL = 'postgres://localhost/jeffi_control_plane'
    delete process.env.CONTROL_PLANE_IAM_AUTH
  })
  afterEach(() => {
    delete process.env.CONTROL_PLANE_DATABASE_URL
    delete process.env.CONTROL_PLANE_IAM_AUTH
    delete (globalThis as any).__cpPool
  })

  // ── controlPlanePool RDS cert branch (lines 71-72) ──
  describe('controlPlanePool RDS TLS', () => {
    it('loads the RDS CA bundle when the connection string is an RDS host and the cert exists', async () => {
      const fs = await import('fs')
      vi.mocked(fs.existsSync).mockReturnValue(true)
      process.env.CONTROL_PLANE_DATABASE_URL = 'postgres://u@cp.rds.amazonaws.com:5432/jeffi_control_plane'
      const { controlPlanePool } = await importRegistry()
      controlPlanePool()
      expect(capturedConfigs[0].ssl).toEqual({ rejectUnauthorized: true, ca: 'CERT' })
      vi.mocked(fs.existsSync).mockReturnValue(false)
    })

    it('leaves ssl undefined for a non-RDS connection string', async () => {
      const { controlPlanePool } = await importRegistry()
      controlPlanePool()
      expect(capturedConfigs[0].ssl).toBeUndefined()
    })

    it('uses a permissive ssl config under IAM auth when the cert is missing', async () => {
      const fs = await import('fs')
      vi.mocked(fs.existsSync).mockReturnValue(false)
      delete process.env.CONTROL_PLANE_DATABASE_URL
      process.env.CONTROL_PLANE_IAM_AUTH = 'true'
      process.env.CONTROL_PLANE_RDS_HOST = 'cp.rds.amazonaws.com'
      const { controlPlanePool } = await importRegistry()
      controlPlanePool()
      expect(capturedConfigs[0].ssl).toEqual({ rejectUnauthorized: false })
      delete process.env.CONTROL_PLANE_RDS_HOST
    })
  })

  // ── lookupTenant branches (via resolveTenantFromHost / lookupTenantContextBySlug) ──
  describe('lookupTenant branches', () => {
    it('maps a full infra row to a TenantContext', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{
        id: 't-1', slug: 'acme', status: 'active', plan: 'pro',
        rds_endpoint: 'ep', rds_db: 'db1', rds_port: 6000, db_secret_ref: 'sec',
        iam_auth: false, s3_bucket: 'buck', region: 'ap-south-1',
      }] })
      const ctx = await mod.resolveTenantFromHost('acme.jeffistores.in')
      expect(ctx).toMatchObject({
        tenantId: 't-1', slug: 'acme', plan: 'pro',
        infra: { rdsEndpoint: 'ep', rdsDb: 'db1', rdsPort: 6000, dbSecretRef: 'sec', iamAuth: false, s3Bucket: 'buck', region: 'ap-south-1' },
      })
    })

    it('applies infra defaults when optional columns are null/empty', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{
        id: 't-2', slug: 'beta', status: 'active', plan: null,
        rds_endpoint: 'ep2', rds_db: null, rds_port: null, db_secret_ref: null,
        iam_auth: null, s3_bucket: null, region: null,
      }] })
      const ctx = await mod.resolveTenantFromHost('beta.jeffistores.in')
      expect(ctx).toMatchObject({
        plan: null,
        infra: { rdsDb: 'jeffi_stores', rdsPort: 5432, dbSecretRef: null, iamAuth: true, s3Bucket: null, region: 'us-east-1' },
      })
    })

    it('returns a null-infra context when rds_endpoint is absent', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 't-3', slug: 'gamma', status: 'active', plan: 'starter', rds_endpoint: null }] })
      const ctx = await mod.resolveTenantFromHost('gamma.jeffistores.in')
      expect(ctx).toMatchObject({ tenantId: 't-3', infra: null })
    })

    it('treats a non-active tenant as no-serve (null)', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 't-4', slug: 'susp', status: 'suspended', rds_endpoint: 'ep' }] })
      await expect(mod.resolveTenantFromHost('susp.jeffistores.in')).resolves.toBeNull()
    })

    it('resolves a custom domain via the custom_domain where-clause', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 't-5', slug: 'shop', status: 'active', rds_endpoint: 'ep' }] })
      const ctx = await mod.resolveTenantFromHost('shop.acme.com')
      expect(ctx).toMatchObject({ tenantId: 't-5', slug: 'shop' })
      expect(String(poolQuery.mock.calls[0][0])).toMatch(/tenant_custom_domains/)
    })

    it('fails closed (throws) on a tenant host when the control plane errors', async () => {
      const mod = await importRegistry()
      poolQuery.mockReset()
      poolQuery.mockRejectedValue(new Error('cp down'))
      await expect(mod.resolveTenantFromHost('err.jeffistores.in')).rejects.toThrow('cp down')
    })
  })

  describe('lookupTenantContextBySlug', () => {
    it('resolves and caches by slug key', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 't-1', slug: 'acme', status: 'active', rds_endpoint: 'ep' }] })
      await expect(mod.lookupTenantContextBySlug('acme')).resolves.toMatchObject({ slug: 'acme' })
      const afterFirst = poolQuery.mock.calls.length
      await mod.lookupTenantContextBySlug('acme')
      expect(poolQuery.mock.calls.length).toBe(afterFirst) // cached
    })

    it('fails open to null on error', async () => {
      const mod = await importRegistry()
      poolQuery.mockReset()
      poolQuery.mockRejectedValue(new Error('boom'))
      await expect(mod.lookupTenantContextBySlug('acme')).resolves.toBeNull()
    })
  })

  // ── listTenants + summaries ──
  describe('listTenants', () => {
    it('returns rows with no filters (no WHERE)', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 't-1' }] })
      await expect(mod.listTenants()).resolves.toEqual([{ id: 't-1' }])
      expect(String(poolQuery.mock.calls[0][0])).not.toMatch(/WHERE/)
    })

    it('applies status, plan and q filters together', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.listTenants({ status: 'active', plan: 'pro', q: 'Ac Me' })
      const [sql, args] = poolQuery.mock.calls[0]
      expect(String(sql)).toMatch(/WHERE/)
      expect(args).toEqual(['active', 'pro', '%ac me%'])
    })
  })

  it('tenantSummary maps counts and coerces mrr to a number', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ total: 10, active: 7, mrr: '4200' }] })
    await expect(mod.tenantSummary()).resolves.toEqual({ total: 10, active: 7, mrr: 4200 })
  })

  it('activeTenantCount returns the scalar count', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ n: 5 }] })
    await expect(mod.activeTenantCount()).resolves.toBe(5)
  })

  it('planMix returns the grouped distribution', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ plan: 'pro', count: 3 }, { plan: 'none', count: 1 }] })
    await expect(mod.planMix()).resolves.toHaveLength(2)
  })

  it('listPlans returns active plans', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ slug: 'pro', name: 'Pro', tier: 2, monthly_price_inr: '999' }] })
    await expect(mod.listPlans()).resolves.toHaveLength(1)
  })

  // ── createTenant: every guard + success + rollback ──
  describe('createTenant', () => {
    it('rejects an invalid slug', async () => {
      const mod = await importRegistry()
      await expect(mod.createTenant({ slug: '-bad', displayName: 'X', planSlug: 'pro' }))
        .resolves.toEqual({ ok: false, error: expect.stringMatching(/Slug must be/) })
    })

    it('rejects a reserved slug', async () => {
      const mod = await importRegistry()
      const out: any = await mod.createTenant({ slug: 'admin', displayName: 'X', planSlug: 'pro' })
      expect(out.ok).toBe(false)
      expect(out.error).toMatch(/reserved/)
    })

    it('rejects a missing display name', async () => {
      const mod = await importRegistry()
      await expect(mod.createTenant({ slug: 'acme', displayName: '  ', planSlug: 'pro' }))
        .resolves.toEqual({ ok: false, error: 'Store name is required.' })
    })

    it('rejects an unknown/inactive plan', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] }) // plan lookup empty
      const out: any = await mod.createTenant({ slug: 'acme', displayName: 'Acme', planSlug: 'ghost' })
      expect(out.ok).toBe(false)
      expect(out.error).toMatch(/Unknown or inactive plan/)
    })

    it('rejects a duplicate slug', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'plan-1' }] }, { rows: [{ exists: 1 }] })
      const out: any = await mod.createTenant({ slug: 'acme', displayName: 'Acme', planSlug: 'pro' })
      expect(out.ok).toBe(false)
      expect(out.error).toMatch(/already taken/)
    })

    it('inserts tenant + infra in a transaction on success', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'plan-1' }] }, { rows: [] }) // plan ok, no dup
      queueClient({ rows: [] }, { rows: [{ id: 'new-t' }] }, { rows: [] }, { rows: [] }) // BEGIN, INSERT tenants, INSERT infra, COMMIT
      const out: any = await mod.createTenant({ slug: 'acme', displayName: 'Acme', planSlug: 'pro', dailyPayout: true })
      expect(out).toEqual({ ok: true, tenantId: 'new-t', slug: 'acme' })
      expect(String(clientQuery.mock.calls[0][0])).toBe('BEGIN')
      expect(clientRelease).toHaveBeenCalled()
    })

    it('applies status/billingInterval defaults when omitted', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'plan-1' }] }, { rows: [] })
      queueClient({ rows: [] }, { rows: [{ id: 'new-t' }] }, { rows: [] }, { rows: [] })
      await mod.createTenant({ slug: 'acme', displayName: 'Acme', planSlug: 'pro' })
      const insertArgs = clientQuery.mock.calls[1][1]
      expect(insertArgs).toEqual(expect.arrayContaining(['provisioning', 'monthly']))
    })

    it('rolls back and returns the error on a transaction failure', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'plan-1' }] }, { rows: [] })
      clientQuery.mockReset()
      clientQuery.mockResolvedValueOnce({ rows: [] })            // BEGIN
      clientQuery.mockRejectedValueOnce(new Error('insert blew up')) // INSERT tenants
      clientQuery.mockResolvedValue({ rows: [] })                // ROLLBACK
      const out: any = await mod.createTenant({ slug: 'acme', displayName: 'Acme', planSlug: 'pro' })
      expect(out).toEqual({ ok: false, error: 'insert blew up' })
      expect(String(clientQuery.mock.calls.at(-1)![0])).toBe('ROLLBACK')
      expect(clientRelease).toHaveBeenCalled()
    })
  })

  // ── billing rollups ──
  it('getTenantBilling sums ledger balance and transaction totals', async () => {
    const mod = await importRegistry()
    queueRows(
      { rows: [ // transactions
        { gross_amount: '100', tenant_share: '80', platform_commission: '15', gateway_fee: '5' },
        { gross_amount: '50', tenant_share: '40', platform_commission: '8', gateway_fee: '2' },
      ] },
      { rows: [{ amount: '90' }, { amount: '-10' }] }, // ledger
    )
    const out = await mod.getTenantBilling('t-1')
    expect(out.balance).toBe(80)
    expect(out.totals).toEqual({ gross: 150, tenantShare: 120, commission: 23, fees: 7 })
  })

  it('billingSummary coerces the aggregate row to numbers', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ mrr: '5000', paying: 4, comm: '300', gmv: '9000' }] })
    await expect(mod.billingSummary()).resolves.toEqual({ mrr: 5000, commission30d: 300, gmv30d: 9000, payingTenants: 4 })
  })

  // ── subscription / plan mutations ──
  it('saveSubscriptionId passes id, interval and checkout url', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] })
    await mod.saveSubscriptionId('t-1', 'sub_1', 'yearly', 'https://pay')
    expect(poolQuery.mock.calls[0][1]).toEqual(['sub_1', 't-1', 'yearly', 'https://pay'])
  })

  it('saveSubscriptionId defaults interval/url to null', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] })
    await mod.saveSubscriptionId('t-1', 'sub_1')
    expect(poolQuery.mock.calls[0][1]).toEqual(['sub_1', 't-1', null, null])
  })

  it('setSubscriptionStatus updates tenant status too when provided', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] })
    await mod.setSubscriptionStatus('t-1', 'active', 'active')
    expect(String(poolQuery.mock.calls[0][0])).toMatch(/status=\$2/)
    expect(poolQuery.mock.calls[0][1]).toEqual(['active', 'active', 't-1'])
  })

  it('setSubscriptionStatus updates only subscription_status when tenantStatus omitted', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] })
    await mod.setSubscriptionStatus('t-1', 'halted')
    expect(String(poolQuery.mock.calls[0][0])).not.toMatch(/status=\$2/)
    expect(poolQuery.mock.calls[0][1]).toEqual(['halted', 't-1'])
  })

  it('updateTenantPlan resolves the plan id and forwards a new subscription id', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ id: 'plan-9' }] }, { rows: [] })
    await mod.updateTenantPlan('t-1', { planSlug: 'pro', billingInterval: 'monthly', newSubscriptionId: 'sub_x' })
    expect(poolQuery.mock.calls[1][1]).toEqual(['plan-9', 'monthly', 'sub_x', 't-1'])
  })

  it('updateTenantPlan tolerates an unknown plan slug (null plan id)', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] }, { rows: [] })
    await mod.updateTenantPlan('t-1', { planSlug: 'ghost', billingInterval: 'yearly' })
    expect(poolQuery.mock.calls[1][1]).toEqual([null, 'yearly', null, 't-1'])
  })

  it('writeTenantEc2 persists the serving target', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] })
    await mod.writeTenantEc2('t-1', '10.0.0.5')
    expect(poolQuery.mock.calls[0][1]).toEqual(['10.0.0.5', null, 't-1'])
  })

  // ── platform infra KV ──
  it('getPlatformInfra returns the value or null', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ value: 'i-123' }] })
    await expect(mod.getPlatformInfra('pool_instance')).resolves.toBe('i-123')
    queueRows({ rows: [] })
    await expect(mod.getPlatformInfra('missing')).resolves.toBeNull()
  })

  it('setPlatformInfra upserts key/value', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] })
    await mod.setPlatformInfra('pool_ip', '1.2.3.4')
    expect(String(poolQuery.mock.calls[0][0])).toMatch(/ON CONFLICT \(key\)/)
    expect(poolQuery.mock.calls[0][1]).toEqual(['pool_ip', '1.2.3.4'])
  })

  // ── owners ──
  describe('findOrCreateOwner', () => {
    it('returns an existing owner untouched when name already set', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'o-1', email: 'a@b.com', name: 'Existing', created_at: 't' }] })
      await expect(mod.findOrCreateOwner('a@b.com', 'New')).resolves.toMatchObject({ id: 'o-1', name: 'Existing' })
      expect(poolQuery).toHaveBeenCalledTimes(1) // no update, no insert
    })

    it('backfills a name onto an existing owner missing one', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'o-1', email: 'a@b.com', name: null, created_at: 't' }] }, { rows: [] })
      const out = await mod.findOrCreateOwner('a@b.com', 'Fresh Name')
      expect(out.name).toBe('Fresh Name')
      expect(String(poolQuery.mock.calls[1][0])).toMatch(/UPDATE owners SET name/)
    })

    it('inserts a new owner when none exists', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] }, { rows: [{ id: 'o-2', email: 'c@d.com', name: 'C', created_at: 't' }] })
      await expect(mod.findOrCreateOwner('c@d.com', 'C')).resolves.toMatchObject({ id: 'o-2' })
      expect(String(poolQuery.mock.calls[1][0])).toMatch(/INSERT INTO owners/)
    })
  })

  it('getOwnerTenants returns the owner rows', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ id: 't-1', slug: 'acme' }] })
    await expect(mod.getOwnerTenants('o-1')).resolves.toHaveLength(1)
  })

  it('linkOwnerTenant upserts the join row', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] })
    await mod.linkOwnerTenant('o-1', 't-1')
    expect(String(poolQuery.mock.calls[0][0])).toMatch(/ON CONFLICT \(owner_id, tenant_id\) DO NOTHING/)
  })

  // ── bank verification ──
  it('saveBankVerification upserts and returns the row', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ id: 'b-1', owner_id: 'o-1', verification_status: 'verified' }] })
    const out = await mod.saveBankVerification({ ownerId: 'o-1', accountNumber: '123', ifsc: 'IFSC0', status: 'verified' })
    expect(out).toMatchObject({ id: 'b-1', verification_status: 'verified' })
    expect(poolQuery.mock.calls[0][1][0]).toBe('o-1')
  })

  it('hasVerifiedBank is true for a verified account', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ id: 'b-1', verification_status: 'verified' }] })
    await expect(mod.hasVerifiedBank('o-1')).resolves.toBe(true)
  })

  // ── plan feature matrix ──
  it('planFeatureMatrix groups scope keys into a set per plan', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [
      { slug: 'pro', scope_key: 'orders:read' },
      { slug: 'pro', scope_key: 'gst:read' },
      { slug: 'starter', scope_key: 'orders:read' },
    ] })
    const matrix = await mod.planFeatureMatrix()
    expect(matrix.pro).toBeInstanceOf(Set)
    expect(matrix.pro.has('gst:read')).toBe(true)
    expect(matrix.starter.size).toBe(1)
  })

  // ── onboarding drafts ──
  it('saveDraft serialises the data payload', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] })
    await mod.saveDraft('o-1', 2, { a: 1 })
    expect(poolQuery.mock.calls[0][1]).toEqual(['o-1', 2, JSON.stringify({ a: 1 })])
  })

  it('getDraft returns the row when present', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ id: 'd-1', owner_id: 'o-1', current_step: 1 }] })
    await expect(mod.getDraft('o-1')).resolves.toMatchObject({ id: 'd-1' })
  })

  it('markDraftSubmitted flips the status', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] })
    await mod.markDraftSubmitted('o-1')
    expect(String(poolQuery.mock.calls[0][0])).toMatch(/status='submitted'/)
  })

  // ── KYC ──
  describe('saveKyc legals branch', () => {
    it('stamps a policy version + timestamp when legals accepted', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      process.env.POLICY_VERSION = '3'
      await mod.saveKyc('t-1', 'o-1', { business_name: 'Acme', legals_accepted: true })
      const args = poolQuery.mock.calls[0][1]
      expect(args[12]).toBe('3')       // legals_accepted_version
      expect(args[13]).not.toBeNull()  // legals_accepted_at
      delete process.env.POLICY_VERSION
    })

    it('leaves legals columns null when not accepted', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.saveKyc('t-1', 'o-1', { business_name: 'Acme' })
      const args = poolQuery.mock.calls[0][1]
      expect(args[12]).toBeNull()
      expect(args[13]).toBeNull()
    })
  })

  it('getKyc returns the row or null', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ id: 'k-1', tenant_id: 't-1' }] })
    await expect(mod.getKyc('t-1')).resolves.toMatchObject({ id: 'k-1' })
    queueRows({ rows: [] })
    await expect(mod.getKyc('t-2')).resolves.toBeNull()
  })

  it('approveKyc marks kyc approved and tenant awaiting_payment', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] }, { rows: [] })
    await mod.approveKyc('t-1', 'admin@x.com')
    expect(String(poolQuery.mock.calls[0][0])).toMatch(/status='approved'/)
    expect(String(poolQuery.mock.calls[1][0])).toMatch(/status='awaiting_payment'/)
  })

  it('rejectKyc records the note and rejects the tenant', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] }, { rows: [] })
    await mod.rejectKyc('t-1', 'admin@x.com', 'bad docs')
    expect(poolQuery.mock.calls[0][1]).toEqual(['t-1', 'admin@x.com', 'bad docs'])
    expect(String(poolQuery.mock.calls[1][0])).toMatch(/status='rejected'/)
  })

  // ── social accounts + posts ──
  it('saveTenantSocialAccount upserts with token expiry when given', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] })
    const exp = new Date('2030-01-01T00:00:00.000Z')
    await mod.saveTenantSocialAccount({ tenantId: 't-1', provider: 'facebook', accessTokenEnc: 'enc', tokenExpiry: exp })
    const args = poolQuery.mock.calls[0][1]
    expect(args[6]).toBe(exp.toISOString())
  })

  it('saveTenantSocialAccount passes null expiry when omitted', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] })
    await mod.saveTenantSocialAccount({ tenantId: 't-1', provider: 'instagram', accessTokenEnc: 'enc' })
    expect(poolQuery.mock.calls[0][1][6]).toBeNull()
  })

  it('getTenantSocialAccounts returns the rows', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ id: 's-1', provider: 'facebook' }] })
    await expect(mod.getTenantSocialAccounts('t-1')).resolves.toHaveLength(1)
  })

  it('enqueueSocialPost defaults scheduledAt to null (COALESCE now())', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ id: 'p-1', status: 'pending' }] })
    const out = await mod.enqueueSocialPost({ tenantId: null, platform: 'fb', caption: 'hi' })
    expect(out).toMatchObject({ id: 'p-1' })
    expect(poolQuery.mock.calls[0][1][8]).toBeNull()
  })

  it('enqueueSocialPost forwards a scheduled time when given', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ id: 'p-2' }] })
    const when = new Date('2031-05-05T10:00:00.000Z')
    await mod.enqueueSocialPost({ tenantId: 't-1', platform: 'ig', scheduledAt: when })
    expect(poolQuery.mock.calls[0][1][8]).toBe(when.toISOString())
  })

  it('dueSocialPosts queries pending posts up to the limit', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ id: 'p-1' }] })
    await mod.dueSocialPosts(5)
    expect(poolQuery.mock.calls[0][1]).toEqual([5])
    expect(String(poolQuery.mock.calls[0][0])).toMatch(/status='pending'/)
  })

  it('listJeffiSocialPosts filters tenant_id IS NULL', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] })
    await mod.listJeffiSocialPosts()
    expect(String(poolQuery.mock.calls[0][0])).toMatch(/tenant_id IS NULL/)
    expect(poolQuery.mock.calls[0][1]).toEqual([100]) // default limit
  })

  it('getSocialPost returns the row or null', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ id: 'p-1' }] })
    await expect(mod.getSocialPost('p-1')).resolves.toMatchObject({ id: 'p-1' })
    queueRows({ rows: [] })
    await expect(mod.getSocialPost('gone')).resolves.toBeNull()
  })

  describe('updateSocialPost patch branches', () => {
    it('patches status, postedId and lastError', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.updateSocialPost('p-1', { status: 'posted', postedId: 'ext-9', lastError: null })
      const sql = String(poolQuery.mock.calls[0][0])
      expect(sql).toMatch(/status=\$1/)
      expect(sql).toMatch(/posted_id=\$2/)
      expect(sql).toMatch(/last_error=\$3/)
    })

    it('bumps attempts on retry', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.updateSocialPost('p-1', { bumpAttempts: true })
      expect(String(poolQuery.mock.calls[0][0])).toMatch(/attempts = attempts \+ 1/)
    })
  })

  // ── integration credentials ──
  it('saveIntegrationCredential upserts encrypted config with expiry', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] })
    const exp = new Date('2030-06-06T00:00:00.000Z')
    await mod.saveIntegrationCredential({ tenantId: 't-1', provider: 'google', configEnc: 'enc', meta: { x: 1 }, expiresAt: exp })
    const args = poolQuery.mock.calls[0][1]
    expect(args[4]).toBe(JSON.stringify({ x: 1 }))
    expect(args[5]).toBe(exp.toISOString())
  })

  it('saveIntegrationCredential defaults meta {} and null expiry', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] })
    await mod.saveIntegrationCredential({ tenantId: 't-1', provider: 'amazon', configEnc: 'enc' })
    const args = poolQuery.mock.calls[0][1]
    expect(args[4]).toBe(JSON.stringify({}))
    expect(args[5]).toBeNull()
  })

  it('getIntegrationCredential returns the row or null', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ id: 'c-1', provider: 'google' }] })
    await expect(mod.getIntegrationCredential('t-1', 'google')).resolves.toMatchObject({ id: 'c-1' })
    queueRows({ rows: [] })
    await expect(mod.getIntegrationCredential('t-1', 'none')).resolves.toBeNull()
  })

  it('listIntegrationCredentials omits the secret', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ id: 'c-1', provider: 'google' }] })
    await mod.listIntegrationCredentials('t-1')
    expect(String(poolQuery.mock.calls[0][0])).not.toMatch(/config_enc/)
  })

  it('deleteIntegrationCredential removes by tenant+provider', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] })
    await mod.deleteIntegrationCredential('t-1', 'google')
    expect(poolQuery.mock.calls[0][1]).toEqual(['t-1', 'google'])
  })

  // ── custom-domain lifecycle (beyond addCustomDomain validation) ──
  it('listCustomDomains returns the tenant domains', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ id: 'd-1', domain: 'shop.acme.com' }] })
    await expect(mod.listCustomDomains('t-1')).resolves.toHaveLength(1)
  })

  it('setCustomDomainStatus updates status and clears the cache', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] })
    await mod.setCustomDomainStatus('d-1', 'verified', 'arn:cert')
    expect(poolQuery.mock.calls[0][1]).toEqual(['verified', 'arn:cert', 'd-1'])
    expect(String(poolQuery.mock.calls[0][0])).toMatch(/verified_at=CASE/)
  })

  it('setCustomDomainStatus tolerates a missing cert arn', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] })
    await mod.setCustomDomainStatus('d-1', 'pending')
    expect(poolQuery.mock.calls[0][1]).toEqual(['pending', null, 'd-1'])
  })

  it('getCustomDomain returns the row or null', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [{ id: 'd-1' }] })
    await expect(mod.getCustomDomain('d-1')).resolves.toMatchObject({ id: 'd-1' })
    queueRows({ rows: [] })
    await expect(mod.getCustomDomain('gone')).resolves.toBeNull()
  })

  it('deleteCustomDomain removes by id+tenant', async () => {
    const mod = await importRegistry()
    queueRows({ rows: [] })
    await mod.deleteCustomDomain('d-1', 't-1')
    expect(poolQuery.mock.calls[0][1]).toEqual(['d-1', 't-1'])
  })
})
