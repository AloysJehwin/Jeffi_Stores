import { describe, it, expect, vi, beforeEach } from 'vitest'

// The control plane's ai_wallet_holds, in memory; walletTx rolls it back when its callback throws.
type Hold = Record<string, any>
const holds = new Map<string, Hold>()
const holdDb = { query: vi.fn(async (sql: string, p: any[] = []) => holdSql(sql, p)) }
const cpQuery = vi.fn()

vi.mock('@jeffi/wallet', () => ({
  trueUp: vi.fn(),
  debitIn: vi.fn(),
  trueUpIn: vi.fn(),
  controlPlanePool: () => holdDb,
  walletTx: async (fn: (c: unknown) => Promise<unknown>) => {
    const snapshot = new Map([...holds].map(([k, v]) => [k, { ...v }]))
    try {
      return await fn(holdDb)
    } catch (e) {
      holds.clear()
      snapshot.forEach((v, k) => holds.set(k, v))
      throw e
    }
  },
}))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: cpQuery }), lookupTenantContextById: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: vi.fn(), runWithTenantContext: vi.fn((_ctx: unknown, fn: () => unknown) => fn()) }))
vi.mock('@/lib/integrations/owner', () => ({ isPlatformOwner: (id: string) => id === '00000000-0000-0000-0000-000000000000' }))
vi.mock('@/lib/ai/billing', () => ({ runPlatformFunded: (_label: string, _budget: number, fn: () => Promise<unknown>) => fn() }))

import { generationCharge, runPaidGeneration, PaidGenerationError, estimateGeneration, sweepStaleHolds } from '@/lib/ai/paid-generation'
import { meterAiCost, metered } from '@/lib/ai/cost-meter'
import { debitIn, trueUp, trueUpIn } from '@jeffi/wallet'
import { query } from '@/lib/shared/db'
import { lookupTenantContextById } from '@/lib/tenant-registry'
import { resolveTenant, runWithTenantContext } from '@/lib/tenancy/tenant-context'

const TENANT = '11111111-1111-1111-1111-111111111111'
const REF = 'aigen:site:abc'
const KEY = `${TENANT}|${REF}`
const gen = { tenantId: TENANT, capInr: 900, ref: 'site:abc', label: 'Site generation (Site Builder)' }
const STORE = { tenantId: TENANT, slug: 's', displayName: null, plan: null, infra: { rdsEndpoint: 'db' } }

function holdSql(sql: string, p: any[]) {
  const h = holds.get(`${p[0]}|${p[1]}`)
  const res = (rows: unknown[] = []) => ({ rows, rowCount: rows.length })
  if (sql.startsWith('INSERT INTO ai_wallet_holds')) {
    holds.set(`${p[0]}|${p[1]}`, { tenant_id: p[0], external_ref: p[1], cap_inr: String(p[2]), margin: String(p[3]), feature: p[4], usage_db: p[5], cost_inr: '0', started: Date.now(), settled_by: null, charged_inr: null, last_error: null })
    return res([{}])
  }
  if (sql.includes('GREATEST(cost_inr')) {
    if (h && !h.settled_by) h.cost_inr = String(Math.max(Number(h.cost_inr), p[2]))
    return res()
  }
  if (sql.includes('FOR UPDATE')) return res(h ? [{ ...h }] : [])
  if (sql.includes('SET settled_at')) return res([Object.assign(h!, { settled_by: p[2], charged_inr: String(p[3]), cost_inr: String(p[4]) })])
  if (sql.includes('SET last_error')) {
    if (h && !h.settled_by) h.last_error = p[2]
    return res()
  }
  if (sql.includes('WHERE settled_at IS NULL AND started_at')) {
    return res([...holds.values()].filter(x => !x.settled_by && x.started <= Date.now() - p[0] * 1000).map(x => ({ ...x, started_at: new Date(x.started) })))
  }
  throw new Error(`unexpected SQL: ${sql}`)
}

/** An open hold taken three hours ago, as a run that died leaves it. */
const seedHold = (over: Hold = {}) =>
  holds.set(KEY, { tenant_id: TENANT, external_ref: REF, cap_inr: '900', margin: '1.5', cost_inr: '10', feature: 'site_generation', usage_db: 'store', started: Date.now() - 3 * 3600_000, settled_by: null, charged_inr: null, last_error: null, ...over })

const usageRows = () => [...vi.mocked(query).mock.calls, ...cpQuery.mock.calls].filter(c => /INSERT INTO ai_usage/.test(String(c[0])))

beforeEach(() => {
  vi.clearAllMocks()
  holds.clear()
  delete process.env.AI_REGEN_MARGIN
  vi.mocked(debitIn).mockResolvedValue({ ok: true, charged: true, balance: 100 } as any)
  vi.mocked(trueUpIn).mockResolvedValue(undefined)
  vi.mocked(trueUp).mockResolvedValue(undefined)
  vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 1 } as any)
  vi.mocked(resolveTenant).mockResolvedValue(STORE as any)
  vi.mocked(lookupTenantContextById).mockResolvedValue(STORE as any)
})

describe('generationCharge', () => {
  it('is provider cost × margin to the paisa, never above the cap', () => {
    expect(generationCharge(12.345, 900, 1.5)).toBe(18.52)
    expect(generationCharge(700, 900, 1.5)).toBe(900)
    expect(generationCharge(0, 900, 1.5)).toBe(0)
    expect(generationCharge(-3, 900, 1.5)).toBe(0)
  })

  it('reads the margin from AI_REGEN_MARGIN, ignoring one below 1', () => {
    process.env.AI_REGEN_MARGIN = '2'
    expect(generationCharge(10, 900)).toBe(20)
    process.env.AI_REGEN_MARGIN = '0.5'
    expect(generationCharge(10, 900)).toBe(15)
  })
})

describe('runPaidGeneration', () => {
  it('holds and records the cap, runs on a budget of cap / margin, and trues the hold up to cost × margin', async () => {
    const r = await runPaidGeneration(gen, async () => {
      expect(metered()?.remainingInr).toBe(600)
      meterAiCost(20)
      meterAiCost(5.2)
      return 'site'
    })
    expect(debitIn).toHaveBeenCalledWith(holdDb, { tenantId: TENANT, amountInr: 900, category: 'ai', externalRef: REF, note: 'AI: Site generation (Site Builder)' })
    expect(trueUpIn).toHaveBeenCalledWith(holdDb, { tenantId: TENANT, amountInr: 37.8, externalRef: REF })
    expect(r).toEqual({ chargedInr: 37.8, costInr: 25.2, result: 'site' })
    expect(holds.get(KEY)).toMatchObject({ cap_inr: '900', margin: '1.5', feature: 'site_generation', usage_db: 'store', cost_inr: '25.2', settled_by: 'run', charged_inr: '37.8' })
    expect(usageRows().map(c => c[1])).toEqual([['site_generation', 37.8, REF, 'site:abc']])
  })

  it('checkpoints the running cost on its hold, one write at a time', async () => {
    await runPaidGeneration(gen, async () => {
      meterAiCost(1)
      meterAiCost(2)
      meterAiCost(3)
      await new Promise(r => setTimeout(r, 0))
      expect(holds.get(KEY)!.cost_inr).toBe('6')
    })
    const writes = holdDb.query.mock.calls.filter(c => /GREATEST\(cost_inr/.test(c[0]))
    expect(writes.map(c => c[1]![2])).toEqual([1, 6])
  })

  it('refuses with a 402 wallet_low before running when the wallet cannot hold the cap', async () => {
    vi.mocked(debitIn).mockResolvedValue({ ok: false, error: 'insufficient_balance', balance: 120, needed: 780 } as any)
    const fn = vi.fn()
    const err = await runPaidGeneration(gen, fn).catch(e => e)
    expect(err).toBeInstanceOf(PaidGenerationError)
    expect(err.status).toBe(402)
    expect(err.body()).toMatchObject({ code: 'wallet_low', balanceInr: 120, neededInr: 780, capInr: 900 })
    expect(fn).not.toHaveBeenCalled()
    expect(trueUpIn).not.toHaveBeenCalled()
    expect(holds.size).toBe(0)
  })

  it('refuses a ref that already ran', async () => {
    vi.mocked(debitIn).mockResolvedValue({ ok: true, charged: false, balance: 1000 } as any)
    const fn = vi.fn()
    const err = await runPaidGeneration(gen, fn).catch(e => e)
    expect(err.code).toBe('duplicate')
    expect(fn).not.toHaveBeenCalled()
    expect(holds.size).toBe(0)
  })

  it('refunds the whole hold when fn throws before spending, and rethrows', async () => {
    const boom = new Error('draft failed')
    await expect(runPaidGeneration(gen, async () => Promise.reject(boom))).rejects.toBe(boom)
    expect(trueUpIn).toHaveBeenCalledWith(holdDb, expect.objectContaining({ amountInr: 0, externalRef: REF }))
    expect(usageRows()).toEqual([])
  })

  it('charges what was spent when fn throws after spending', async () => {
    const boom = new Error('half way')
    await expect(
      runPaidGeneration(gen, async () => {
        meterAiCost(10)
        throw boom
      })
    ).rejects.toBe(boom)
    expect(trueUpIn).toHaveBeenCalledWith(holdDb, expect.objectContaining({ amountInr: 15 }))
  })

  it('never charges the flagship', async () => {
    const r = await runPaidGeneration({ ...gen, tenantId: '00000000-0000-0000-0000-000000000000' }, async () => {
      meterAiCost(40)
      return 1
    })
    expect(debitIn).not.toHaveBeenCalled()
    expect(trueUpIn).not.toHaveBeenCalled()
    expect(holds.size).toBe(0)
    expect(r).toEqual({ chargedInr: 0, costInr: 40, result: 1 })
  })

  it('writes a services tenant’s charge row to the platform database, not its own', async () => {
    vi.mocked(resolveTenant).mockResolvedValue({ ...STORE, infra: null } as any)
    await runPaidGeneration({ ...gen, capInr: 100, feature: 'showcase_generation' }, async () => {
      meterAiCost(10)
    })
    expect(holds.get(KEY)).toMatchObject({ usage_db: 'platform', feature: 'showcase_generation' })
    expect(query).not.toHaveBeenCalled()
    expect(cpQuery).toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO ai_usage/), ['showcase_generation', 15, REF, 'site:abc'])
  })

  it('reports the whole hold as charged and leaves it to the sweep when the true-up keeps failing', async () => {
    vi.useFakeTimers()
    vi.mocked(trueUpIn).mockRejectedValue(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const p = runPaidGeneration(gen, async () => {
      meterAiCost(10)
    })
    await vi.runAllTimersAsync()
    expect((await p).chargedInr).toBe(900)
    expect(trueUpIn).toHaveBeenCalledTimes(3)
    expect(holds.get(KEY)).toMatchObject({ settled_by: null, cost_inr: '10' })
    expect(usageRows()).toEqual([])
    err.mockRestore()
    vi.useRealTimers()
  })

  it('trues the debit up directly when its hold record is gone', async () => {
    const r = await runPaidGeneration(gen, async () => {
      meterAiCost(10)
      holds.clear()
    })
    expect(r.chargedInr).toBe(15)
    expect(trueUp).toHaveBeenCalledWith({ tenantId: TENANT, amountInr: 15, externalRef: REF, note: 'AI: Site generation (Site Builder)' })
  })
})

describe('sweepStaleHolds', () => {
  it('settles a hold open two hours on: recorded cost × margin, the rest refunded, one charge row', async () => {
    seedHold()
    const s = await sweepStaleHolds()
    expect(s).toEqual({ settled: [{ tenantId: TENANT, walletRef: REF, costInr: 10, chargedInr: 15, refundedInr: 885 }], failed: [] })
    expect(trueUpIn).toHaveBeenCalledWith(holdDb, { tenantId: TENANT, amountInr: 15, externalRef: REF })
    expect(holds.get(KEY)).toMatchObject({ settled_by: 'sweep', charged_inr: '15' })
    expect(runWithTenantContext).toHaveBeenCalledWith(STORE, expect.any(Function))
    expect(usageRows().map(c => c[1])).toEqual([['site_generation', 15, REF, 'site:abc']])
    // Settled once: the next run has nothing to do.
    expect(await sweepStaleHolds()).toEqual({ settled: [], failed: [] })
    expect(trueUpIn).toHaveBeenCalledTimes(1)
  })

  it('never charges above the cap, and writes a platform-logged run’s row to the platform database', async () => {
    seedHold({ cap_inr: '100', cost_inr: '80', usage_db: 'platform', feature: 'showcase_generation' })
    const s = await sweepStaleHolds()
    expect(s.settled[0]).toMatchObject({ chargedInr: 100, refundedInr: 0 })
    expect(query).not.toHaveBeenCalled()
    expect(cpQuery).toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO ai_usage/), ['showcase_generation', 100, REF, 'site:abc'])
  })

  it('refunds the whole hold when nothing was spent, with no charge row', async () => {
    seedHold({ cost_inr: '0' })
    expect((await sweepStaleHolds()).settled[0]).toMatchObject({ chargedInr: 0, refundedInr: 900 })
    expect(trueUpIn).toHaveBeenCalledWith(holdDb, expect.objectContaining({ amountInr: 0 }))
    expect(usageRows()).toEqual([])
  })

  it('leaves younger holds alone', async () => {
    seedHold({ started: Date.now() - 3600_000 })
    expect(await sweepStaleHolds()).toEqual({ settled: [], failed: [] })
    expect(trueUpIn).not.toHaveBeenCalled()
  })

  it('keeps a hold it cannot settle open, notes why, and reports it as new only once', async () => {
    seedHold()
    vi.mocked(trueUpIn).mockRejectedValue(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = await sweepStaleHolds()
    expect(first.failed).toEqual([{ tenantId: TENANT, walletRef: REF, capInr: 900, error: 'db down', firstFailure: true }])
    expect(holds.get(KEY)).toMatchObject({ settled_by: null, charged_inr: null, last_error: 'db down' })
    expect((await sweepStaleHolds()).failed[0].firstFailure).toBe(false)
    err.mockRestore()
  })

  it('settles a hold once when the sweep gets there first: the run keeps its charge and writes no row of its own', async () => {
    const r = await runPaidGeneration(gen, async () => {
      meterAiCost(10)
      await new Promise(res => setTimeout(res, 0))
      expect((await sweepStaleHolds(0)).settled).toMatchObject([{ chargedInr: 15, refundedInr: 885 }])
      // Spent after the sweep settled: not charged.
      meterAiCost(30)
      return 'late'
    })
    expect(r).toEqual({ chargedInr: 15, costInr: 40, result: 'late' })
    expect(trueUpIn).toHaveBeenCalledTimes(1)
    expect(holds.get(KEY)).toMatchObject({ settled_by: 'sweep', charged_inr: '15', cost_inr: '10' })
    expect(usageRows()).toHaveLength(1)
  })
})

describe('estimateGeneration', () => {
  it('gives a typical range in rupees, never above the cap', () => {
    const e = estimateGeneration('store_site', { capInr: 1500 })
    expect(e.lowInr).toBeGreaterThan(0)
    expect(e.highInr).toBeGreaterThanOrEqual(e.lowInr)
    expect(e.highInr).toBeLessThanOrEqual(1500)
    expect(estimateGeneration('store_site', { capInr: 1500, images: true }).highInr).toBeGreaterThan(e.highInr)
    expect(estimateGeneration('store_site', { capInr: 600 }).highInr).toBe(600)
    expect(estimateGeneration('one_page').capInr).toBe(100)
    expect(estimateGeneration('one_page', { capInr: 20 }).highInr).toBeLessThanOrEqual(20)
  })
})
