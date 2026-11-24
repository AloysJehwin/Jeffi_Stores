import { describe, it, expect, vi, beforeEach } from 'vitest'

const st = vi.hoisted(() => ({ ledger: null as any, until: null as string | null, infra: {} as Record<string, string> }))
const query = vi.hoisted(() =>
  vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('FROM wallet_ledger')) return { rows: st.ledger ? [st.ledger] : [] }
    if (sql.includes('AS until')) return { rows: [{ until: st.until }] }
    if (sql.includes('FROM platform_infra')) return { rows: st.infra[params[0] ?? sql.match(/key = '(\w+)'/)![1]] ? [{ value: st.infra[sql.match(/key = '(\w+)'/)![1]] }] : [] }
    return { rows: [] }
  })
)
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))
const creditWallet = vi.hoisted(() => vi.fn())
vi.mock('@/lib/payments/wallet', () => ({ creditWallet }))
vi.mock('@controller/lib/billing/subscription', () => ({ applyChange: vi.fn(), quote: vi.fn(), currentSubscription: vi.fn(), isPaying: vi.fn() }))
vi.mock('@/lib/billing/ad-free', () => ({ AD_FREE_PRICE_INR: 500 }))
vi.mock('@/lib/billing/messaging-addon', () => ({ getMessagingAddonPricing: vi.fn().mockResolvedValue({ priceInr: 500 }) }))

import { applyMigrationCredits, billingMode, cutoverAt, legacyCredit, proratedCredit, startMigration } from '@controller/lib/billing/migrate'
import { applyChange, currentSubscription, isPaying } from '@controller/lib/billing/subscription'
import { DAY, T, line } from './fixtures'

const start = Date.parse('2026-12-01T00:00:00Z')
const until = start + 30 * DAY

beforeEach(() => {
  vi.clearAllMocks()
  st.ledger = null
  st.until = null
  st.infra = {}
  creditWallet.mockResolvedValue({ ok: true, credited: true, balance: 0 })
})

describe('proratedCredit (section 3)', () => {
  it('credits paid × (until − t) / (until − period_start)', () => {
    expect(proratedCredit(200, start, until, start + 15 * DAY)).toBe(100)
    expect(proratedCredit(500, start, until, start + 20 * DAY)).toBe(166.67)
  })

  it('never credits below zero or above what was paid', () => {
    expect(proratedCredit(200, start, until, until + DAY)).toBe(0)
    expect(proratedCredit(200, start, until, start - 5 * DAY)).toBe(200)
    expect(proratedCredit(0, start, until, start)).toBe(0)
    expect(proratedCredit(200, until, start, start)).toBe(0)
  })
})

describe('legacy credits', () => {
  const legacy = line({ kind: 'ad_free', status: 'legacy_wallet', legacyRef: `ad_free:${T}:2026-12-01` })

  it('reads the period from the wallet debit and the entitlement end', async () => {
    st.ledger = { amount: '-500', occurred_at: '2026-12-01T05:00:00Z' }
    st.until = new Date(until).toISOString()
    expect(await legacyCredit(legacy, start + 15 * DAY)).toBe(250)
  })

  it('credits the wallet once per wallet-paid period, keyed migrate:<ref>, in the debit category', async () => {
    st.ledger = { amount: '-500', occurred_at: '2026-12-01T05:00:00Z' }
    st.until = new Date(until).toISOString()
    expect(await applyMigrationCredits([legacy], start + 15 * DAY)).toBe(250)
    expect(creditWallet).toHaveBeenCalledWith(expect.objectContaining({ tenantId: T, amountInr: 250, category: 'ad_free', externalRef: `migrate:ad_free:${T}:2026-12-01` }))
    // A repeat finds the credit already there.
    creditWallet.mockResolvedValue({ ok: true, credited: false, balance: 0 })
    expect(await applyMigrationCredits([legacy], start + 15 * DAY)).toBe(0)
  })

  it('credits nothing without a wallet debit or for a line that was never wallet-paid', async () => {
    expect(await applyMigrationCredits([legacy, line({ legacyRef: null })])).toBe(0)
    expect(creditWallet).not.toHaveBeenCalled()
  })
})

describe('cutover', () => {
  it('reads billing_mode and billing_cutover_at', async () => {
    expect(await billingMode()).toBe('wallet')
    st.infra = { billing_mode: 'subscription', billing_cutover_at: '2026-12-01T00:00:00Z' }
    expect(await billingMode()).toBe('subscription')
    expect(await cutoverAt()).toBe('2026-12-01T00:00:00.000Z')
  })

  it('starts now unless the workspace already pays on a subscription (then a replacement keeps its date)', async () => {
    vi.mocked(currentSubscription).mockResolvedValue(null)
    vi.mocked(isPaying).mockReturnValue(false)
    await startMigration(T, { email: 'o@x.in' })
    expect(applyChange).toHaveBeenLastCalledWith(T, { migrate: true, immediate: true }, { email: 'o@x.in' })
    vi.mocked(isPaying).mockReturnValue(true)
    await startMigration(T, { email: 'o@x.in' })
    expect(applyChange).toHaveBeenLastCalledWith(T, { migrate: true, immediate: false }, { email: 'o@x.in' })
  })
})
