import { describe, it, expect, vi, beforeEach } from 'vitest'

const query = vi.hoisted(() => vi.fn())
const resolveTenantId = vi.hoisted(() => vi.fn())
const getFeatureFlags = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId }))
vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags }))

import {
  getProviderPolicy,
  getAiRouting,
  invalidateProviderPolicy,
  normalizeProviderValue,
  setProviderSetting,
  clearProviderSetting,
  PROVIDER_SETTING_KEYS,
  PLATFORM_ONLY_PROVIDER_KEYS,
} from '@/lib/providers/policy'
import { DEFAULT_SARVAM_VOICES, mergeVoiceSettings } from '@/lib/providers/voice-settings'

const T = '11111111-1111-1111-1111-111111111111'
const rows = (r: { tenant_id: string | null; key: string; value: unknown }[]) => ({ rows: r, rowCount: r.length })

beforeEach(() => {
  vi.clearAllMocks()
  invalidateProviderPolicy()
  resolveTenantId.mockResolvedValue(T)
  getFeatureFlags.mockResolvedValue({ smsProvider: 'twilio', whatsappProvider: 'twilio' })
})

describe('sms_dlt_entity_id setting', () => {
  it('tenant row beats platform default; blank or oversized values are ignored', async () => {
    query.mockResolvedValue(rows([{ tenant_id: null, key: 'sms_dlt_entity_id', value: '1100000000000000001' }, { tenant_id: T, key: 'sms_dlt_entity_id', value: ' 1100000000000000002 ' }]))
    const p = await getProviderPolicy(T)
    expect(p.smsDltEntityId).toBe('1100000000000000002')
    expect(p.source.sms_dlt_entity_id).toBe('tenant')
    expect(normalizeProviderValue('sms_dlt_entity_id', '  ')).toBeNull()
    expect(normalizeProviderValue('sms_dlt_entity_id', '1'.repeat(31))).toBeNull()
    expect(normalizeProviderValue('sms_dlt_entity_id', 'TEN')).toBeNull()
    expect(normalizeProviderValue('sms_dlt_entity_id', 5)).toBeNull()
  })
})

describe('provider policy resolution', () => {
  it('tenant override beats platform default', async () => {
    query.mockResolvedValue(
      rows([
        { tenant_id: null, key: 'sms_provider', value: 'twilio' },
        { tenant_id: T, key: 'sms_provider', value: 'aws' },
        { tenant_id: null, key: 'ai_image_providers', value: ['google', 'razer'] },
      ])
    )
    const p = await getProviderPolicy(T)
    expect(p.smsProvider).toBe('aws')
    expect(p.source.sms_provider).toBe('tenant')
    expect(p.aiImageProviders).toEqual(['google', 'razer'])
    expect(p.source.ai_image_providers).toBe('platform')
    expect(query.mock.calls[0][1]).toEqual([T])
  })

  it('falls back to the store Site Controls choice for the current store, Twilio otherwise', async () => {
    query.mockResolvedValue(rows([]))
    getFeatureFlags.mockResolvedValue({ smsProvider: 'aws', whatsappProvider: 'twilio' })
    const cur = await getProviderPolicy()
    expect(cur.smsProvider).toBe('aws')
    expect(cur.source.sms_provider).toBe('fallback')
    const explicit = await getProviderPolicy(T)
    expect(explicit.smsProvider).toBe('twilio')
    expect(explicit.aiImageProviders).toEqual([])
  })

  it('platform default wins over the Site Controls fallback', async () => {
    query.mockResolvedValue(rows([{ tenant_id: null, key: 'whatsapp_provider', value: 'twilio' }]))
    getFeatureFlags.mockResolvedValue({ smsProvider: 'twilio', whatsappProvider: 'aws' })
    expect((await getProviderPolicy()).whatsappProvider).toBe('twilio')
  })

  it('the flagship has no override row and reads only the platform default', async () => {
    resolveTenantId.mockResolvedValue(null)
    query.mockResolvedValue(rows([]))
    await getProviderPolicy()
    expect(query.mock.calls[0][1]).toEqual([null])
  })

  it('ignores invalid stored values and survives a control-plane outage', async () => {
    query.mockResolvedValue(rows([{ tenant_id: T, key: 'ai_video_providers', value: ['razer'] }]))
    expect((await getProviderPolicy(T)).aiVideoProviders).toEqual([])
    invalidateProviderPolicy()
    query.mockRejectedValue(new Error('down'))
    expect((await getProviderPolicy(T)).smsProvider).toBe('twilio')
  })

  it('getAiRouting routes text Claude first and omits other capabilities on the gateway default', async () => {
    query.mockResolvedValue(rows([{ tenant_id: null, key: 'ai_video_providers', value: ['replicate'] }]))
    expect(await getAiRouting(T)).toEqual({ text: ['anthropic', 'razer'], video: ['replicate'], embed: 'razer' })
  })
})

describe('Azure, audio and embeddings', () => {
  it('azure is accepted in the text, image and video orders and audio takes only azure', () => {
    expect(normalizeProviderValue('ai_text_providers', ['anthropic', 'razer', 'azure'])).toEqual(['anthropic', 'razer', 'azure'])
    expect(normalizeProviderValue('ai_image_providers', ['azure', 'razer'])).toEqual(['azure', 'razer'])
    expect(normalizeProviderValue('ai_video_providers', ['google', 'azure'])).toEqual(['google', 'azure'])
    expect(normalizeProviderValue('ai_stt_providers', ['azure', 'azure'])).toEqual(['azure'])
    expect(normalizeProviderValue('ai_stt_providers', ['sarvam', 'azure'])).toEqual(['sarvam', 'azure'])
    expect(normalizeProviderValue('ai_tts_providers', ['azure', 'sarvam'])).toEqual(['azure', 'sarvam'])
    expect(normalizeProviderValue('ai_tts_providers', ['razer'])).toBeNull()
  })

  it('ai_embed_provider is a single razer or azure value', () => {
    expect(normalizeProviderValue('ai_embed_provider', 'azure')).toBe('azure')
    expect(normalizeProviderValue('ai_embed_provider', 'razer')).toBe('razer')
    expect(normalizeProviderValue('ai_embed_provider', ['azure'])).toBeNull()
    expect(normalizeProviderValue('ai_embed_provider', 'openai')).toBeNull()
  })

  it('resolves audio like the other orders and embed from the platform default', async () => {
    query.mockResolvedValue(
      rows([
        { tenant_id: null, key: 'ai_stt_providers', value: ['azure'] },
        { tenant_id: null, key: 'ai_tts_providers', value: ['sarvam', 'azure'] },
        { tenant_id: null, key: 'ai_embed_provider', value: 'azure' },
      ])
    )
    const p = await getProviderPolicy(T)
    expect(p.aiSttProviders).toEqual(['azure'])
    expect(p.source.ai_stt_providers).toBe('platform')
    expect(p.aiEmbedProvider).toBe('azure')
    expect(await getAiRouting(T)).toMatchObject({ stt: ['azure'], tts: ['sarvam', 'azure'], embed: 'azure' })
  })

  it('defaults: no audio order (gateway default), embed razer', async () => {
    query.mockResolvedValue(rows([]))
    const p = await getProviderPolicy(T)
    expect(p.aiSttProviders).toEqual([])
    expect(p.aiModels).toEqual({})
    expect(p.aiEmbedProvider).toBe('razer')
    expect(p.source.ai_embed_provider).toBe('fallback')
    const r = await getAiRouting(T)
    expect(r.stt).toBeUndefined()
    expect(r.models).toBeUndefined()
  })

  it('a tenant audio row beats the platform one', async () => {
    query.mockResolvedValue(rows([{ tenant_id: T, key: 'ai_stt_providers', value: ['azure'] }]))
    expect((await getProviderPolicy(T)).source.ai_stt_providers).toBe('tenant')
  })

  it('a store overrides the embeddings provider', async () => {
    query.mockResolvedValue(rows([
      { tenant_id: null, key: 'ai_embed_provider', value: 'razer' },
      { tenant_id: T, key: 'ai_embed_provider', value: 'azure' },
    ]))
    const p = await getProviderPolicy(T)
    expect(p.aiEmbedProvider).toBe('azure')
    expect(p.source.ai_embed_provider).toBe('tenant')
  })
})

describe('ai_models', () => {
  const ok = { text: { anthropic: 'claude-sonnet-5-5', razer: 'llama3.1:8b' }, stt: { sarvam: 'saarika:v2.5' }, embed: { azure: 'text-embedding-3-small' } }

  it('accepts known capabilities and providers with safe ids, dropping empty capabilities', () => {
    expect(normalizeProviderValue('ai_models', ok)).toEqual(ok)
    expect(normalizeProviderValue('ai_models', { text: {} })).toEqual({})
    expect(normalizeProviderValue('ai_models', {})).toEqual({})
  })

  it('rejects unknown capabilities or providers, unsafe ids and non-objects', () => {
    expect(normalizeProviderValue('ai_models', { audio: { azure: 'x' } })).toBeNull()
    expect(normalizeProviderValue('ai_models', { stt: { razer: 'x' } })).toBeNull()
    expect(normalizeProviderValue('ai_models', { text: { anthropic: 'bad id; drop' } })).toBeNull()
    expect(normalizeProviderValue('ai_models', { text: { anthropic: '' } })).toBeNull()
    expect(normalizeProviderValue('ai_models', { text: { anthropic: 5 } })).toBeNull()
    expect(normalizeProviderValue('ai_models', { text: ['anthropic'] })).toBeNull()
    expect(normalizeProviderValue('ai_models', ['text'])).toBeNull()
    expect(normalizeProviderValue('ai_models', 'x')).toBeNull()
  })

  it('resolves with tenant over platform and getAiRouting returns the models', async () => {
    query.mockResolvedValue(rows([
      { tenant_id: null, key: 'ai_models', value: { text: { anthropic: 'claude-haiku-5-5' } } },
      { tenant_id: T, key: 'ai_models', value: ok },
    ]))
    const p = await getProviderPolicy(T)
    expect(p.aiModels).toEqual(ok)
    expect(p.source.ai_models).toBe('tenant')
    expect((await getAiRouting(T)).models).toEqual(ok)
  })
})

describe('cache', () => {
  it('caches per store and drops the cache on write', async () => {
    query.mockResolvedValue(rows([{ tenant_id: null, key: 'sms_provider', value: 'twilio' }]))
    await getProviderPolicy(T)
    await getProviderPolicy(T)
    expect(query).toHaveBeenCalledTimes(1)

    await setProviderSetting(null, 'sms_provider', 'aws', 'ops@x')
    expect(query.mock.calls[1][1]).toEqual([null, 'sms_provider', '"aws"', 'ops@x'])
    query.mockResolvedValue(rows([{ tenant_id: null, key: 'sms_provider', value: 'aws' }]))
    expect((await getProviderPolicy(T)).smsProvider).toBe('aws')

    query.mockResolvedValue({ rows: [], rowCount: 1 })
    expect(await clearProviderSetting(T, 'sms_provider')).toBe(true)
    query.mockResolvedValue(rows([]))
    expect((await getProviderPolicy(T)).smsProvider).toBe('twilio')
  })

  it('expires after 30 seconds', async () => {
    vi.useFakeTimers()
    try {
      query.mockResolvedValue(rows([]))
      await getProviderPolicy(T)
      vi.advanceTimersByTime(31_000)
      await getProviderPolicy(T)
      expect(query).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('normalizeProviderValue', () => {
  it('validates per key and de-duplicates orders', () => {
    expect(normalizeProviderValue('sms_provider', 'aws')).toBe('aws')
    expect(normalizeProviderValue('sms_provider', 'sns')).toBeNull()
    expect(normalizeProviderValue('ai_image_providers', ['google', 'google', 'razer'])).toEqual(['google', 'razer'])
    expect(normalizeProviderValue('ai_image_providers', ['openai'])).toBeNull()
    expect(normalizeProviderValue('ai_text_providers', 'razer')).toBeNull()
    expect(normalizeProviderValue('ai_image_default_quality', 'premium')).toBe('premium')
  })
})

describe('Outreach keys', () => {
  it('are provider setting keys, the voice ones platform-only', () => {
    for (const k of ['voice_provider', 'voice_config', 'sms_dlt_entity_id', 'sms_dlt_sender_ids']) expect(PROVIDER_SETTING_KEYS).toContain(k)
    expect([...PLATFORM_ONLY_PROVIDER_KEYS].sort()).toEqual(['voice_config', 'voice_provider'])
  })

  it('validates voice_provider and the DLT ids', () => {
    expect(normalizeProviderValue('voice_provider', 'exotel')).toBe('exotel')
    expect(normalizeProviderValue('voice_provider', 'twilio_test')).toBe('twilio_test')
    expect(normalizeProviderValue('voice_provider', 'twilio')).toBeNull()
    expect(normalizeProviderValue('sms_dlt_entity_id', ' 1201159123456789012 ')).toBe('1201159123456789012')
    expect(normalizeProviderValue('sms_dlt_entity_id', '12AB')).toBeNull()
    expect(normalizeProviderValue('sms_dlt_sender_ids', ['jeffis', 'JEFFIS', 'JFSHOP'])).toEqual(['JEFFIS', 'JFSHOP'])
    expect(normalizeProviderValue('sms_dlt_sender_ids', ['JEFF'])).toBeNull()
    expect(normalizeProviderValue('sms_dlt_sender_ids', 'JEFFIS')).toBeNull()
  })

  it('normalises voice_config and rejects anything invalid', () => {
    expect(
      normalizeProviderValue('voice_config', {
        exotel: { accountSid: 'jeffi1', subdomain: 'api.in.exotel.com', callerId: '+91 140 123 4567', appId: '', extra: 'x' },
        testNumbers: ['+91 98765 43210', '+919876543210'],
        sarvam: { sttModel: 'saaras:v3', voices: { hi: 'Priya', xx: 'nope' } },
        llmModel: 'claude-haiku-5-5',
        apiKey: 'should-be-dropped',
      })
    ).toEqual({
      exotel: { accountSid: 'jeffi1', subdomain: 'api.in.exotel.com', callerId: '+911401234567' },
      testNumbers: ['+919876543210'],
      sarvam: { sttModel: 'saaras:v3', voices: { hi: 'priya' } },
      llmModel: 'claude-haiku-5-5',
    })
    expect(normalizeProviderValue('voice_config', { exotel: { subdomain: 'evil.example.com' } })).toBeNull()
    expect(normalizeProviderValue('voice_config', { testNumbers: ['9876543210'] })).toBeNull()
    const many = Array.from({ length: 21 }, (_, i) => `+9198765432${String(i).padStart(2, '0')}`)
    expect(normalizeProviderValue('voice_config', { testNumbers: many })).toBeNull()
    expect(normalizeProviderValue('voice_config', { twilioTest: { from: 'abc' } })).toBeNull()
    expect(normalizeProviderValue('voice_config', 'x')).toBeNull()
  })

  it('merges stored voice settings over the defaults', () => {
    const m = mergeVoiceSettings({ sarvam: { voices: { en: 'shubh' } }, testNumbers: ['+919876543210'] })
    expect(m.sarvam).toEqual({ sttModel: 'saaras:v3', ttsModel: 'bulbul:v3', voices: { ...DEFAULT_SARVAM_VOICES, en: 'shubh' } })
    expect(m.llmModel).toBe('claude-haiku-5-5')
    expect(m.exotel.subdomain).toBe('api.in.exotel.com')
    expect(mergeVoiceSettings({ exotel: { subdomain: 'bad' } })).toEqual(mergeVoiceSettings(null))
  })
})
