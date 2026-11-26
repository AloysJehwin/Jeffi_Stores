// Per-provider model choice. A request may carry `models` (provider -> model id); each id must be on that provider's
// list for the capability (GET /v1/providers shows the lists), else 400. The provider that answers uses its model.

import type { ModelChoice, ModelOption } from '../../sdk/types'
import { CONFIG, VISION_MODEL, modelForHint } from './config'
import { ValidationError } from './errors'

export type Capability = 'text' | 'image' | 'video' | 'stt' | 'tts' | 'embed'

/** One provider's models for one capability. An empty list, or `open` (Ollama never answered), checks nothing. */
export interface ModelList {
  models: ModelOption[]
  open?: boolean
  /** Other spellings accepted for a listed id (e.g. azure's vector-space id for its embeddings deployment). */
  aliases?: Record<string, string>
}
/** null: the provider does not serve the capability. */
export type ProviderModels = (cap: Capability) => ModelList | null
export type ModelSource = (provider: string, cap: Capability) => ModelList | null

const ID = /^[A-Za-z0-9._:/@-]{1,128}$/
const WHAT: Record<Capability, string> = { text: 'text', image: 'image', video: 'video', stt: 'speech-to-text', tts: 'text-to-speech', embed: 'embeddings' }

export function modelSource(providers: Record<string, ProviderModels>): ModelSource {
  return (provider, cap) => (Object.prototype.hasOwnProperty.call(providers, provider) ? providers[provider](cap) : null)
}

/** Resolves one choice against its provider's list: the listed id, or a ValidationError. */
export function checkModel(provider: string, id: unknown, cap: Capability, source?: ModelSource): string {
  if (typeof id !== 'string' || !ID.test(id)) throw new ValidationError(`models.${provider} is not a model id`)
  if (!source) return id
  const list = source(provider, cap)
  if (!list) throw new ValidationError(`${provider} is not a ${WHAT[cap]} provider`)
  const resolved = list.aliases?.[id] ?? id
  if (list.open || !list.models.length || list.models.some(m => m.id === resolved)) return resolved
  throw new ValidationError(`${provider} has no ${WHAT[cap]} model "${id}"; allowed: ${list.models.map(m => m.id).join(', ')}`)
}

export function parseModels(raw: unknown, cap: Capability, source?: ModelSource): ModelChoice | undefined {
  if (raw == null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('models must be an object of provider to model id')
  const out: ModelChoice = {}
  for (const [provider, id] of Object.entries(raw as Record<string, unknown>)) {
    if (id == null || id === '') continue
    out[provider] = checkModel(provider, id, cap, source)
  }
  return Object.keys(out).length ? out : undefined
}

const ACRONYMS: Record<string, string> = { gpt: 'GPT', sdxl: 'SDXL', tts: 'TTS', hd: 'HD', t2v: 'T2V', i2v: 'I2V', flux: 'FLUX' }
const LABELS: Record<string, string> = { 'azure-speech-stt': 'Azure Speech', 'azure-speech-tts': 'Azure Speech' }

/** 'claude-sonnet-5-5' -> 'Claude Sonnet 5.5', 'gemma4:12b' -> 'Gemma4 12B', 'bulbul:v4-flash' -> 'Bulbul v4 Flash'. */
export function modelLabel(id: string): string {
  if (LABELS[id]) return LABELS[id]
  const out: string[] = []
  for (const t of (id.split('/').pop() || id).replace(/@\d+$/, '').split(/[-_:\s]+/).filter(Boolean)) {
    if (t === 'latest') continue
    const prev = out[out.length - 1]
    if (/^\d+$/.test(t) && prev && /^\d+$/.test(prev)) { out[out.length - 1] = `${prev}.${t}`; continue }
    const low = t.toLowerCase()
    out.push(ACRONYMS[low] ?? (/^\d+(\.\d+)?[bm]$/i.test(t) ? t.toUpperCase() : /^v\d/i.test(t) ? low : /^\d/.test(t) ? t : t[0].toUpperCase() + t.slice(1)))
  }
  return out.join(' ') || id
}

/** Unique ids in order, labelled, the default flagged. */
export function options(ids: (string | undefined | null)[], def?: string): ModelOption[] {
  const seen = new Set<string>()
  const out: ModelOption[] = []
  for (const id of ids) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, label: modelLabel(id), ...(id === def ? { default: true } : {}) })
  }
  return out
}

/** Ollama's installed models, at most `maxAgeMs` old; the last good list outlives an outage. */
export class InstalledModels {
  private names: string[] | null = null
  private at = -Infinity
  private inflight: Promise<void> | null = null

  constructor(private readonly fetchNames: () => Promise<string[]>, private readonly maxAgeMs = 60_000, private readonly now: () => number = Date.now) {}

  /** null until a fetch succeeds; a stale list refreshes in the background. */
  list(): string[] | null {
    if (this.now() - this.at >= this.maxAgeMs) void this.refresh()
    return this.names
  }

  refresh(): Promise<void> {
    this.inflight ??= this.fetchNames()
      .then(n => { this.names = [...new Set(n.map(x => x.replace(/:latest$/, '')).filter(Boolean))] })
      .catch(() => undefined)
      .finally(() => { this.at = this.now(); this.inflight = null })
    return this.inflight
  }
}

export const RAZER_IMAGE_MODEL = 'sdxl-turbo'
const EMBED_NAME = /embed/i
const HINTS = ['copy', 'sql', 'agent', 'deep', 'fast', 'email', 'enrich'] as const

/** razer: text from the configured hint models plus whatever Ollama has installed; embeddings likewise; one SD model. */
export function razerModels(installed: () => string[] | null): ProviderModels {
  return cap => {
    if (cap === 'image') return { models: options([RAZER_IMAGE_MODEL], RAZER_IMAGE_MODEL) }
    if (cap !== 'text' && cap !== 'embed') return null
    const names = installed()
    if (cap === 'embed') return { models: options([CONFIG.embedModel, ...(names ?? []).filter(n => EMBED_NAME.test(n))], CONFIG.embedModel), open: names === null }
    const def = modelForHint(undefined)
    const configured = [def, ...HINTS.map(h => modelForHint(h)), VISION_MODEL]
    return { models: options([...configured, ...(names ?? []).filter(n => !EMBED_NAME.test(n))], def), open: names === null }
  }
}
