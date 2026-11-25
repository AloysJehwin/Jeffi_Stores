// /v1/embed: one selected provider, never an order. Vectors from two models live in different spaces, so a
// failure is reported (503/502) instead of falling through to the other provider. `model` picks the provider's model.

import type { EmbedProviderName, EmbedRequest, EmbedResponse, TokenUsage } from '../../sdk/types'
import { NotConfiguredError, UpstreamError, ValidationError } from './errors'
import { checkModel, type ModelSource } from './models'
import { AZURE_EMBED_DIMENSIONS, AZURE_EMBED_MODEL_ID } from './providers/azure'

export const EMBED_PROVIDERS: EmbedProviderName[] = ['razer', 'azure']
const NO_FALLBACK = 'embeddings never fall back to another model'

/** AI_EMBED_PROVIDER; anything unknown keeps today's razer. */
export function defaultEmbedProvider(raw: string | undefined): EmbedProviderName {
  const v = (raw || '').trim()
  if (EMBED_PROVIDERS.includes(v as EmbedProviderName)) return v as EmbedProviderName
  // eslint-disable-next-line no-console
  if (v) console.warn(`[ai-gateway] AI_EMBED_PROVIDER=${v} is not razer or azure; using razer`)
  return 'razer'
}

export interface EmbedDeps {
  defaultProvider: EmbedProviderName
  razer: {
    /** False while Ollama is known down. */
    available(): boolean
    reason(): string
    embed(input: string[], model?: string): Promise<Omit<EmbedResponse, 'provider' | 'dimensions'> & Partial<EmbedResponse>>
  }
  azure: {
    embedConfigured(): boolean
    /** `model`: the vector-space id of the deployment used. */
    embed(input: string[], deployment?: string): Promise<{ embeddings: number[][]; usage: TokenUsage; model?: string }>
  }
  /** Model lists that `model` is checked against. */
  models?: ModelSource
}

export function parseEmbedRequest(raw: unknown, def: EmbedProviderName, source?: ModelSource): { input: string[]; model?: string; provider: EmbedProviderName } {
  const r = (raw ?? {}) as Partial<EmbedRequest>
  const input = typeof r.input === 'string' ? [r.input] : r.input
  if (!Array.isArray(input) || input.some(x => typeof x !== 'string')) throw new ValidationError('input must be a string or an array of strings')
  if (r.provider != null && !EMBED_PROVIDERS.includes(r.provider)) throw new ValidationError(`unknown embed provider: ${String(r.provider)}`)
  const provider = r.provider ?? def
  const model = r.model == null || r.model === '' ? undefined : checkModel(provider, r.model, 'embed', source)
  return { input, model, provider }
}

export async function handleEmbed(raw: unknown, deps: EmbedDeps): Promise<EmbedResponse> {
  const p = parseEmbedRequest(raw, deps.defaultProvider, deps.models)
  if (p.provider === 'azure') {
    if (!deps.azure.embedConfigured()) {
      throw new NotConfiguredError(`embedding provider azure is not configured (AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_EMBED_DEPLOYMENT); ${NO_FALLBACK}`)
    }
    try {
      const r = await deps.azure.embed(p.input, p.model)
      return { embeddings: r.embeddings, model: r.model ?? AZURE_EMBED_MODEL_ID, provider: 'azure', dimensions: AZURE_EMBED_DIMENSIONS, usage: r.usage }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new UpstreamError(`embedding provider azure failed; ${NO_FALLBACK}`, [{ provider: 'azure', error: msg }])
    }
  }
  if (!deps.razer.available()) throw new NotConfiguredError(`embedding provider razer is unavailable (${deps.razer.reason()}); ${NO_FALLBACK}`)
  const r = await deps.razer.embed(p.input, p.model)
  return { ...r, provider: 'razer', dimensions: r.dimensions ?? r.embeddings[0]?.length ?? 768 }
}
