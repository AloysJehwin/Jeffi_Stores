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
} from '@/lib/providers/policy'

const T = '11111111-1111-1111-1111-111111111111'
const rows = (r: { tenant_id: string | null; key: string; value: unknown }[]) => ({ rows: r, rowCount: r.length })

beforeEach(() => {
  vi.clearAllMocks()
  invalidateProviderPolicy()
  resolveTenantId.mockResolvedValue(T)
  getFeatureFlags.mockResolvedValue({ smsProvider: 'twilio', whatsappProvider: 'twilio' })
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

  it('getAiRouting omits capabilities on the gateway default', async () => {
    query.mockResolvedValue(rows([{ tenant_id: null, key: 'ai_video_providers', value: ['replicate'] }]))
    expect(await getAiRouting(T)).toEqual({ video: ['replicate'] })
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
