import { describe, it, expect, vi, beforeEach } from 'vitest'

// Studio corrections: today's free ones first, the rest charged per correction, and only at the price the owner saw.

const m = vi.hoisted(() => ({
  used: 0,
  poolQuery: vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] })),
  getOwnerTenants: vi.fn(),
  getWalletBalance: vi.fn(),
  runPaidGeneration: vi.fn(),
  funded: vi.fn((_id: string, _budget: number, fn: () => Promise<unknown>) => fn()),
}))

const client = {
  query: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.startsWith('SELECT used')) return { rows: [{ used: m.used }] }
    if (sql.startsWith('UPDATE')) m.used += Number(params?.[1])
    return { rows: [] }
  }),
  release: vi.fn(),
}

vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ connect: async () => client, query: m.poolQuery }), getOwnerTenants: m.getOwnerTenants }))
vi.mock('@/lib/payments/wallet', () => ({ getWalletBalance: m.getWalletBalance, isFlagshipTenant: () => false }))
vi.mock('@/lib/ai/paid-generation', () => ({ runPaidGeneration: m.runPaidGeneration }))
vi.mock('@/lib/showcase/workspace', () => ({ ensureShowcaseWorkspace: vi.fn() }))
vi.mock('@controller/lib/showcase/billing', () => ({ showcaseWalletTenant: vi.fn() }))
vi.mock('@controller/lib/showcase-builder/site', () => ({ ownerShowcase: vi.fn() }))
vi.mock('@controller/lib/showcase-builder/build', () => ({ WALLET_URL: '/dashboard/wallet' }))
vi.mock('@controller/lib/site-studio/funded', () => ({ funded: m.funded }))

import { claimCorrection, runCorrection } from '@controller/lib/site-studio/corrections'
import { CORRECTION_PRICE_INR, CORRECTIONS_FREE_PER_DAY } from '@controller/lib/site-studio/allowance'

const session = { id: 's1', owner_id: 'o1', product: 'store' } as any
const gaveBack = () => m.poolQuery.mock.calls.filter(c => c[0].includes('used - $2')).map(c => c[1]?.[1])

beforeEach(() => {
  vi.clearAllMocks()
  m.used = 0
  m.getOwnerTenants.mockResolvedValue([{ id: 't1', status: 'active' }])
  m.getWalletBalance.mockResolvedValue({ balance: 100, minBalance: 0 })
})

describe('claimCorrection', () => {
  it('is free within the day', async () => {
    const r = await claimCorrection(session, 1, undefined)
    expect(r).toEqual({ ok: true, correction: expect.objectContaining({ free: 1, chargeInr: 0 }) })
    expect(m.used).toBe(1)
  })

  it('charges what the free ones do not cover, only at the price shown', async () => {
    m.used = CORRECTIONS_FREE_PER_DAY - 2
    const unseen = await claimCorrection(session, 5, undefined)
    expect(unseen).toMatchObject({ ok: false, status: 409, extra: { code: 'price_changed', chargeInr: 3 * CORRECTION_PRICE_INR } })
    expect(gaveBack()).toEqual([2])

    m.used = CORRECTIONS_FREE_PER_DAY - 2
    const r = await claimCorrection(session, 5, CORRECTION_PRICE_INR)
    expect(r).toEqual({ ok: true, correction: expect.objectContaining({ free: 2, chargeInr: 3 * CORRECTION_PRICE_INR, tenantId: 't1' }) })
  })

  it('blocks without a wallet or with too little in it', async () => {
    m.used = CORRECTIONS_FREE_PER_DAY
    m.getOwnerTenants.mockResolvedValue([])
    expect(await claimCorrection(session, 1, CORRECTION_PRICE_INR)).toMatchObject({ ok: false, status: 402, extra: { code: 'wallet_low', topUpUrl: null } })
    m.getOwnerTenants.mockResolvedValue([{ id: 't1', status: 'active' }])
    m.getWalletBalance.mockResolvedValue({ balance: 4, minBalance: 0 })
    expect(await claimCorrection(session, 1, CORRECTION_PRICE_INR)).toMatchObject({ ok: false, status: 402, extra: { code: 'wallet_low', neededInr: CORRECTION_PRICE_INR - 4 } })
  })
})

describe('runCorrection', () => {
  it('runs free ones platform-funded and paid ones as a flat wallet charge', async () => {
    await runCorrection({ sessionId: 's1', ownerId: 'o1', free: 1, chargeInr: 0, tenantId: null }, 25, 'x', async () => 'ok')
    expect(m.funded).toHaveBeenCalled()
    m.runPaidGeneration.mockResolvedValue({ result: 'ok', chargedInr: 30, costInr: 1 })
    const r = await runCorrection({ sessionId: 's1', ownerId: 'o1', free: 2, chargeInr: 30, tenantId: 't1' }, 60, 'x', async () => 'ok')
    expect(r).toEqual({ result: 'ok', chargedInr: 30 })
    expect(m.runPaidGeneration.mock.calls[0][0]).toMatchObject({ tenantId: 't1', capInr: 30, flat: { budgetInr: 60 } })
  })

  it('gives the free ones back when the work fails', async () => {
    await expect(runCorrection({ sessionId: 's1', ownerId: 'o1', free: 2, chargeInr: 0, tenantId: null }, 25, 'x', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(gaveBack()).toEqual([2])
  })
})
