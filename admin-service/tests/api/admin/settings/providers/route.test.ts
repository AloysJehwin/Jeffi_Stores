import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const query = vi.fn()
const policy = vi.hoisted(() => ({
  listProviderSettings: vi.fn(),
  setProviderSetting: vi.fn(),
  clearProviderSetting: vi.fn(),
}))
const readiness = vi.hoisted(() => vi.fn())
const resolveTenantId = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformOwner: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))
vi.mock('@/lib/shared/messaging', () => ({ messagingProviderReadiness: readiness }))
vi.mock('@/lib/providers/policy', async importOriginal => ({ ...(await importOriginal<object>()), ...policy }))

import { GET, PUT, DELETE } from '@admin/app/api/(admin)/admin/settings/providers/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformOwner } from '@/lib/auth/scopes'

const T = '22222222-2222-2222-2222-222222222222'
const url = 'http://localhost/api/admin/settings/providers'
const put = (body: unknown) => new NextRequest(url, { method: 'PUT', body: JSON.stringify(body) })

describe('/api/admin/settings/providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a', email: 'ops@x', role: 'administrator', scopes: [] } as any)
    vi.mocked(isPlatformOwner).mockReturnValue(true)
    resolveTenantId.mockResolvedValue(null)
    query.mockResolvedValue({ rows: [{ id: T, slug: 's', display_name: 'S' }] })
    policy.listProviderSettings.mockResolvedValue([])
    policy.clearProviderSetting.mockResolvedValue(true)
    readiness.mockReturnValue({ sms: { twilio: true, aws: false }, whatsapp: { twilio: true, aws: true } })
  })

  it('lists the platform view, stores and readiness on settings:read', async () => {
    const j = await (await GET(new NextRequest(url))).json()
    expect(j.tenants).toHaveLength(1)
    expect(j.messaging.sms.aws).toBe(false)
    expect(j.scope).toEqual({ kind: 'platform' })
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:read')
  })

  it('flagship GET: effective settings, gateway, prices without cost, secrets by name only', async () => {
    vi.stubEnv('AI_GATEWAY_URL', 'http://gw.test')
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACsecretvalue')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ text: [{ name: 'anthropic', configured: true, models: [] }, { name: 'azure', configured: false }], stt: [{ name: 'sarvam', configured: true }] }),
    })))
    policy.listProviderSettings.mockResolvedValue([
      { tenant_id: null, key: 'sms_provider', value: 'twilio' },
      { tenant_id: T, key: 'ai_embed_provider', value: 'azure' },
    ])
    query.mockImplementation(async (sql: string) =>
      /ai_price_list/.test(sql)
        ? { rows: [{ capability: 'text', provider: 'azure', model: '*', unit_type: 'token_1k_in', price_inr: '0.1020' }] }
        : { rows: [{ id: T, slug: 's', display_name: 'S' }] }
    )
    const j = await (await GET(new NextRequest(url))).json()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    expect(j.settings).toEqual({ sms_provider: 'twilio' })
    expect(j.canEdit).toEqual({ messaging: true, calling: true, ai: true, integrations: false })
    expect(j.gateway.text).toHaveLength(2)
    expect(j.gatewayError).toBeUndefined()
    expect(j.prices).toEqual([{ capability: 'text', provider: 'azure', model: '*', unit_type: 'token_1k_in', price_inr: '0.1020' }])
    const secrets = Object.fromEntries(j.secrets.map((x: any) => [x.name, x.present]))
    expect(secrets).toMatchObject({ 'Anthropic federation': true, AZURE_OPENAI_API_KEY: false, SARVAM_API_KEY: true, TWILIO_ACCOUNT_SID: true, TWILIO_AUTH_TOKEN: false })
    const text = JSON.stringify(j)
    expect(text).not.toContain('cost_inr')
    expect(text).not.toContain('ACsecretvalue')
    expect(query.mock.calls.find(c => /ai_price_list/.test(c[0]))![0]).not.toMatch(/cost_inr/)
  })

  it('flagship ?tenant= shows the store merged over the platform default', async () => {
    policy.listProviderSettings.mockResolvedValue([
      { tenant_id: null, key: 'ai_embed_provider', value: 'razer' },
      { tenant_id: null, key: 'sms_provider', value: 'twilio' },
      { tenant_id: T, key: 'ai_embed_provider', value: 'azure' },
    ])
    query.mockImplementation(async (sql: string) => (/ai_price_list/.test(sql) ? { rows: [] } : { rows: [{ id: T, slug: 's', display_name: 'Shop' }] }))
    const j = await (await GET(new NextRequest(`${url}?tenant=${T}`))).json()
    expect(j.scope).toEqual({ kind: 'store', tenantId: T, tenantName: 'Shop' })
    expect(j.settings).toMatchObject({ ai_embed_provider: 'azure', sms_provider: 'twilio' })
    expect(j.inherited).toMatchObject({ ai_embed_provider: 'razer' })
    expect(j.overridden).toEqual(['ai_embed_provider'])
    expect(j.canEdit.calling).toBe(false)
    expect((await GET(new NextRequest(`${url}?tenant=nope`))).status).toBe(400)
  })

  it('reports a clear gatewayError when the gateway is down', async () => {
    vi.stubEnv('AI_GATEWAY_URL', 'http://gw.test')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const j = await (await GET(new NextRequest(url))).json()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    expect(j.gateway).toBeNull()
    expect(j.gatewayError).toMatch(/unreachable.*ECONNREFUSED/)
    expect(j.secrets.find((x: any) => x.name === 'SARVAM_API_KEY' && x.group === 'ai').present).toBe(false)
  })

  describe('as a store admin', () => {
    beforeEach(() => {
      resolveTenantId.mockResolvedValue(T)
      vi.mocked(isPlatformOwner).mockReturnValue(false)
      vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'o', email: 'owner@shop', role: 'owner', scopes: [] } as any)
      policy.listProviderSettings.mockResolvedValue([
        { tenant_id: null, key: 'ai_text_providers', value: ['anthropic', 'razer'] },
        { tenant_id: null, key: 'sms_provider', value: 'aws' },
        { tenant_id: null, key: 'voice_provider', value: 'exotel' },
        { tenant_id: null, key: 'sms_dlt_entity_id', value: '1234567890123456789' },
        { tenant_id: T, key: 'ai_models', value: { text: { anthropic: 'claude-haiku-5-5' } } },
      ])
      query.mockImplementation(async (sql: string) => (/ai_price_list/.test(sql) ? { rows: [] } : { rows: [{ display_name: 'Shop' }] }))
    })

    it('GET returns its own store only: no secrets, voice, tenant list or flagship-only keys', async () => {
      const j = await (await GET(new NextRequest(url))).json()
      expect(j.scope).toEqual({ kind: 'store', tenantId: T, tenantName: 'Shop' })
      expect(j.canEdit).toEqual({ messaging: false, calling: false, ai: true, integrations: false })
      expect(j.secrets).toBeUndefined()
      expect(j.voice).toBeUndefined()
      expect(j.tenants).toBeUndefined()
      expect(Object.keys(j.settings).sort()).toEqual(['ai_models', 'ai_text_providers', 'sms_provider'])
      expect(j.inherited.voice_provider).toBeUndefined()
      expect(j.overridden).toEqual(['ai_models'])
    })

    it('GET ignores ?tenant= for another store', async () => {
      const j = await (await GET(new NextRequest(`${url}?tenant=33333333-3333-3333-3333-333333333333`))).json()
      expect(j.scope.tenantId).toBe(T)
    })

    it('cannot edit without settings:write', async () => {
      vi.mocked(requireAdminScope).mockImplementation((async (_r: unknown, scope: string) =>
        scope === 'settings:write' ? NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }) : { adminId: 'o', role: 'owner', scopes: [] }) as any)
      expect((await (await GET(new NextRequest(url))).json()).canEdit.ai).toBe(false)
      expect((await PUT(put({ key: 'ai_models', value: {} }))).status).toBe(403)
    })

    it('PUT writes only its own ai keys and models, always at its own tenant', async () => {
      expect((await PUT(put({ key: 'ai_models', value: { text: { anthropic: 'claude-sonnet-5-5' } } }))).status).toBe(200)
      expect(policy.setProviderSetting).toHaveBeenLastCalledWith(T, 'ai_models', { text: { anthropic: 'claude-sonnet-5-5' } }, 'owner@shop')
      expect((await PUT(put({ tenantId: T, key: 'ai_embed_provider', value: 'azure' }))).status).toBe(200)
      policy.setProviderSetting.mockClear()
      for (const b of [
        { key: 'sms_provider', value: 'twilio' },
        { key: 'voice_provider', value: 'exotel' },
        { key: 'sms_dlt_entity_id', value: '1234567890123456789' },
        { tenantId: '33333333-3333-3333-3333-333333333333', key: 'ai_models', value: {} },
      ]) expect((await PUT(put(b))).status).toBe(403)
      expect((await PUT(put({ key: 'ai_models', value: { text: { anthropic: 'x y' } } }))).status).toBe(400)
      expect(policy.setProviderSetting).not.toHaveBeenCalled()
    })

    it('DELETE resets only its own ai override', async () => {
      expect((await DELETE(new NextRequest(`${url}?key=ai_models`, { method: 'DELETE' }))).status).toBe(200)
      expect(policy.clearProviderSetting).toHaveBeenLastCalledWith(T, 'ai_models')
      policy.clearProviderSetting.mockClear()
      expect((await DELETE(new NextRequest(`${url}?key=sms_provider`, { method: 'DELETE' }))).status).toBe(403)
      expect((await DELETE(new NextRequest(`${url}?key=ai_models&tenantId=33333333-3333-3333-3333-333333333333`, { method: 'DELETE' }))).status).toBe(403)
      expect(policy.clearProviderSetting).not.toHaveBeenCalled()
    })

    it('an unresolvable tenant is refused', async () => {
      resolveTenantId.mockRejectedValue(new Error('boom'))
      expect((await GET(new NextRequest(url))).status).toBe(403)
    })
  })

  it('refuses a non-owner on the flagship', async () => {
    vi.mocked(isPlatformOwner).mockReturnValue(false)
    expect((await GET(new NextRequest(url))).status).toBe(403)
  })

  it('a non-owner on the flagship is refused on every method', async () => {
    vi.mocked(isPlatformOwner).mockReturnValue(false)
    expect((await GET(new NextRequest(url))).status).toBe(403)
    expect((await PUT(put({ key: 'sms_provider', value: 'twilio' }))).status).toBe(403)
    expect((await DELETE(new NextRequest(`${url}?key=sms_provider`, { method: 'DELETE' }))).status).toBe(403)
    expect(policy.setProviderSetting).not.toHaveBeenCalled()
    expect(policy.clearProviderSetting).not.toHaveBeenCalled()
  })

  it('needs settings:write to change policy', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await PUT(put({ key: 'sms_provider', value: 'twilio' }))).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:write')
  })

  it('sets the platform default and a store override', async () => {
    expect((await PUT(put({ key: 'ai_image_providers', value: ['google', 'razer'] }))).status).toBe(200)
    expect(policy.setProviderSetting).toHaveBeenLastCalledWith(null, 'ai_image_providers', ['google', 'razer'], 'ops@x')
    expect((await PUT(put({ tenantId: T, key: 'whatsapp_provider', value: 'aws' }))).status).toBe(200)
    expect(policy.setProviderSetting).toHaveBeenLastCalledWith(T, 'whatsapp_provider', 'aws', 'ops@x')
  })

  it('rejects AWS until onboarding completes, and invalid input', async () => {
    const r = await PUT(put({ key: 'sms_provider', value: 'aws' }))
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/onboarding/)
    expect((await PUT(put({ key: 'ai_video_providers', value: ['razer'] }))).status).toBe(400)
    expect((await PUT(put({ key: 'feature_sms_provider', value: 'twilio' }))).status).toBe(400)
    expect((await PUT(put({ tenantId: 'nope', key: 'sms_provider', value: 'twilio' }))).status).toBe(400)
    expect(policy.setProviderSetting).not.toHaveBeenCalled()
  })

  it('keeps the voice keys platform-wide and takes DLT ids per store', async () => {
    const r = await PUT(put({ tenantId: T, key: 'voice_provider', value: 'exotel' }))
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/platform only/)
    expect((await PUT(put({ key: 'voice_config', value: { testNumbers: ['+919876543210'] } }))).status).toBe(200)
    expect(policy.setProviderSetting).toHaveBeenLastCalledWith(null, 'voice_config', { testNumbers: ['+919876543210'] }, 'ops@x')
    expect((await PUT(put({ key: 'voice_config', value: { exotel: { subdomain: 'evil.example.com' } } }))).status).toBe(400)
    expect((await PUT(put({ tenantId: T, key: 'sms_dlt_sender_ids', value: ['jeffis'] }))).status).toBe(200)
    expect(policy.setProviderSetting).toHaveBeenLastCalledWith(T, 'sms_dlt_sender_ids', ['JEFFIS'], 'ops@x')
  })

  it('takes the speech orders and the embeddings provider per store', async () => {
    expect((await PUT(put({ tenantId: T, key: 'ai_stt_providers', value: ['sarvam', 'azure'] }))).status).toBe(200)
    expect(policy.setProviderSetting).toHaveBeenLastCalledWith(T, 'ai_stt_providers', ['sarvam', 'azure'], 'ops@x')
    expect((await PUT(put({ key: 'ai_tts_providers', value: ['razer'] }))).status).toBe(400)
    expect((await PUT(put({ key: 'ai_text_providers', value: ['anthropic', 'razer', 'azure'] }))).status).toBe(200)
    expect((await PUT(put({ key: 'ai_embed_provider', value: 'azure' }))).status).toBe(200)
    expect(policy.setProviderSetting).toHaveBeenLastCalledWith(null, 'ai_embed_provider', 'azure', 'ops@x')
    expect((await PUT(put({ key: 'ai_embed_provider', value: ['azure'] }))).status).toBe(400)
    expect((await PUT(put({ tenantId: T, key: 'ai_embed_provider', value: 'azure' }))).status).toBe(200)
    expect(policy.setProviderSetting).toHaveBeenLastCalledWith(T, 'ai_embed_provider', 'azure', 'ops@x')
  })

  it('clears an override', async () => {
    const res = await DELETE(new NextRequest(`${url}?key=sms_provider&tenantId=${T}`, { method: 'DELETE' }))
    expect(res.status).toBe(200)
    expect(policy.clearProviderSetting).toHaveBeenCalledWith(T, 'sms_provider')
  })
})
