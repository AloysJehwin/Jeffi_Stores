import { describe, expect, it, vi } from 'vitest'
import { defaultEmbedProvider, handleEmbed, parseEmbedRequest, type EmbedDeps } from '../src/embed'
import { NotConfiguredError, UpstreamError, ValidationError } from '../src/media'

const usage = { promptTokens: 4, completionTokens: 0, costInr: 0.001 }

function deps(over: { razerUp?: boolean; azureConfigured?: boolean; azureFail?: boolean; def?: 'razer' | 'azure' } = {}) {
  const razerEmbed = vi.fn(async (input: string[], model?: string) => ({ embeddings: input.map(() => [0.1, 0.2, 0.3]), model: model || 'nomic-embed-text', usage }))
  const azureEmbed = vi.fn(async (input: string[]) => {
    if (over.azureFail) throw new Error('azure: HTTP 429')
    return { embeddings: input.map(() => Array(768).fill(0)), usage }
  })
  const d: EmbedDeps = {
    defaultProvider: over.def ?? 'razer',
    razer: { available: () => over.razerUp ?? true, reason: () => 'no healthy Ollama', embed: razerEmbed },
    azure: { embedConfigured: () => over.azureConfigured ?? true, embed: azureEmbed },
  }
  return { d, razerEmbed, azureEmbed }
}

describe('embed provider selection', () => {
  it('AI_EMBED_PROVIDER picks the default; unknown keeps razer', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(defaultEmbedProvider(undefined)).toBe('razer')
    expect(defaultEmbedProvider(' azure ')).toBe('azure')
    expect(defaultEmbedProvider('openai')).toBe('razer')
  })

  it('validates input and provider', () => {
    expect(parseEmbedRequest({ input: 'x' }, 'azure')).toEqual({ input: ['x'], model: undefined, provider: 'azure' })
    expect(parseEmbedRequest({ input: ['a', 'b'], provider: 'razer', model: 'm' }, 'azure')).toEqual({ input: ['a', 'b'], model: 'm', provider: 'razer' })
    expect(() => parseEmbedRequest({ input: 3 }, 'razer')).toThrow(ValidationError)
    expect(() => parseEmbedRequest({ input: ['a', 1] }, 'razer')).toThrow(ValidationError)
    expect(() => parseEmbedRequest({ input: 'a', provider: 'google' }, 'razer')).toThrow(ValidationError)
  })
})

describe('handleEmbed', () => {
  it('razer by default, reporting provider, model and dimensions', async () => {
    const { d, razerEmbed, azureEmbed } = deps()
    const r = await handleEmbed({ input: ['a', 'b'] }, d)
    expect(r).toMatchObject({ provider: 'razer', model: 'nomic-embed-text', dimensions: 3, usage })
    expect(r.embeddings).toHaveLength(2)
    expect(razerEmbed).toHaveBeenCalledWith(['a', 'b'], undefined)
    expect(azureEmbed).not.toHaveBeenCalled()
  })

  it('azure when asked (or by default), as text-embedding-3-small@768', async () => {
    const { d, razerEmbed } = deps({ def: 'azure' })
    const r = await handleEmbed({ input: 'x' }, d)
    expect(r).toMatchObject({ provider: 'azure', model: 'text-embedding-3-small@768', dimensions: 768 })
    expect(razerEmbed).not.toHaveBeenCalled()
    const asked = await handleEmbed({ input: 'x', provider: 'azure' }, deps().d)
    expect(asked.provider).toBe('azure')
  })

  it('never falls back to the other model', async () => {
    const down = deps({ razerUp: false })
    await expect(handleEmbed({ input: 'x' }, down.d)).rejects.toThrow(/razer is unavailable \(no healthy Ollama\); embeddings never fall back/)
    expect(down.azureEmbed).not.toHaveBeenCalled()

    const unconfigured = deps({ azureConfigured: false })
    await expect(handleEmbed({ input: 'x', provider: 'azure' }, unconfigured.d)).rejects.toBeInstanceOf(NotConfiguredError)
    expect(unconfigured.razerEmbed).not.toHaveBeenCalled()

    const failing = deps({ azureFail: true })
    const err = await handleEmbed({ input: 'x', provider: 'azure' }, failing.d).catch(e => e)
    expect(err).toBeInstanceOf(UpstreamError)
    expect(err.tried).toEqual([{ provider: 'azure', error: 'azure: HTTP 429' }])
    expect(failing.razerEmbed).not.toHaveBeenCalled()
  })
})
