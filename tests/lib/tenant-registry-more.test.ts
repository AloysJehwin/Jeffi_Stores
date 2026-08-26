/**
 * Additional coverage for the DB-backed half of src/lib/tenant-registry.ts.
 *
 * tenant-registry-db.test.ts covers pool construction, provisioning jobs, the
 * drift sweep, custom-domain validation and the host cache. This file fills the
 * remaining gaps: the admin/read lists (listTenants, tenantSummary, planMix,
 * listPlans, billing), createTenant's validation + transaction, KYC lifecycle,
 * social accounts + scheduled posts, integration credentials, owner/bank
 * accessors, platform_infra, subscription mutations and slug-context lookup —
 * exercising both sides of each function's conditionals.
 *
 * Uses the same pg mock shape as tenant-registry-db.test.ts: Pool is a real
 * constructor whose `.query` is a shared spy, and pool.connect() yields a
 * client whose query/release we can drive and assert.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const poolQuery = vi.fn()
const poolOn = vi.fn()
const clientQuery = vi.fn()
const clientRelease = vi.fn()
const poolConnect = vi.fn(async () => ({ query: clientQuery, release: clientRelease }))

function PoolCtor(this: any) {
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

/** Queue pool.query results in order; anything beyond falls through to []. */
function queueRows(...results: Array<{ rows?: any[]; rowCount?: number }>) {
  poolQuery.mockReset()
  for (const r of results) {
    poolQuery.mockResolvedValueOnce({ rows: r.rows ?? [], rowCount: r.rowCount ?? (r.rows?.length ?? 0) })
  }
  poolQuery.mockResolvedValue({ rows: [], rowCount: 0 })
}

/** Queue client.query results (used inside createTenant's BEGIN/COMMIT tx). */
function queueClientRows(...results: Array<{ rows?: any[]; rowCount?: number }>) {
  clientQuery.mockReset()
  for (const r of results) {
    clientQuery.mockResolvedValueOnce({ rows: r.rows ?? [], rowCount: r.rowCount ?? (r.rows?.length ?? 0) })
  }
  clientQuery.mockResolvedValue({ rows: [], rowCount: 0 })
}

async function importRegistry() {
  vi.resetModules()
  delete (globalThis as any).__cpPool
  return import('@/lib/tenant-registry')
}

describe('tenant-registry — extended coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    poolQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    clientQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    poolConnect.mockImplementation(async () => ({ query: clientQuery, release: clientRelease }))
    process.env.CONTROL_PLANE_DATABASE_URL = 'postgres://localhost/jeffi_control_plane'
    delete process.env.CONTROL_PLANE_IAM_AUTH
  })
  afterEach(() => {
    delete process.env.CONTROL_PLANE_DATABASE_URL
    delete process.env.CONTROL_PLANE_IAM_AUTH
    delete (globalThis as any).__cpPool
  })

  // ── controlPlanePool: RDS-URL SSL branch ─────────────────────────────────
  describe('controlPlanePool — RDS connection string', () => {
    it('attaches an SSL cert for an rds.amazonaws.com connection string when the bundle exists', async () => {
      const fs = await import('fs')
      ;(fs.existsSync as any).mockReturnValueOnce(true)
      ;(fs.readFileSync as any).mockReturnValueOnce('CA-CERT')
      process.env.CONTROL_PLANE_DATABASE_URL = 'postgres://u@cp.rds.amazonaws.com:5432/jeffi_control_plane'
      const { controlPlanePool } = await importRegistry()
      const p: any = controlPlanePool()
      expect(p).toBeTruthy()
      // pool self-heal handler is always registered
      expect(poolOn).toHaveBeenCalledWith('error', expect.any(Function))
    })
  })

  // ── listTenants: no filters vs each filter ───────────────────────────────
  describe('listTenants', () => {
    it('runs without a WHERE clause when no filters are given', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 't-1', slug: 'acme' }] })
      const rows = await mod.listTenants()
      expect(rows).toHaveLength(1)
      const sql = String(poolQuery.mock.calls[0][0])
      expect(sql).not.toMatch(/WHERE/)
      expect(poolQuery.mock.calls[0][1]).toEqual([])
    })

    it('builds a WHERE for status + plan + q and lowercases the search term', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.listTenants({ status: 'active', plan: 'pro', q: 'ACME' })
      const [sql, args] = poolQuery.mock.calls[0]
      expect(String(sql)).toMatch(/WHERE/)
      expect(String(sql)).toMatch(/t\.status = \$1/)
      expect(String(sql)).toMatch(/p\.slug = \$2/)
      expect(String(sql)).toMatch(/LIKE \$3/)
      expect(args).toEqual(['active', 'pro', '%acme%'])
    })
  })

  // ── tenantSummary / activeTenantCount / planMix / listPlans ──────────────
  describe('read-only summaries', () => {
    it('tenantSummary coerces mrr to a Number', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ total: 5, active: 3, mrr: '4999' }] })
      await expect(mod.tenantSummary()).resolves.toEqual({ total: 5, active: 3, mrr: 4999 })
    })

    it('activeTenantCount returns the scalar', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ n: 7 }] })
      await expect(mod.activeTenantCount()).resolves.toBe(7)
    })

    it('planMix passes rows straight through', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ plan: 'pro', count: 2 }, { plan: 'none', count: 1 }] })
      await expect(mod.planMix()).resolves.toEqual([{ plan: 'pro', count: 2 }, { plan: 'none', count: 1 }])
    })

    it('listPlans filters to active plans ordered by tier', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ slug: 'basic', name: 'Basic', tier: 1, monthly_price_inr: '999' }] })
      const plans = await mod.listPlans()
      expect(plans[0].slug).toBe('basic')
      expect(String(poolQuery.mock.calls[0][0])).toMatch(/is_active = true/)
    })
  })

  // ── createTenant: validation + transaction ───────────────────────────────
  describe('createTenant', () => {
    it('rejects a slug that fails the format regex', async () => {
      const mod = await importRegistry()
      await expect(mod.createTenant({ slug: 'A!', displayName: 'X', planSlug: 'pro' }))
        .resolves.toEqual({ ok: false, error: expect.stringMatching(/3-63 chars/) })
      expect(poolQuery).not.toHaveBeenCalled()
    })

    it('rejects a reserved slug', async () => {
      const mod = await importRegistry()
      await expect(mod.createTenant({ slug: 'admin', displayName: 'X', planSlug: 'pro' }))
        .resolves.toEqual({ ok: false, error: expect.stringMatching(/reserved/) })
    })

    it('rejects an empty display name', async () => {
      const mod = await importRegistry()
      await expect(mod.createTenant({ slug: 'acme', displayName: '   ', planSlug: 'pro' }))
        .resolves.toEqual({ ok: false, error: 'Store name is required.' })
    })

    it('rejects an unknown/inactive plan', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] }) // plan lookup empty
      await expect(mod.createTenant({ slug: 'acme', displayName: 'Acme', planSlug: 'ghost' }))
        .resolves.toEqual({ ok: false, error: expect.stringMatching(/Unknown or inactive plan/) })
    })

    it('rejects a duplicate slug', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'plan-1' }] }, { rows: [{ '?column?': 1 }] }) // plan ok, dup found
      await expect(mod.createTenant({ slug: 'acme', displayName: 'Acme', planSlug: 'pro' }))
        .resolves.toEqual({ ok: false, error: expect.stringMatching(/already taken/) })
    })

    it('creates the tenant + empty infra row inside a transaction on the happy path', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'plan-1' }] }, { rows: [] }) // plan ok, no dup
      queueClientRows(
        { rows: [] },                    // BEGIN
        { rows: [{ id: 'ten-1' }] },     // INSERT tenants RETURNING id
        { rows: [] },                    // INSERT tenant_infra
        { rows: [] },                    // COMMIT
      )
      const out = await mod.createTenant({ slug: 'acme', displayName: '  Acme  ', planSlug: 'pro', dailyPayout: true })
      expect(out).toEqual({ ok: true, tenantId: 'ten-1', slug: 'acme' })
      const beginCall = clientQuery.mock.calls[0][0]
      expect(String(beginCall)).toBe('BEGIN')
      // display name is trimmed
      const insertTenantArgs = clientQuery.mock.calls[1][1]
      expect(insertTenantArgs[1]).toBe('Acme')
      // infra bucket derived from slug
      const infraArgs = clientQuery.mock.calls[2][1]
      expect(infraArgs[1]).toBe('jeffi-tenant-acme')
      expect(clientRelease).toHaveBeenCalled()
    })

    it('rolls back and returns the error message when the insert throws', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'plan-1' }] }, { rows: [] })
      clientQuery.mockReset()
      clientQuery.mockResolvedValueOnce({ rows: [] })            // BEGIN
      clientQuery.mockRejectedValueOnce(new Error('unique violation')) // INSERT fails
      clientQuery.mockResolvedValue({ rows: [] })                // ROLLBACK
      const out = await mod.createTenant({ slug: 'acme', displayName: 'Acme', planSlug: 'pro' })
      expect(out).toEqual({ ok: false, error: 'unique violation' })
      expect(String(clientQuery.mock.calls.at(-1)![0])).toBe('ROLLBACK')
      expect(clientRelease).toHaveBeenCalled()
    })

    it('defaults status/billingInterval when omitted', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'plan-1' }] }, { rows: [] })
      queueClientRows({ rows: [] }, { rows: [{ id: 'ten-2' }] }, { rows: [] }, { rows: [] })
      await mod.createTenant({ slug: 'shop', displayName: 'Shop', planSlug: 'pro' })
      const insertTenantArgs = clientQuery.mock.calls[1][1]
      expect(insertTenantArgs[3]).toBe('provisioning') // status default
      expect(insertTenantArgs[4]).toBe('monthly')      // billing default
      expect(insertTenantArgs[5]).toBe(false)          // dailyPayout default
    })
  })

  // ── getTenant / getTenantBilling / billingSummary ────────────────────────
  describe('tenant detail + billing', () => {
    it('getTenant returns the row when present', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 't-1', slug: 'acme', status: 'active' }] })
      await expect(mod.getTenant('t-1')).resolves.toMatchObject({ slug: 'acme' })
    })

    it('getTenantBilling computes balance + totals from ledger and transactions', async () => {
      const mod = await importRegistry()
      // Promise.all → first pool.query = transactions, second = ledger.
      poolQuery.mockReset()
      poolQuery.mockResolvedValueOnce({ rows: [
        { gross_amount: '100', tenant_share: '80', platform_commission: '15', gateway_fee: '5' },
        { gross_amount: '200', tenant_share: '160', platform_commission: '30', gateway_fee: '10' },
      ] })
      poolQuery.mockResolvedValueOnce({ rows: [
        { id: 'l-1', entry_type: 'credit', amount: '240', note: null, occurred_at: 'x' },
        { id: 'l-2', entry_type: 'debit', amount: '-40', note: null, occurred_at: 'y' },
      ] })
      const out = await mod.getTenantBilling('t-1')
      expect(out.balance).toBe(200)
      expect(out.totals).toEqual({ gross: 300, tenantShare: 240, commission: 45, fees: 15 })
      expect(out.transactions).toHaveLength(2)
      expect(out.ledger).toHaveLength(2)
    })

    it('billingSummary coerces the numeric aggregate columns', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ mrr: '9999', paying: 4, comm: '1200', gmv: '50000' }] })
      await expect(mod.billingSummary()).resolves.toEqual({
        mrr: 9999, commission30d: 1200, gmv30d: 50000, payingTenants: 4,
      })
    })
  })

  // ── subscription + plan mutations ────────────────────────────────────────
  describe('subscription mutations', () => {
    it('saveSubscriptionId passes billingInterval/checkoutUrl through, null when omitted', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.saveSubscriptionId('t-1', 'sub_1')
      expect(poolQuery.mock.calls[0][1]).toEqual(['sub_1', 't-1', null, null])

      queueRows({ rows: [] })
      await mod.saveSubscriptionId('t-1', 'sub_1', 'yearly', 'https://pay')
      expect(poolQuery.mock.calls[0][1]).toEqual(['sub_1', 't-1', 'yearly', 'https://pay'])
    })

    it('setSubscriptionStatus updates status only when no tenantStatus given', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.setSubscriptionStatus('t-1', 'active')
      expect(String(poolQuery.mock.calls[0][0])).not.toMatch(/status=\$2/)
      expect(poolQuery.mock.calls[0][1]).toEqual(['active', 't-1'])
    })

    it('setSubscriptionStatus also flips tenant status when supplied', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.setSubscriptionStatus('t-1', 'active', 'active')
      expect(String(poolQuery.mock.calls[0][0])).toMatch(/status=\$2/)
      expect(poolQuery.mock.calls[0][1]).toEqual(['active', 'active', 't-1'])
    })

    it('updateTenantPlan resolves the plan id (null when unknown) and forwards subscription', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'plan-9' }] }, { rows: [] })
      await mod.updateTenantPlan('t-1', { planSlug: 'pro', billingInterval: 'monthly', newSubscriptionId: 'sub_2' })
      expect(poolQuery.mock.calls[1][1]).toEqual(['plan-9', 'monthly', 'sub_2', 't-1'])

      queueRows({ rows: [] }, { rows: [] }) // unknown plan
      await mod.updateTenantPlan('t-1', { planSlug: 'ghost', billingInterval: 'yearly' })
      expect(poolQuery.mock.calls[1][1]).toEqual([null, 'yearly', null, 't-1'])
    })
  })

  // ── platform_infra + writeTenantEc2 ──────────────────────────────────────
  describe('platform_infra + ec2 target', () => {
    it('getPlatformInfra returns the value or null', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ value: '1.2.3.4' }] })
      await expect(mod.getPlatformInfra('pool_ip')).resolves.toBe('1.2.3.4')
      queueRows({ rows: [] })
      await expect(mod.getPlatformInfra('missing')).resolves.toBeNull()
    })

    it('setPlatformInfra upserts key/value', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.setPlatformInfra('pool_ip', '5.6.7.8')
      expect(String(poolQuery.mock.calls[0][0])).toMatch(/ON CONFLICT \(key\)/)
      expect(poolQuery.mock.calls[0][1]).toEqual(['pool_ip', '5.6.7.8'])
    })

    it('setPlatformInfra accepts a null value (delete-style)', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.setPlatformInfra('pool_ip', null)
      expect(poolQuery.mock.calls[0][1]).toEqual(['pool_ip', null])
    })

    it('writeTenantEc2 stores the ec2 target', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.writeTenantEc2('t-1', '10.0.0.5')
      expect(poolQuery.mock.calls[0][1]).toEqual(['10.0.0.5', 't-1'])
    })
  })

  // ── owners + owner_tenants ───────────────────────────────────────────────
  describe('owners', () => {
    it('findOrCreateOwner returns the existing owner untouched when it already has a name', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'o-1', email: 'a@x.com', name: 'Al', created_at: 't' }] })
      const owner = await mod.findOrCreateOwner('a@x.com', 'Ignored')
      expect(owner).toMatchObject({ id: 'o-1', name: 'Al' })
      // only the SELECT ran — no UPDATE, no INSERT
      expect(poolQuery).toHaveBeenCalledTimes(1)
    })

    it('findOrCreateOwner backfills a name onto a nameless existing owner', async () => {
      const mod = await importRegistry()
      queueRows(
        { rows: [{ id: 'o-1', email: 'a@x.com', name: null, created_at: 't' }] }, // SELECT
        { rows: [] }, // UPDATE name
      )
      const owner = await mod.findOrCreateOwner('a@x.com', 'Al')
      expect(owner.name).toBe('Al')
      expect(String(poolQuery.mock.calls[1][0])).toMatch(/UPDATE owners SET name/)
    })

    it('findOrCreateOwner inserts a brand-new owner', async () => {
      const mod = await importRegistry()
      queueRows(
        { rows: [] }, // SELECT: none
        { rows: [{ id: 'o-2', email: 'new@x.com', name: 'New', created_at: 't' }] }, // INSERT
      )
      const owner = await mod.findOrCreateOwner('new@x.com', 'New')
      expect(owner).toMatchObject({ id: 'o-2' })
      expect(String(poolQuery.mock.calls[1][0])).toMatch(/INSERT INTO owners/)
    })

    it('getOwnerById returns the owner when present', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'o-1', email: 'a@x.com', name: 'Al', created_at: 't' }] })
      await expect(mod.getOwnerById('o-1')).resolves.toMatchObject({ id: 'o-1' })
    })

    it('getOwnerTenants returns the joined rows', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 't-1', slug: 'acme' }] })
      await expect(mod.getOwnerTenants('o-1')).resolves.toHaveLength(1)
    })

    it('linkOwnerTenant upserts the join row', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.linkOwnerTenant('o-1', 't-1')
      expect(String(poolQuery.mock.calls[0][0])).toMatch(/ON CONFLICT \(owner_id, tenant_id\) DO NOTHING/)
      expect(poolQuery.mock.calls[0][1]).toEqual(['o-1', 't-1'])
    })
  })

  // ── bank verification ────────────────────────────────────────────────────
  describe('bank verification', () => {
    it('saveBankVerification returns the upserted row and coalesces empty strings to null', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'b-1', owner_id: 'o-1', verification_status: 'verified' }] })
      const out = await mod.saveBankVerification({
        ownerId: 'o-1', accountNumber: '', ifsc: 'HDFC0001', status: 'verified',
      })
      expect(out).toMatchObject({ id: 'b-1', verification_status: 'verified' })
      const args = poolQuery.mock.calls[0][1]
      expect(args[0]).toBe('o-1')
      expect(args[1]).toBeNull()   // empty accountNumber → null
      expect(args[2]).toBe('HDFC0001')
    })

    it('getOwnerBankAccount returns the newest account', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'b-1', owner_id: 'o-1', verification_status: 'pending' }] })
      await expect(mod.getOwnerBankAccount('o-1')).resolves.toMatchObject({ id: 'b-1' })
    })

    it('hasVerifiedBank is true only for a verified account', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'b-1', owner_id: 'o-1', verification_status: 'verified' }] })
      await expect(mod.hasVerifiedBank('o-1')).resolves.toBe(true)

      queueRows({ rows: [{ id: 'b-1', owner_id: 'o-1', verification_status: 'pending' }] })
      await expect(mod.hasVerifiedBank('o-1')).resolves.toBe(false)
    })
  })

  // ── onboarding drafts ────────────────────────────────────────────────────
  describe('onboarding drafts', () => {
    it('saveDraft serialises the step data as JSON', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.saveDraft('o-1', 2, { store: 'acme' })
      const args = poolQuery.mock.calls[0][1]
      expect(args[0]).toBe('o-1')
      expect(args[1]).toBe(2)
      expect(args[2]).toBe(JSON.stringify({ store: 'acme' }))
    })

    it('getDraft returns the row when present', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'd-1', owner_id: 'o-1', current_step: 1, data: {}, status: 'draft', updated_at: 't' }] })
      await expect(mod.getDraft('o-1')).resolves.toMatchObject({ id: 'd-1' })
    })

    it('markDraftSubmitted flips the draft status', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.markDraftSubmitted('o-1')
      expect(String(poolQuery.mock.calls[0][0])).toMatch(/status='submitted'/)
      expect(poolQuery.mock.calls[0][1]).toEqual(['o-1'])
    })
  })

  // ── KYC lifecycle ─────────────────────────────────────────────────────────
  describe('KYC', () => {
    it('saveKyc records the policy version + timestamp only when legals accepted', async () => {
      const mod = await importRegistry()
      const saved = process.env.POLICY_VERSION
      process.env.POLICY_VERSION = '3'
      queueRows({ rows: [] })
      await mod.saveKyc('t-1', 'o-1', { business_name: 'Acme', legals_accepted: true })
      const args = poolQuery.mock.calls[0][1]
      expect(args[12]).toBe('3')                 // legals_accepted_version
      expect(typeof args[13]).toBe('string')     // legals_accepted_at ISO
      if (saved) process.env.POLICY_VERSION = saved; else delete process.env.POLICY_VERSION
    })

    it('saveKyc leaves the legals columns null when not accepted', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.saveKyc('t-1', 'o-1', { business_name: 'Acme' })
      const args = poolQuery.mock.calls[0][1]
      expect(args[12]).toBeNull()
      expect(args[13]).toBeNull()
    })

    it('getKyc returns the row or null', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'k-1', tenant_id: 't-1', status: 'pending' }] })
      await expect(mod.getKyc('t-1')).resolves.toMatchObject({ id: 'k-1' })
      queueRows({ rows: [] })
      await expect(mod.getKyc('t-2')).resolves.toBeNull()
    })

    it('approveKyc marks kyc approved AND moves the tenant to awaiting_payment', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] }, { rows: [] })
      await mod.approveKyc('t-1', 'admin@x.com')
      expect(String(poolQuery.mock.calls[0][0])).toMatch(/tenant_kyc SET status='approved'/)
      expect(poolQuery.mock.calls[0][1]).toEqual(['t-1', 'admin@x.com'])
      expect(String(poolQuery.mock.calls[1][0])).toMatch(/tenants SET status='awaiting_payment'/)
    })

    it('rejectKyc records the note and rejects the tenant', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] }, { rows: [] })
      await mod.rejectKyc('t-1', 'admin@x.com', 'blurry doc')
      expect(String(poolQuery.mock.calls[0][0])).toMatch(/status='rejected'/)
      expect(poolQuery.mock.calls[0][1]).toEqual(['t-1', 'admin@x.com', 'blurry doc'])
      expect(String(poolQuery.mock.calls[1][0])).toMatch(/tenants SET status='rejected'/)
    })
  })

  // ── social accounts + scheduled posts ────────────────────────────────────
  describe('social accounts', () => {
    it('saveTenantSocialAccount upserts and serialises token expiry to ISO', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      const expiry = new Date('2030-01-01T00:00:00.000Z')
      await mod.saveTenantSocialAccount({
        tenantId: 't-1', provider: 'facebook', pageId: 'p1', accessTokenEnc: 'enc', tokenExpiry: expiry,
      })
      const args = poolQuery.mock.calls[0][1]
      expect(args[0]).toBe('t-1')
      expect(args[1]).toBe('facebook')
      expect(args[6]).toBe(expiry.toISOString())
    })

    it('saveTenantSocialAccount sends null expiry when omitted', async () => {
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
  })

  describe('scheduled social posts', () => {
    it('enqueueSocialPost inserts and returns the row; null scheduledAt falls back to now()', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'sp-1', platform: 'fb' }] })
      const out = await mod.enqueueSocialPost({ tenantId: null, platform: 'fb', caption: 'hi' })
      expect(out).toMatchObject({ id: 'sp-1' })
      expect(poolQuery.mock.calls[0][1][8]).toBeNull() // scheduledAt → null → COALESCE now()
    })

    it('enqueueSocialPost serialises an explicit scheduledAt', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'sp-2' }] })
      const when = new Date('2031-05-05T05:05:05.000Z')
      await mod.enqueueSocialPost({ tenantId: 't-1', platform: 'ig', scheduledAt: when })
      expect(poolQuery.mock.calls[0][1][8]).toBe(when.toISOString())
    })

    it('dueSocialPosts applies the limit', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'sp-1' }] })
      await mod.dueSocialPosts(5)
      expect(poolQuery.mock.calls[0][1]).toEqual([5])
    })

    it('listJeffiSocialPosts filters to platform (tenant_id IS NULL) posts', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.listJeffiSocialPosts()
      expect(String(poolQuery.mock.calls[0][0])).toMatch(/tenant_id IS NULL/)
      expect(poolQuery.mock.calls[0][1]).toEqual([100]) // default limit
    })

    it('getSocialPost returns the row or null', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'sp-1' }] })
      await expect(mod.getSocialPost('sp-1')).resolves.toMatchObject({ id: 'sp-1' })
      queueRows({ rows: [] })
      await expect(mod.getSocialPost('nope')).resolves.toBeNull()
    })

    it('updateSocialPost patches only supplied fields', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.updateSocialPost('sp-1', { status: 'posted', postedId: 'fb_9' })
      const sql = String(poolQuery.mock.calls[0][0])
      expect(sql).toMatch(/status=\$1/)
      expect(sql).toMatch(/posted_id=\$2/)
      expect(sql).not.toMatch(/last_error=/)
    })

    it('updateSocialPost bumps attempts and records last_error', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.updateSocialPost('sp-1', { lastError: 'meta 500', bumpAttempts: true })
      const sql = String(poolQuery.mock.calls[0][0])
      expect(sql).toMatch(/last_error=\$1/)
      expect(sql).toMatch(/attempts = attempts \+ 1/)
    })
  })

  // ── integration credentials ──────────────────────────────────────────────
  describe('integration credentials', () => {
    it('saveIntegrationCredential upserts with jsonb meta + ISO expiry', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      const expiry = new Date('2030-02-02T00:00:00.000Z')
      await mod.saveIntegrationCredential({
        tenantId: 't-1', provider: 'google_merchant', label: 'GMC', configEnc: 'enc',
        meta: { accountId: '123' }, expiresAt: expiry,
      })
      const args = poolQuery.mock.calls[0][1]
      expect(args[0]).toBe('t-1')
      expect(args[1]).toBe('google_merchant')
      expect(args[3]).toBe('enc')
      expect(args[4]).toBe(JSON.stringify({ accountId: '123' }))
      expect(args[5]).toBe(expiry.toISOString())
    })

    it('saveIntegrationCredential defaults meta to {} and expiry to null', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.saveIntegrationCredential({ tenantId: 't-1', provider: 'amazon', configEnc: 'enc' })
      const args = poolQuery.mock.calls[0][1]
      expect(args[2]).toBeNull()             // label
      expect(args[4]).toBe(JSON.stringify({})) // meta default
      expect(args[5]).toBeNull()             // expiry
    })

    it('getIntegrationCredential returns the row or null', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'c-1', provider: 'amazon', config_enc: 'enc' }] })
      await expect(mod.getIntegrationCredential('t-1', 'amazon')).resolves.toMatchObject({ id: 'c-1' })
      queueRows({ rows: [] })
      await expect(mod.getIntegrationCredential('t-1', 'none')).resolves.toBeNull()
    })

    it('listIntegrationCredentials omits config_enc from the SELECT', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'c-1', provider: 'amazon' }] })
      await mod.listIntegrationCredentials('t-1')
      const sql = String(poolQuery.mock.calls[0][0])
      expect(sql).not.toMatch(/config_enc/)
    })

    it('deleteIntegrationCredential deletes by tenant + provider', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.deleteIntegrationCredential('t-1', 'amazon')
      expect(String(poolQuery.mock.calls[0][0])).toMatch(/DELETE FROM tenant_integration_credentials/)
      expect(poolQuery.mock.calls[0][1]).toEqual(['t-1', 'amazon'])
    })
  })

  // ── custom domains (read/set/get/delete) ─────────────────────────────────
  describe('custom domains — remaining accessors', () => {
    it('listCustomDomains returns the tenant rows', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'd-1', domain: 'shop.acme.com' }] })
      await expect(mod.listCustomDomains('t-1')).resolves.toHaveLength(1)
    })

    it('setCustomDomainStatus verified sets verified_at; certArn coalesced', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.setCustomDomainStatus('d-1', 'verified', 'arn:cert')
      const sql = String(poolQuery.mock.calls[0][0])
      expect(sql).toMatch(/verified_at=CASE WHEN \$1='verified'/)
      expect(poolQuery.mock.calls[0][1]).toEqual(['verified', 'arn:cert', 'd-1'])
    })

    it('setCustomDomainStatus passes null certArn when omitted', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.setCustomDomainStatus('d-1', 'pending')
      expect(poolQuery.mock.calls[0][1]).toEqual(['pending', null, 'd-1'])
    })

    it('getCustomDomain returns the row or null', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 'd-1', domain: 'shop.acme.com' }] })
      await expect(mod.getCustomDomain('d-1')).resolves.toMatchObject({ id: 'd-1' })
      queueRows({ rows: [] })
      await expect(mod.getCustomDomain('nope')).resolves.toBeNull()
    })

    it('deleteCustomDomain scopes the delete to the tenant', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [] })
      await mod.deleteCustomDomain('d-1', 't-1')
      expect(poolQuery.mock.calls[0][1]).toEqual(['d-1', 't-1'])
    })
  })

  // ── plan feature matrix ──────────────────────────────────────────────────
  describe('planFeatureMatrix', () => {
    it('groups scope keys by plan slug into Sets', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [
        { slug: 'pro', scope_key: 'products:read' },
        { slug: 'pro', scope_key: 'orders:read' },
        { slug: 'basic', scope_key: 'products:read' },
      ] })
      const matrix = await mod.planFeatureMatrix()
      expect(matrix.pro).toBeInstanceOf(Set)
      expect(matrix.pro.has('products:read')).toBe(true)
      expect(matrix.pro.has('orders:read')).toBe(true)
      expect(matrix.basic.has('products:read')).toBe(true)
      expect(matrix.basic.has('orders:read')).toBe(false)
    })
  })

  // ── host resolution: custom-domain + status + infra branches ─────────────
  describe('resolveTenantFromHost — deeper branches', () => {
    it('resolves an active tenant WITH infra into a full context', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{
        id: 't-1', slug: 'acme', status: 'active', plan: 'pro',
        rds_endpoint: 'ep', rds_db: 'db1', rds_port: 6000, db_secret_ref: 'sec',
        iam_auth: false, s3_bucket: 'bkt', region: 'ap-south-1',
      }] })
      const ctx = await mod.resolveTenantFromHost('acme.jeffistores.in')
      expect(ctx).toMatchObject({
        tenantId: 't-1', slug: 'acme', plan: 'pro',
        infra: { rdsEndpoint: 'ep', rdsDb: 'db1', rdsPort: 6000, dbSecretRef: 'sec', iamAuth: false, s3Bucket: 'bkt', region: 'ap-south-1' },
      })
    })

    it('applies infra defaults when optional columns are missing', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 't-1', slug: 'acme', status: 'active', plan: null, rds_endpoint: 'ep' }] })
      const ctx = await mod.resolveTenantFromHost('acme.jeffistores.in')
      expect(ctx!.plan).toBeNull()
      expect(ctx!.infra).toMatchObject({ rdsDb: 'jeffi_stores', rdsPort: 5432, iamAuth: true, region: 'us-east-1', dbSecretRef: null, s3Bucket: null })
    })

    it('returns null context (null infra) for a tenant with no rds_endpoint', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 't-1', slug: 'acme', status: 'active', plan: 'pro', rds_endpoint: null }] })
      const ctx = await mod.resolveTenantFromHost('acme.jeffistores.in')
      expect(ctx).toMatchObject({ tenantId: 't-1', infra: null })
    })

    it('does NOT serve a non-active tenant', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 't-1', slug: 'acme', status: 'suspended', rds_endpoint: 'ep' }] })
      await expect(mod.resolveTenantFromHost('acme.jeffistores.in')).resolves.toBeNull()
    })

    it('resolves a custom domain via the tenant_custom_domains lookup', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 't-1', slug: 'acme', status: 'active', plan: 'pro', rds_endpoint: 'ep' }] })
      const ctx = await mod.resolveTenantFromHost('shop.acme.com')
      expect(ctx).toMatchObject({ tenantId: 't-1' })
      expect(String(poolQuery.mock.calls[0][0])).toMatch(/tenant_custom_domains/)
    })

    it('fails CLOSED (throws) on a tenant host when the control-plane query throws', async () => {
      const mod = await importRegistry()
      poolQuery.mockReset()
      poolQuery.mockRejectedValue(new Error('cp down'))
      await expect(mod.resolveTenantFromHost('acme.jeffistores.in')).rejects.toThrow('cp down')
    })

    it('still fails open (null) on a platform host when the control plane is down', async () => {
      const mod = await importRegistry()
      poolQuery.mockReset()
      poolQuery.mockRejectedValue(new Error('cp down'))
      await expect(mod.resolveTenantFromHost('jeffistores.in')).resolves.toBeNull()
    })
  })

  // ── lookupTenantContextBySlug ────────────────────────────────────────────
  describe('lookupTenantContextBySlug', () => {
    it('resolves and caches by slug key', async () => {
      const mod = await importRegistry()
      queueRows({ rows: [{ id: 't-1', slug: 'acme', status: 'active', plan: 'pro', rds_endpoint: 'ep' }] })
      const ctx = await mod.lookupTenantContextBySlug('acme')
      expect(ctx).toMatchObject({ tenantId: 't-1' })
      const after = poolQuery.mock.calls.length
      // cached — no new query
      await mod.lookupTenantContextBySlug('acme')
      expect(poolQuery.mock.calls.length).toBe(after)
    })

    it('fails open to null on a control-plane error', async () => {
      const mod = await importRegistry()
      poolQuery.mockReset()
      poolQuery.mockRejectedValue(new Error('boom'))
      await expect(mod.lookupTenantContextBySlug('acme')).resolves.toBeNull()
    })
  })
})
