import { api } from '@/components/admin/kit/core'
import type { SpeechEngine, VoiceLang } from '@/lib/providers/voice-settings'

// Shapes and helpers for Settings → Providers, per GET/PUT/DELETE /api/admin/settings/providers.
// No credential ever reaches this page: secrets are reported by name and presence only.

export const PROVIDERS_URL = '/api/admin/settings/providers'
export const TEST_URL = '/api/admin/settings/providers/credentials/test'

export type Cap = 'text' | 'image' | 'video' | 'stt' | 'tts' | 'embed'
export type OrderCap = Exclude<Cap, 'embed'>

export interface ModelOption {
  id: string
  label: string
  default?: boolean
}
export interface ProviderStatus {
  name: string
  configured: boolean
  healthy?: boolean
  keyFallback?: boolean
  models?: ModelOption[]
}
export type GatewayView = Partial<Record<Cap, ProviderStatus[]>> & {
  defaults?: Partial<Record<OrderCap, string[]>> & { embed?: string | string[] }
}
export interface PriceRow {
  capability: string
  provider: string
  model: string
  unit_type: string
  price_inr: number | string
}
export type SecretGroup = 'ai' | 'messaging' | 'calling' | 'voice'
export interface SecretRow {
  name: string
  group: SecretGroup
  present: boolean
  provider?: string
}
export interface TenantRow {
  id: string
  slug: string
  display_name: string
}
export interface VoiceView {
  provider: 'exotel' | 'twilio_test'
  exotel: { accountSid: string; subdomain: string; callerId: string; appId: string; configured: boolean }
  twilioTest: { from: string; configured: boolean }
  testNumbers: string[]
  sarvam: { sttModel: string; ttsModel: string; voices: Record<VoiceLang, string>; configured: boolean }
  speech: { sttProvider: SpeechEngine; ttsProvider: SpeechEngine }
  azureSpeech: { region: string; voices: Record<VoiceLang, string>; configured: boolean }
  llmModel: string
  anthropic: { federation: boolean; configured: boolean }
  ready: boolean
}
export interface DltView {
  entityId: string | null
  senderIds: string[]
  source?: { entityId: string; senderIds: string }
}
export interface ProvidersData {
  scope: { kind: 'platform' | 'store'; tenantId?: string; tenantName?: string }
  canEdit: { messaging: boolean; calling: boolean; ai: boolean; integrations: boolean }
  settings: Record<string, unknown>
  inherited?: Record<string, unknown>
  /** Keys the store has its own row for; when absent, a key counts as overridden if it differs from inherited. */
  overridden?: string[]
  gateway: GatewayView | null
  prices: PriceRow[]
  secrets?: SecretRow[]
  voice?: VoiceView
  tenants?: TenantRow[]
  messaging?: Record<'sms' | 'whatsapp', Record<'twilio' | 'aws', boolean>>
  dlt?: DltView
}

export const CAPS: { id: Cap; label: string; note?: string }[] = [
  { id: 'text', label: 'Text and chat', note: 'Vision follows text.' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Video' },
  { id: 'stt', label: 'Speech to text' },
  { id: 'tts', label: 'Text to speech' },
  { id: 'embed', label: 'Embeddings' },
]
export const ORDER_KEY: Record<OrderCap, string> = {
  text: 'ai_text_providers',
  image: 'ai_image_providers',
  video: 'ai_video_providers',
  stt: 'ai_stt_providers',
  tts: 'ai_tts_providers',
}
export const EMBED_KEY = 'ai_embed_provider'
export const MODELS_KEY = 'ai_models'
export const QUALITY_KEY = 'ai_image_default_quality'

/** Used when the gateway does not answer. */
export const FALLBACK_PROVIDERS: Record<Cap, string[]> = {
  text: ['anthropic', 'azure', 'razer'],
  image: ['razer', 'google', 'replicate', 'azure'],
  video: ['google', 'replicate', 'azure'],
  stt: ['sarvam', 'azure'],
  tts: ['sarvam', 'azure'],
  embed: ['razer', 'azure'],
}

const LABEL: Record<string, string> = {
  anthropic: 'Claude',
  razer: 'Razer',
  azure: 'Azure',
  google: 'Google',
  replicate: 'Replicate',
  sarvam: 'Sarvam',
  twilio: 'Twilio',
  aws: 'AWS',
  exotel: 'Exotel',
  twilio_test: 'Twilio test line',
}
export const providerLabel = (p: string) => LABEL[p] ?? p

const PRICE_CAPS: Record<Cap, string[]> = { text: ['text'], image: ['image'], video: ['video'], stt: ['stt', 'audio'], tts: ['tts', 'audio'], embed: ['embed'] }
const PRICE_UNIT: Record<Cap, { type: string; label: string }> = {
  text: { type: 'token_1k_in', label: 'per 1k input tokens' },
  image: { type: 'image', label: 'per image' },
  video: { type: 'video_second', label: 'per second' },
  stt: { type: 'audio_minute', label: 'per minute' },
  tts: { type: 'tts_1k_chars', label: 'per 1k characters' },
  embed: { type: 'token_1k_in', label: 'per 1k input tokens' },
}
// The price list names Razer's text and embedding rows after its Ollama backend.
const priceProviders = (p: string) => (p === 'razer' ? ['razer', 'ollama'] : [p])

/** The store's per-unit price for a provider and model: the model's own row, else the provider's '*' row. */
export function priceFor(prices: PriceRow[], cap: Cap, provider: string, model: string | null): { inr: number; unit: string } | null {
  const unit = PRICE_UNIT[cap]
  const rows = prices.filter(r => PRICE_CAPS[cap].includes(r.capability) && priceProviders(provider).includes(r.provider) && r.unit_type === unit.type)
  const row = (model && rows.find(r => r.model === model)) || rows.find(r => r.model === '*')
  if (!row) return null
  const inr = Number(row.price_inr)
  return Number.isFinite(inr) ? { inr, unit: unit.label } : null
}

const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 4 })
export const inr = (v: number) => inrFmt.format(v)

export const statusesOf = (gateway: GatewayView | null, cap: Cap): ProviderStatus[] => gateway?.[cap] ?? []

/** Every provider a capability can use: the gateway's list, else the saved order plus the fallback list. */
export function providersOf(gateway: GatewayView | null, cap: Cap, saved: string[] = []): string[] {
  const listed = statusesOf(gateway, cap).map(s => s.name)
  return [...new Set([...saved, ...(listed.length ? listed : FALLBACK_PROVIDERS[cap])])]
}

export function defaultOrder(gateway: GatewayView | null, cap: OrderCap): string[] {
  return gateway?.defaults?.[cap] ?? FALLBACK_PROVIDERS[cap]
}

export function defaultEmbed(gateway: GatewayView | null): string {
  const d = gateway?.defaults?.embed
  return (Array.isArray(d) ? d[0] : d) || 'razer'
}

export const defaultModel = (models: ModelOption[] | undefined) => models?.find(m => m.default)?.id ?? models?.[0]?.id ?? null

/** Why a provider cannot serve: null when it can, or when the gateway's state is unknown. */
export function unavailableReason(s: ProviderStatus | undefined): string | null {
  if (!s) return null
  if (!s.configured) return 'Not configured: its key is missing from the gateway secret'
  if (s.healthy === false) return 'Unhealthy: the gateway is skipping it for now'
  return null
}

export const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])
export const asText = (v: unknown): string => (typeof v === 'string' ? v : '')
export type ModelMap = Partial<Record<Cap, Record<string, string>>>
export function asModels(v: unknown): ModelMap {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: ModelMap = {}
  for (const [cap, m] of Object.entries(v as Record<string, unknown>)) {
    if (m && typeof m === 'object' && !Array.isArray(m)) out[cap as Cap] = Object.fromEntries(Object.entries(m).filter(([, id]) => typeof id === 'string')) as Record<string, string>
  }
  return out
}

export const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Store view: whether the store has its own value for a key. */
export function isOverridden(data: ProvidersData, key: string): boolean {
  if (data.scope.kind !== 'store') return false
  if (data.overridden) return data.overridden.includes(key)
  return key in data.settings && !same(data.settings[key], data.inherited?.[key])
}

const PREFIX: Record<string, string> = { twilio: 'TWILIO_', twilio_test: 'TWILIO_', aws: 'AWS_', exotel: 'EXOTEL_', sarvam: 'SARVAM_', azure_speech: 'AZURE_SPEECH_', anthropic: 'ANTHROPIC_' }

/** The secrets a provider reads, by the provider tag when the API sends one, else by name prefix. */
export function secretsFor(secrets: SecretRow[] | undefined, provider: string): SecretRow[] {
  if (!secrets) return []
  const tagged = secrets.filter(s => s.provider === provider)
  if (tagged.length) return tagged
  const prefix = PREFIX[provider]
  return prefix ? secrets.filter(s => !s.provider && s.name.startsWith(prefix)) : []
}

/** "Keys in secrets", or the first missing secret's name. null when nothing is known. */
export function keyStatus(secrets: SecretRow[] | undefined, provider: string, ready?: boolean): { ok: boolean; text: string; secret?: boolean } | null {
  const rows = secretsFor(secrets, provider)
  if (rows.length) {
    const missing = rows.filter(r => !r.present)
    if (!missing.length) return { ok: true, text: 'Keys in secrets' }
    return { ok: false, secret: true, text: missing.length > 1 ? `${missing[0].name} and ${missing.length - 1} more missing` : `${missing[0].name} missing` }
  }
  if (ready === undefined) return null
  return ready ? { ok: true, text: 'Ready' } : { ok: false, text: 'Not ready' }
}

export type SaveResult = { ok: boolean; error?: string }

/** One PUT per key, in order; stops at the first failure. */
export async function putSettings(tenantId: string | null, entries: [string, unknown][]): Promise<SaveResult> {
  for (const [key, value] of entries) {
    const { ok, data } = await api(PROVIDERS_URL, { method: 'PUT', json: { tenantId, key, value } })
    if (!ok) return { ok: false, error: data.error || `Could not save ${key}` }
  }
  return { ok: true }
}

export async function clearSettings(tenantId: string | null, keys: string[]): Promise<SaveResult> {
  for (const key of keys) {
    const { ok, data } = await api(`${PROVIDERS_URL}?${new URLSearchParams({ key, ...(tenantId ? { tenantId } : {}) })}`, { method: 'DELETE' })
    if (!ok) return { ok: false, error: data.error || `Could not reset ${key}` }
  }
  return { ok: true }
}

export async function runTest(provider: string): Promise<{ ok: boolean; message: string }> {
  const { ok, data } = await api<{ ok: boolean; message?: string }>(TEST_URL, { method: 'POST', json: { provider } })
  return { ok: ok && !!data.ok, message: data.message || data.error || (ok && data.ok ? 'Test passed' : 'Test failed') }
}
