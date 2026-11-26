import { vi } from 'vitest'
import type { ProvidersData } from '@/components/admin/providers/model'

// Payloads shaped like GET /api/admin/settings/providers (the providers redesign contract): gateway /v1/providers
// with models per provider, ai_price_list rows, secret names with presence (never values) and the voice view.

export const T1 = '7b0c1c3e-4f5a-4b6c-9d8e-1f2a3b4c5d6e'
export const T2 = '0e9d8c7b-6a5f-4e3d-8c2b-1a0f9e8d7c6b'

export const gateway = () => ({
  text: [
    {
      name: 'anthropic',
      configured: true,
      models: [
        { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', default: true },
        { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
        { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      ],
    },
    { name: 'razer', configured: true, healthy: true, models: [{ id: 'qwen3:14b', label: 'qwen3:14b', default: true }, { id: 'llama3.3:70b', label: 'llama3.3:70b' }] },
    { name: 'azure', configured: true, models: [{ id: 'gpt-5-mini', label: 'gpt-5-mini', default: true }] },
  ],
  image: [
    { name: 'razer', configured: true, models: [{ id: 'sdxl', label: 'SDXL', default: true }] },
    {
      name: 'google',
      configured: true,
      models: [
        { id: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image', default: true },
        { id: 'gemini-3-pro-image', label: 'Gemini 3 Pro Image' },
      ],
    },
    { name: 'replicate', configured: false, models: [{ id: 'black-forest-labs/flux-schnell', label: 'FLUX schnell', default: true }] },
    { name: 'azure', configured: true, models: [{ id: 'gpt-image-1', label: 'gpt-image-1', default: true }] },
  ],
  video: [
    { name: 'google', configured: true, models: [{ id: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast', default: true }] },
    { name: 'replicate', configured: false, models: [{ id: 'wan-video/wan-2.2-t2v-fast', label: 'Wan 2.2 fast', default: true }] },
    { name: 'azure', configured: true, models: [{ id: 'sora-2', label: 'Sora 2', default: true }] },
  ],
  stt: [
    { name: 'sarvam', configured: true, models: [{ id: 'saaras:v3', label: 'Saaras v3', default: true }] },
    { name: 'azure', configured: true, models: [{ id: 'azure-speech-stt', label: 'Azure Speech', default: true }] },
  ],
  tts: [
    { name: 'sarvam', configured: true, models: [{ id: 'bulbul:v3', label: 'Bulbul v3', default: true }] },
    { name: 'azure', configured: true, models: [{ id: 'azure-neural', label: 'Azure neural voices', default: true }] },
  ],
  embed: [
    { name: 'razer', configured: true, models: [{ id: 'nomic-embed-text', label: 'nomic-embed-text', default: true }] },
    { name: 'azure', configured: true, models: [{ id: 'text-embedding-3-small', label: 'text-embedding-3-small', default: true }] },
  ],
  defaults: { text: ['anthropic', 'razer', 'azure'], image: ['razer', 'google'], video: ['google'], stt: ['sarvam', 'azure'], tts: ['sarvam', 'azure'], embed: 'razer' },
})

export const prices = () => [
  { capability: 'text', provider: 'anthropic', model: 'claude-sonnet-5-5', unit_type: 'token_1k_in', price_inr: '0.5040' },
  { capability: 'text', provider: 'anthropic', model: 'claude-sonnet-5-5', unit_type: 'token_1k_out', price_inr: '2.5200' },
  { capability: 'text', provider: 'anthropic', model: 'claude-haiku-5-5', unit_type: 'token_1k_in', price_inr: '0.0252' },
  { capability: 'text', provider: 'anthropic', model: 'claude-opus-5-5', unit_type: 'token_1k_in', price_inr: '1.0080' },
  { capability: 'text', provider: 'anthropic', model: '*', unit_type: 'token_1k_in', price_inr: '0.5040' },
  { capability: 'text', provider: 'ollama', model: '*', unit_type: 'token_1k_in', price_inr: '0.0600' },
  { capability: 'text', provider: 'azure', model: '*', unit_type: 'token_1k_in', price_inr: '0.1020' },
  { capability: 'image', provider: 'razer', model: '*', unit_type: 'image', price_inr: '2.0000' },
  { capability: 'image', provider: 'google', model: 'gemini-3.1-flash-image', unit_type: 'image', price_inr: '6.0000' },
  { capability: 'image', provider: 'google', model: 'gemini-3-pro-image', unit_type: 'image', price_inr: '20.0000' },
  { capability: 'image', provider: 'replicate', model: '*', unit_type: 'image', price_inr: '6.0000' },
  { capability: 'image', provider: 'replicate', model: '*', unit_type: 'call', price_inr: '3.0000' },
  { capability: 'video', provider: 'google', model: '*', unit_type: 'video_second', price_inr: '15.0000' },
  { capability: 'stt', provider: 'sarvam', model: '*', unit_type: 'audio_minute', price_inr: '0.9000' },
  { capability: 'audio', provider: 'azure', model: 'azure-speech-stt', unit_type: 'audio_minute', price_inr: '3.0000' },
  { capability: 'tts', provider: 'sarvam', model: '*', unit_type: 'tts_1k_chars', price_inr: '0.6000' },
  { capability: 'audio', provider: 'azure', model: '*', unit_type: 'tts_1k_chars', price_inr: '3.0000' },
  { capability: 'embed', provider: 'ollama', model: '*', unit_type: 'token_1k_in', price_inr: '0.0150' },
  { capability: 'embed', provider: 'azure', model: '*', unit_type: 'token_1k_in', price_inr: '0.0051' },
]

export const secrets = () => [
  { name: 'ANTHROPIC_API_KEY', group: 'ai', present: true },
  { name: 'AZURE_OPENAI_API_KEY', group: 'ai', present: true },
  { name: 'GEMINI_API_KEY', group: 'ai', present: true },
  { name: 'REPLICATE_API_TOKEN', group: 'ai', present: false },
  { name: 'TWILIO_ACCOUNT_SID', group: 'messaging', present: true },
  { name: 'TWILIO_AUTH_TOKEN', group: 'messaging', present: true },
  { name: 'EXOTEL_API_KEY', group: 'calling', present: true },
  { name: 'EXOTEL_API_TOKEN', group: 'calling', present: false },
  { name: 'SARVAM_API_KEY', group: 'voice', present: true },
  { name: 'AZURE_SPEECH_KEY', group: 'voice', present: true },
]

const VOICES = {
  sarvam: { en: 'ishita', hi: 'priya', ta: 'ishita', te: 'neha', kn: 'neha', ml: 'pooja', mr: 'priya', bn: 'roopa', gu: 'priya' },
  azure: {
    en: 'en-IN-NeerjaNeural',
    hi: 'hi-IN-SwaraNeural',
    ta: 'ta-IN-PallaviNeural',
    te: 'te-IN-ShrutiNeural',
    kn: 'kn-IN-SapnaNeural',
    ml: 'ml-IN-SobhanaNeural',
    mr: 'mr-IN-AarohiNeural',
    bn: 'bn-IN-TanishaaNeural',
    gu: 'gu-IN-DhwaniNeural',
  },
}

export const voice = () => ({
  provider: 'exotel' as const,
  exotel: { accountSid: 'jeffi1', subdomain: 'api.in.exotel.com', callerId: '+911401234567', appId: '12345', configured: false },
  twilioTest: { from: '+14155550100', configured: true },
  testNumbers: ['+919876543210'],
  sarvam: { sttModel: 'saaras:v3', ttsModel: 'bulbul:v3', voices: { ...VOICES.sarvam }, configured: true },
  speech: { sttProvider: 'sarvam' as const, ttsProvider: 'sarvam' as const },
  azureSpeech: { region: 'centralindia', voices: { ...VOICES.azure }, configured: true },
  llmModel: 'claude-haiku-5-5',
  anthropic: { federation: true, configured: true },
  ready: false,
})

export const platformData = (over: Partial<ProvidersData> = {}): ProvidersData =>
  ({
    scope: { kind: 'platform' },
    canEdit: { messaging: true, calling: true, ai: true, integrations: true },
    settings: {
      sms_provider: 'twilio',
      whatsapp_provider: 'aws',
      voice_provider: 'exotel',
      ai_text_providers: ['anthropic', 'razer'],
      ai_image_providers: ['razer', 'google', 'replicate'],
      ai_embed_provider: 'razer',
      ai_models: { text: { anthropic: 'claude-sonnet-5-5' } },
      sms_dlt_entity_id: '1201159000000000001',
      sms_dlt_sender_ids: ['JEFFIS'],
    },
    inherited: {},
    gateway: gateway(),
    prices: prices(),
    secrets: secrets(),
    voice: voice(),
    tenants: [
      { id: T1, slug: 'acme', display_name: 'Acme Store' },
      { id: T2, slug: 'halo', display_name: 'Halo Audio' },
    ],
    messaging: { sms: { twilio: true, aws: false }, whatsapp: { twilio: true, aws: true } },
    ...over,
  }) as ProvidersData

const storeSettings = {
  sms_provider: 'twilio',
  whatsapp_provider: 'twilio',
  ai_text_providers: ['anthropic', 'razer'],
  ai_image_providers: ['google', 'razer'],
  ai_embed_provider: 'razer',
  ai_models: { text: { anthropic: 'claude-sonnet-5-5' } },
}

/** What a store admin gets: its own effective settings, the platform's as inherited, no secrets or voice. */
export const storeData = (over: Partial<ProvidersData> = {}): ProvidersData =>
  ({
    scope: { kind: 'store', tenantId: T1, tenantName: 'Acme Store' },
    canEdit: { messaging: false, calling: false, ai: true, integrations: false },
    settings: { ...storeSettings },
    inherited: { ...storeSettings, ai_image_providers: ['razer', 'google'] },
    gateway: gateway(),
    prices: prices(),
    ...over,
  }) as ProvidersData

export type Call = { url: string; method: string; body: any }

/** Stubs fetch: GETs answer `get(url)`, other methods answer from `routes` ("PUT /path") or { ok: true }. */
export function mockApi(get: (url: string) => unknown, routes: Record<string, { status?: number; body: unknown }> = {}) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined })
      const hit = routes[`${method} ${url.split('?')[0]}`]
      const status = hit?.status ?? 200
      const body = method === 'GET' && !hit ? get(url) : (hit?.body ?? { ok: true })
      return { ok: status < 400, status, json: async () => body }
    })
  )
  return calls
}

export const writes = (calls: Call[]) => calls.filter(c => c.method !== 'GET')
