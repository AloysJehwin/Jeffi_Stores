// Servers are paid from the wallet: each IST day is charged once, into a negative balance if need be; a
// store below zero gets graceDays, then pauses, and starts again once a top-up covers a day.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { presetSpec } from '@/lib/compute/presets'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({ query: vi.fn(), client: { query: vi.fn(), release: vi.fn() } }))
const reg = vi.hoisted(() => ({
  controlPlanePool: () => ({ query: db.query, connect: async () => db.client }),
  getTenant: vi.fn(),
  getTenantOwners: vi.fn(async () => [{ email: 'owner@crm.test', name: 'Owner' }]),
  getProvisioningJob: vi.fn(async () => ({ created_resources: { dbInstanceId: 'jeffi-tenant-acme' } })),
  setTenantInstanceState: vi.fn(),
}))
vi.mock('@/lib/tenant-registry', () => reg)
const wallet = vi.hoisted(() => ({ debitWallet: vi.fn(), getWalletBalance: vi.fn(), isFlagshipTenant: (id: string) => id === 'flagship' }))
vi.mock('@/lib/payments/wallet', () => wallet)
const mail = vi.hoisted(() => ({ sendInfraBalanceEmail: vi.fn() }))
vi.mock('@/lib/shared/ecom-emails', () => mail)
vi.mock('@controller/lib/compute/catalog', () => ({ computeSpecEnabled: () => true }))
vi.mock('@controller/lib/compute/resolve', () => ({
  pausedRateFor: vi.fn(async () => 0.5),
  catalogOrDefault: async () => ({ prices: [], settings: { graceDays: 3 } }),
}))
const store = vi.hoisted(() => ({ getTenantCompute: vi.fn(), patchTenantCompute: vi.fn() }))
vi.mock('@controller/lib/compute/store', () => store)
vi.mock('@controller/lib/provisioning/steps', () => ({ dbInstanceId: (s: string) => `jeffi-tenant-${s}`, reconcileK8sPlan: vi.fn(async () => ({ ok: true })) }))
const k8s = vi.hoisted(() => ({ scaleTenantWorkloadToZero: vi.fn(), tenantNodeInstances: vi.fn(async () => ({ instances: ['i-1'], ready: true })) }))
vi.mock('@/lib/k8s/tenant-compute', () => k8s)
const ec2 = vi.hoisted(() => ({ stopInstance: vi.fn(), startInstance: vi.fn() }))
vi.mock('@/lib/shared/ec2-client', () => ec2)

import { chargeDay, istDayStart, syncComputePeriod } from '@controller/lib/billing/infra-billing'
import { applyInfraBalancePolicy, resumeFundedStores } from '@controller/lib/billing/infra-balance'

const DAY = 86_400_000
const provider = { stopDbInstance: vi.fn(), startDbInstance: vi.fn(), getDbEndpoint: vi.fn(async () => 'ep'), describeDbInstance: vi.fn() } as any
const spec = { ...presetSpec('small'), layout: 'services' }
let row: any
const store_ = (extra: any = {}) => ({ tenant_id: 't-1', slug: 'acme', display_name: 'Acme', rate: 2, status: 'applied', applied: spec, desired: spec, progress: null, low_balance_since: null, balance_warned_at: null, ...extra })

beforeEach(() => {
  vi.clearAllMocks()
  db.client.query.mockResolvedValue({ rows: [] })
  for (const f of [mail.sendInfraBalanceEmail, ec2.stopInstance, ec2.startInstance, provider.stopDbInstance, provider.startDbInstance]) f.mockResolvedValue(undefined)
  wallet.debitWallet.mockResolvedValue({ ok: true, charged: true, balance: 0 })
  row = { applied: spec, desired: spec, rate_inr_hour: '2.0000', status: 'applied', progress: null }
  store.getTenantCompute.mockImplementation(async () => row)
  reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'acme', display_name: 'Acme', status: 'active' })
})

describe('chargeDay', () => {
  it('charges each store once per IST day, even into a negative balance', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ tenant_id: 't-1', hours: '24', inr: '312.004' }, { tenant_id: 't-2', hours: '3', inr: '0' }] })
    const start = istDayStart(new Date('2026-10-30T10:00:00Z'))
    const out = await chargeDay(start)
    expect(db.query.mock.calls[0][1]).toEqual([start, new Date(start.getTime() + DAY)])
    expect(wallet.debitWallet).toHaveBeenCalledTimes(1)
    expect(wallet.debitWallet).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't-1', amountInr: 312, category: 'infra', externalRef: 'infra:t-1:2026-10-30', allowNegative: true, floorInr: 0 })
    )
    expect(out).toEqual([{ tenantId: 't-1', day: '2026-10-30', hours: 24, amountInr: 312, charged: true }])
  })
})

describe('syncComputePeriod', () => {
  const sqls = () => db.client.query.mock.calls.map(c => String(c[0]).trim().split(/\s+/).slice(0, 2).join(' '))
  beforeEach(() => db.query.mockResolvedValue({ rows: [{ status: 'active' }] }))

  it('keeps an open period at the same price', async () => {
    db.client.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('FOR UPDATE') ? [{ id: 'p', rate_inr_hour: '2.0000', storage_inr_hour: '0.5000', paused: false }] : [] }))
    await syncComputePeriod('t-1')
    expect(sqls()).toEqual(['BEGIN', 'SELECT id,', 'COMMIT'])
  })

  it('starts a new one when the store pauses, and closes it when the store is gone', async () => {
    db.client.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('FOR UPDATE') ? [{ id: 'p', rate_inr_hour: '2.0000', storage_inr_hour: '0.5000', paused: false }] : [] }))
    row.status = 'paused'
    await syncComputePeriod('t-1')
    expect(sqls()).toEqual(['BEGIN', 'SELECT id,', 'UPDATE tenant_compute_periods', 'INSERT INTO', 'COMMIT'])
    expect(db.client.query.mock.calls[3][1]).toEqual(['t-1', 2, 0.5, true])

    db.client.query.mockClear()
    db.query.mockResolvedValue({ rows: [{ status: 'suspended' }] })
    await syncComputePeriod('t-1')
    expect(sqls()).toEqual(['BEGIN', 'SELECT id,', 'UPDATE tenant_compute_periods', 'COMMIT'])
  })
})

describe('applyInfraBalancePolicy', () => {
  const now = Date.parse('2026-10-30T19:00:00Z')

  it('gives a store below zero its grace days, then pauses it', async () => {
    wallet.getWalletBalance.mockResolvedValue({ balance: -10 })
    db.query.mockResolvedValueOnce({ rows: [store_()] })
    expect(await applyInfraBalancePolicy(provider, now)).toEqual([{ tenantId: 't-1', action: 'grace' }])
    expect(store.patchTenantCompute).toHaveBeenCalledWith('t-1', { low_balance_since: new Date(now) })
    expect(mail.sendInfraBalanceEmail.mock.calls[0][4]).toEqual({ kind: 'negative', pauseOn: new Date(now + 3 * DAY) })

    db.query.mockResolvedValueOnce({ rows: [store_({ low_balance_since: new Date(now - 2 * DAY).toISOString() })] })
    expect(await applyInfraBalancePolicy(provider, now)).toEqual([])

    db.query.mockResolvedValueOnce({ rows: [store_({ low_balance_since: new Date(now - 3 * DAY).toISOString() })] })
    db.query.mockResolvedValue({ rows: [{ status: 'active' }] })
    expect(await applyInfraBalancePolicy(provider, now)).toEqual([{ tenantId: 't-1', action: 'paused' }])
    expect(reg.setTenantInstanceState).toHaveBeenCalledWith('t-1', 'paused')
    expect(k8s.scaleTenantWorkloadToZero).toHaveBeenCalledWith('acme')
    expect(ec2.stopInstance).toHaveBeenCalledWith('i-1')
    expect(provider.stopDbInstance).toHaveBeenCalledWith('jeffi-tenant-acme')
    expect(store.patchTenantCompute).toHaveBeenLastCalledWith('t-1', { progress: { pause: expect.objectContaining({ instances: ['i-1'], db: 'jeffi-tenant-acme' }) } })
  })

  it('waits for a running change before pausing, and warns a store running low', async () => {
    wallet.getWalletBalance.mockResolvedValue({ balance: -10 })
    db.query.mockResolvedValueOnce({ rows: [store_({ status: 'applying', low_balance_since: new Date(now - 5 * DAY).toISOString() })] })
    expect(await applyInfraBalancePolicy(provider, now)).toEqual([])

    wallet.getWalletBalance.mockResolvedValue({ balance: 100 })
    db.query.mockResolvedValueOnce({ rows: [store_({ low_balance_since: new Date(now - DAY).toISOString() })] })
    expect(await applyInfraBalancePolicy(provider, now)).toEqual([{ tenantId: 't-1', action: 'warned' }])
    expect(store.patchTenantCompute).toHaveBeenCalledWith('t-1', { low_balance_since: null })
    expect(mail.sendInfraBalanceEmail.mock.calls[0][4]).toEqual({ kind: 'low', daysLeft: 2 })
  })
})

describe('resumeFundedStores', () => {
  it('starts a paused store once the wallet covers a day, then brings its pods back', async () => {
    row = { ...row, status: 'paused', progress: { pause: { at: 0, instances: ['i-1'], db: 'jeffi-tenant-acme' } } }
    db.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("status = 'paused'") ? [{ tenant_id: 't-1', rate: 2 }] : [{ status: 'active' }] }))
    wallet.getWalletBalance.mockResolvedValue({ balance: 40 })
    expect(await resumeFundedStores(provider)).toEqual([])

    wallet.getWalletBalance.mockResolvedValue({ balance: 48 })
    expect(await resumeFundedStores(provider)).toEqual([{ tenantId: 't-1', status: 'starting' }])
    expect(provider.startDbInstance).toHaveBeenCalledWith('jeffi-tenant-acme')
    expect(ec2.startInstance).toHaveBeenCalledWith('i-1')

    row = { ...row, progress: store.patchTenantCompute.mock.calls.at(-1)![1].progress }
    expect(await resumeFundedStores(provider)).toEqual([{ tenantId: 't-1', status: 'resumed' }])
    expect(store.patchTenantCompute).toHaveBeenCalledWith('t-1', { status: 'applied', progress: null, low_balance_since: null })
    expect(reg.setTenantInstanceState).toHaveBeenCalledWith('t-1', 'running')
    expect(mail.sendInfraBalanceEmail.mock.calls.at(-1)![4]).toEqual({ kind: 'resumed' })
  })
})
