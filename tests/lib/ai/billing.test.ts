import { describe, it, expect, vi, beforeEach } from 'vitest'

const cpQuery = vi.fn()
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: cpQuery }) }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn() }))
vi.mock('@/lib/integrations/owner', () => ({
  credentialOwnerId: vi.fn(),
  isPlatformOwner: (id: string) => id === '00000000-0000-0000-0000-000000000000',
}))
vi.mock('@jeffi/wallet', () => ({ debit: vi.fn(), trueUp: vi.fn() }))
vi.mock('@/lib/payments/wallet', () => ({ getTenantWallet: vi.fn() }))

import { preauthorize, settle, recordUsage, AiWalletError, __resetAiBillingCache } from '@/lib/ai/billing'
import { query, queryOne } from '@/lib/shared/db'
import { credentialOwnerId } from '@/lib/integrations/owner'
import { debit, trueUp } from '@jeffi/wallet'

const TENANT = '11111111-1111-1111-1111-111111111111'
const FLAGSHIP = '00000000-0000-0000-0000-000000000000'
const USAGE = '22222222-2222-2222-2222-222222222222'

const PRICES: Record<string, { provider: string; model: string; price_inr: string; cost_inr: string }[]> = {
  'image:image': [
    { provider: 'razer', model: '*', price_inr: '2', cost_inr: '0.3' },
    { provider: 'google', model: 'gemini-3.1-flash-image', price_inr: '6', cost_inr: '3.3' },
  ],
  'text:token_1k_in': [{ provider: 'ollama', model: '*', price_inr: '0.06', cost_inr: '0.02' }],
  'text:token_1k_out': [{ provider: 'ollama', model: '*', price_inr: '0.06', cost_inr: '0.02' }],
  'video:video_second': [{ provider: 'google', model: '*', price_inr: '15', cost_inr: '8.5' }],
}

const imageInput = { feature: 'social_image', capability: 'image' as const, provider: 'google', model: 'gemini-3.1-flash-image' }

beforeEach(() => {
  vi.clearAllMocks()
  __resetAiBillingCache()
  cpQuery.mockImplementation(async (_sql: string, [cap, unit]: string[]) => ({ rows: PRICES[`${cap}:${unit}`] ?? [] }))
  vi.mocked(credentialOwnerId).mockResolvedValue(TENANT)
  vi.mocked(queryOne).mockImplementation(async (sql: string) => {
    if (/INSERT INTO ai_usage/.test(sql)) return { id: USAGE }
    if (/SELECT feature, capability/.test(sql))
      return { feature: 'social_image', capability: 'image', provider: 'google', model: 'gemini-3.1-flash-image', wallet_ref: `ai:${USAGE}` }
    return null
  })
  vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 1 } as any)
  vi.mocked(debit).mockResolvedValue({ ok: true, charged: true, balance: 100 } as any)
  vi.mocked(trueUp).mockResolvedValue(undefined)
})

describe('preauthorize', () => {
  it('prices the estimate and debits the wallet keyed to ai:<usageId>', async () => {
    const r = await preauthorize({ ...imageInput, estimateUnits: [{ type: 'image', qty: 2 }] })
    expect(r).toEqual({ usageId: USAGE, priceInr: 12 })
    expect(debit).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, amountInr: 12, category: 'ai', externalRef: `ai:${USAGE}` })
    )
  })

  it('throws a 402 AiWalletError when the balance cannot pay, and marks the row failed', async () => {
    vi.mocked(debit).mockResolvedValue({ ok: false, error: 'insufficient_balance', balance: 3, needed: 9 } as any)
    const err = await preauthorize({ ...imageInput, estimateUnits: [{ type: 'image', qty: 2 }] }).catch(e => e)
    expect(err).toBeInstanceOf(AiWalletError)
    expect(err.status).toBe(402)
    expect(err.balanceInr).toBe(3)
    expect(err.neededInr).toBe(9)
    expect(vi.mocked(query).mock.calls.some(c => /status = 'failed'/.test(c[0]))).toBe(true)
  })

  it('never touches the wallet on the flagship and logs price 0', async () => {
    vi.mocked(credentialOwnerId).mockResolvedValue(FLAGSHIP)
    const r = await preauthorize({ ...imageInput, estimateUnits: [{ type: 'image', qty: 1 }] })
    expect(r.priceInr).toBe(0)
    expect(debit).not.toHaveBeenCalled()
    expect(vi.mocked(queryOne).mock.calls[0][1]?.[5]).toBe(0)
  })

  it('falls back to the provider default row, then any same-capability row, without failing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const razer = await preauthorize({ ...imageInput, provider: 'razer', model: 'sdxl-checkpoint-v9', estimateUnits: [{ type: 'image', qty: 1 }] })
    expect(razer.priceInr).toBe(2)
    const unknown = await preauthorize({ ...imageInput, provider: 'newvendor', model: 'x', estimateUnits: [{ type: 'image', qty: 1 }] })
    expect(unknown.priceInr).toBe(2)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('charges 0 when the capability has no price rows at all', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await preauthorize({ ...imageInput, capability: 'vision', estimateUnits: [{ type: 'call', qty: 1 }] })
    expect(r.priceInr).toBe(0)
    warn.mockRestore()
  })
})

describe('settle', () => {
  it('trues the wallet up to the exact price', async () => {
    await settle(USAGE, { units: [{ type: 'image', qty: 3 }], costInr: 9.9, latencyMs: 1200, cache: null, status: 'ok' })
    expect(trueUp).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, amountInr: 18, externalRef: `ai:${USAGE}` }))
    const upd = vi.mocked(query).mock.calls.find(c => /UPDATE ai_usage SET units/.test(c[0]))!
    expect(upd[1]).toEqual([USAGE, JSON.stringify([{ type: 'image', qty: 3 }]), 9.9, 18, 1200, null, 'ok', null])
  })

  it('refunds to 0 on a failed call', async () => {
    await settle(USAGE, { units: [{ type: 'image', qty: 0 }], costInr: 0, status: 'failed', error: 'provider down' })
    expect(trueUp).toHaveBeenCalledWith(expect.objectContaining({ amountInr: 0, externalRef: `ai:${USAGE}` }))
  })

  it('does not true-up the flagship', async () => {
    vi.mocked(credentialOwnerId).mockResolvedValue(FLAGSHIP)
    await settle(USAGE, { units: [{ type: 'image', qty: 1 }], costInr: 3.3, status: 'ok' })
    expect(trueUp).not.toHaveBeenCalled()
  })

  it('preauthorize then settle nets to the exact price', async () => {
    const { usageId, priceInr } = await preauthorize({ ...imageInput, estimateUnits: [{ type: 'image', qty: 1 }] })
    expect(priceInr).toBe(6)
    await settle(usageId, { units: [{ type: 'image', qty: 2 }], costInr: 6.6, status: 'ok' })
    expect(debit).toHaveBeenCalledTimes(1)
    expect(vi.mocked(trueUp).mock.calls[0][0].amountInr).toBe(12)
  })
})

describe('recordUsage', () => {
  const text = {
    feature: 'social_caption',
    capability: 'text' as const,
    provider: 'ollama',
    model: 'gemma3:4b',
    units: [
      { type: 'token_1k_in' as const, qty: 2 },
      { type: 'token_1k_out' as const, qty: 0.5 },
    ],
    costInr: 0.05,
  }

  it('debits the exact price once', async () => {
    const r = await recordUsage(text)
    expect(r.priceInr).toBeCloseTo(0.15, 4)
    expect(debit).toHaveBeenCalledTimes(1)
    expect(trueUp).not.toHaveBeenCalled()
  })

  it('marks the row unpaid and throws when the wallet cannot pay', async () => {
    vi.mocked(debit).mockResolvedValue({ ok: false, error: 'insufficient_balance', balance: 0, needed: 0.15 } as any)
    await expect(recordUsage(text)).rejects.toBeInstanceOf(AiWalletError)
    expect(vi.mocked(query).mock.calls.some(c => /status = 'unpaid'/.test(c[0]))).toBe(true)
  })

  it('logs the flagship with price 0 and no debit', async () => {
    vi.mocked(credentialOwnerId).mockResolvedValue(FLAGSHIP)
    const r = await recordUsage(text)
    expect(r.priceInr).toBe(0)
    expect(debit).not.toHaveBeenCalled()
  })
})
