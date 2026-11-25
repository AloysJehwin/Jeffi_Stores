import { afterEach, describe, expect, it } from 'vitest'
import { costFor, loadPrices, resetPrices, tokenUsage, unitPrice, openAiUsage, usdInr, DEFAULT_PRICES } from '../src/pricing'

afterEach(() => { resetPrices() })

describe('pricing', () => {
  it('prices razer work at a small non-zero compute cost', () => {
    loadPrices('')
    expect(unitPrice('razer', 'sdxl', 'image')).toBeGreaterThan(0)
    expect(unitPrice('ollama', 'gemma4:12b', 'token_1k_out')).toBeGreaterThan(0)
  })

  it('multiplies units by the unit price and rounds to 4 dp', () => {
    loadPrices('')
    const per = unitPrice('replicate', 'black-forest-labs/flux-dev', 'image')
    expect(costFor('replicate', 'black-forest-labs/flux-dev', { image: 3 })).toBeCloseTo(per * 3, 4)
    const sec = unitPrice('google', 'veo-3.1-fast-generate-preview', 'video_second')
    expect(costFor('google', 'veo-3.1-fast-generate-preview', { video_second: 8 })).toBeCloseTo(sec * 8, 4)
  })

  it('falls back to longest prefix, then provider wildcard, then 0', () => {
    loadPrices(JSON.stringify({ google: { 'veo-3': { video_second: 10 } } }))
    expect(unitPrice('google', 'veo-3.9-new', 'video_second')).toBe(10)
    expect(unitPrice('google', 'some-unknown-model', 'image')).toBe(DEFAULT_PRICES.google['*'].image)
    expect(unitPrice('nobody', 'x', 'image')).toBe(0)
  })

  it('applies AI_PRICES_JSON overrides cell by cell', () => {
    loadPrices(JSON.stringify({ razer: { '*': { image: 1.5 } }, newco: { m: { image: 2 } } }))
    expect(unitPrice('razer', 'any', 'image')).toBe(1.5)
    expect(unitPrice('razer', 'any', 'token_1k_in')).toBe(DEFAULT_PRICES.razer['*'].token_1k_in)
    expect(costFor('newco', 'm', { image: 2 })).toBe(4)
  })

  it('rejects malformed overrides', () => {
    expect(() => loadPrices('{nope')).toThrow(/AI_PRICES_JSON/)
  })

  it('prices every Azure capability, with a wildcard for unknown deployments', () => {
    loadPrices('')
    const usd = usdInr()
    expect(unitPrice('azure', 'gpt-4.1-mini-2025-04-14', 'token_1k_in')).toBeCloseTo(0.0004 * usd, 6)
    expect(unitPrice('azure', 'gpt-4o-mini-2024-07-18', 'token_1k_out')).toBeCloseTo(0.0006 * usd, 6)
    expect(unitPrice('azure', 'text-embedding-3-small', 'token_1k_in')).toBeCloseTo(0.00002 * usd, 8)
    expect(unitPrice('azure', 'gpt-image-1:medium', 'image')).toBeCloseTo(0.042 * usd, 6)
    expect(unitPrice('azure', 'gpt-image-1-mini:low', 'image')).toBeCloseTo(0.005 * usd, 6)
    expect(unitPrice('azure', 'sora-2', 'video_second')).toBeCloseTo(0.1 * usd, 6)
    expect(unitPrice('azure', 'whisper', 'audio_minute')).toBeCloseTo(0.006 * usd, 6)
    expect(unitPrice('azure', 'azure-speech-stt', 'audio_minute')).toBeCloseTo(usd / 60, 6)
    expect(unitPrice('azure', 'azure-speech-tts', 'tts_1k_chars')).toBeCloseTo(0.015 * usd, 6)
    expect(unitPrice('azure', 'my-deployment', 'audio_minute')).toBe(DEFAULT_PRICES.azure['*'].audio_minute)
    expect(costFor('azure', 'azure-speech-tts', { tts_1k_chars: 2 })).toBeCloseTo(0.03 * usd, 4)
  })

  it('bills cached OpenAI prompt tokens at the cache-read price', () => {
    loadPrices(JSON.stringify({ azure: { m: { token_1k_in: 1, token_1k_out: 4, token_1k_cache_read: 0.25 } } }))
    expect(openAiUsage('azure', 'm', { prompt_tokens: 2000, completion_tokens: 1000, prompt_tokens_details: { cached_tokens: 1000 } }))
      .toEqual({ promptTokens: 2000, completionTokens: 1000, costInr: 1 + 0.25 + 4, cacheReadTokens: 1000, billedPromptTokens: 1250 })
    expect(openAiUsage('azure', 'm', { prompt_tokens: 1000, completion_tokens: 0 })).toEqual({ promptTokens: 1000, completionTokens: 0, costInr: 1 })
    expect(openAiUsage('azure', 'm', undefined)).toEqual({ promptTokens: 0, completionTokens: 0, costInr: 0 })
  })

  it('maps token counts to thousands for cost', () => {
    loadPrices(JSON.stringify({ ollama: { '*': { token_1k_in: 1, token_1k_out: 2 } } }))
    expect(tokenUsage('ollama', 'qwen2.5:7b', 1500, 500)).toEqual({ promptTokens: 1500, completionTokens: 500, costInr: 2.5 })
    expect(tokenUsage('ollama', 'qwen2.5:7b', -5, NaN)).toEqual({ promptTokens: 0, completionTokens: 0, costInr: 0 })
  })
})
