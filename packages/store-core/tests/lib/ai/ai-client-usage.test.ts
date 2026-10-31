import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockFetch = vi.fn()
global.fetch = mockFetch

vi.mock('@/lib/tenancy/tenant-context', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/tenancy/tenant-context')>()),
  resolveTenantId: vi.fn(async () => null),
}))
vi.mock('@/lib/ai/billing', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/ai/billing')>()
  return { AiWalletError: real.AiWalletError, recordUsage: vi.fn() }
})

import { aiChat, aiEmbed, __resetAiClientState } from '@/lib/shared/ai-client'
import { recordUsage, AiWalletError } from '@/lib/ai/billing'

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
const flush = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  mockFetch.mockReset()
  vi.mocked(recordUsage).mockReset().mockResolvedValue({ usageId: 'u1', priceInr: 0.1 })
  __resetAiClientState()
})

describe('aiChat usage logging', () => {
  it('records token units and the gateway cost under the caller feature', async () => {
    mockFetch.mockResolvedValueOnce(
      ok({ content: 'x', provider: 'ollama', model: 'gemma3:4b', latencyMs: 9, fallbackUsed: false, cache: null, usage: { promptTokens: 1500, completionTokens: 500, costInr: 0.04 } })
    )
    await aiChat({ messages: [{ role: 'user', content: 'hi' }], feature: 'social_caption' })
    await flush()
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'social_caption',
        capability: 'text',
        provider: 'ollama',
        units: [
          { type: 'token_1k_in', qty: 1.5 },
          { type: 'token_1k_out', qty: 0.5 },
        ],
        costInr: 0.04,
      })
    )
  })

  it('treats a missing usage block as zero and defaults the feature to text', async () => {
    mockFetch.mockResolvedValueOnce(ok({ content: 'x', provider: 'ollama', model: 'm', latencyMs: 1, fallbackUsed: false }))
    await aiChat({ messages: [{ role: 'user', content: 'hi' }] })
    await flush()
    expect(vi.mocked(recordUsage).mock.calls[0][0]).toMatchObject({ feature: 'text', costInr: 0, units: [{ qty: 0 }, { qty: 0 }] })
  })

  it('skips logging with billing: false', async () => {
    mockFetch.mockResolvedValueOnce(ok({ content: 'x', provider: 'ollama', model: 'm', latencyMs: 1, fallbackUsed: false }))
    await aiChat({ messages: [{ role: 'user', content: 'hi' }], billing: false })
    await flush()
    expect(recordUsage).not.toHaveBeenCalled()
  })

  it('still returns the result when the wallet cannot pay', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(recordUsage).mockRejectedValue(new AiWalletError('short', 0, 1))
    mockFetch.mockResolvedValueOnce(ok({ content: 'kept', provider: 'ollama', model: 'm', latencyMs: 1, fallbackUsed: false }))
    const r = await aiChat({ messages: [{ role: 'user', content: 'hi' }] })
    await flush()
    expect(r.content).toBe('kept')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unpaid'))
    warn.mockRestore()
  })

  it('does not send feature or billing to the gateway as unknown fields only', async () => {
    mockFetch.mockResolvedValueOnce(ok({ content: 'x', provider: 'ollama', model: 'm', latencyMs: 1, fallbackUsed: false }))
    await aiChat({ messages: [{ role: 'user', content: 'hi' }], feature: 'product_copy' })
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).messages).toHaveLength(1)
  })
})

describe('aiEmbed usage logging', () => {
  it('records embed tokens', async () => {
    mockFetch.mockResolvedValueOnce(ok({ embeddings: [[0.1]], model: 'nomic-embed-text', usage: { promptTokens: 2000, costInr: 0.01 } }))
    expect(await aiEmbed('hello')).toEqual([[0.1]])
    await flush()
    await flush()
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'embed', capability: 'embed', units: [{ type: 'token_1k_in', qty: 2 }], costInr: 0.01 })
    )
  })
})
