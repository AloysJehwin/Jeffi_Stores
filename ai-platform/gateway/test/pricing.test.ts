import { afterEach, describe, expect, it } from 'vitest'
import { costFor, loadPrices, resetPrices, tokenUsage, unitPrice, DEFAULT_PRICES } from '../src/pricing'

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

  it('maps token counts to thousands for cost', () => {
    loadPrices(JSON.stringify({ ollama: { '*': { token_1k_in: 1, token_1k_out: 2 } } }))
    expect(tokenUsage('ollama', 'qwen2.5:7b', 1500, 500)).toEqual({ promptTokens: 1500, completionTokens: 500, costInr: 2.5 })
    expect(tokenUsage('ollama', 'qwen2.5:7b', -5, NaN)).toEqual({ promptTokens: 0, completionTokens: 0, costInr: 0 })
  })
})
