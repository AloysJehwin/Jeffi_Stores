import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('server-only', () => ({}))
const query = vi.hoisted(() => vi.fn())
const resolveTenantId = vi.hoisted(() => vi.fn())
const store = vi.hoisted(() => new Map<string, { config_enc: string }>())
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformOwner: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId }))
vi.mock('@/lib/tenant-registry', () => ({
  controlPlanePool: () => ({ query }),
  getIntegrationCredential: vi.fn(async (t: string, p: string) => store.get(`${t}:${p}`) ?? null),
  saveIntegrationCredential: vi.fn(async (c: { tenantId: string; provider: string; configEnc: string }) => {
    store.set(`${c.tenantId}:${c.provider}`, { config_enc: c.configEnc })
  }),
  deleteIntegrationCredential: vi.fn(async (t: string, p: string) => {
    store.delete(`${t}:${p}`)
  }),
}))

import { GET, PUT, DELETE } from '@admin/app/api/(admin)/admin/settings/providers/credentials/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformOwner } from '@/lib/auth/scopes'
import { saveIntegrationCredential } from '@/lib/tenant-registry'

const url = 'http://localhost/api/admin/settings/providers/credentials'
const put = (body: unknown) => new NextRequest(url, { method: 'PUT', body: JSON.stringify(body) })
const del = (provider: string) => new NextRequest(`${url}?provider=${provider}`, { method: 'DELETE' })
const KEY = 'exotel-key-AAAA1111'
const TOKEN = 'exotel-token-BBBB2222'
const SARVAM = 'sarvam-secret-CCCC3333'

describe('/api/admin/settings/providers/credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.clear()
    vi.stubEnv('SOCIAL_TOKEN_ENC_KEY', 'b'.repeat(64))
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-env-secret-7777')
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a', email: 'ops@x', role: 'administrator', scopes: [] } as any)
    vi.mocked(isPlatformOwner).mockReturnValue(true)
    resolveTenantId.mockResolvedValue(null)
    query.mockResolvedValue({ rows: [] })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('is 401 without a session', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await GET(new NextRequest(url))).status).toBe(401)
    expect((await PUT(put({ provider: 'sarvam', values: { apiKey: SARVAM } }))).status).toBe(401)
    expect((await DELETE(del('sarvam'))).status).toBe(401)
  })

  it('is 403 for a non-owner and for a store admin', async () => {
    vi.mocked(isPlatformOwner).mockReturnValue(false)
    expect((await GET(new NextRequest(url))).status).toBe(403)
    expect((await PUT(put({ provider: 'sarvam', values: { apiKey: SARVAM } }))).status).toBe(403)
    expect((await DELETE(del('sarvam'))).status).toBe(403)
    vi.mocked(isPlatformOwner).mockReturnValue(true)
    resolveTenantId.mockResolvedValue('33333333-3333-3333-3333-333333333333')
    expect((await PUT(put({ provider: 'sarvam', values: { apiKey: SARVAM } }))).status).toBe(403)
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:write')
  })

  it('is 400 for an unknown provider or invalid values', async () => {
    expect((await PUT(put({ provider: 'plivo', values: { apiKey: SARVAM } }))).status).toBe(400)
    const r = await PUT(put({ provider: 'exotel', values: { apiKey: KEY } }))
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/apiToken/)
    expect((await PUT(put({ provider: 'sarvam', values: { apiKey: 'has space here' } }))).status).toBe(400)
    expect((await DELETE(del('nope'))).status).toBe(400)
    expect(saveIntegrationCredential).not.toHaveBeenCalled()
  })

  it('saves encrypted, answers masked, and never returns a secret from GET', async () => {
    const r = await PUT(put({ provider: 'exotel', values: { apiKey: KEY, apiToken: TOKEN } }))
    expect(r.status).toBe(200)
    const body = await r.text()
    expect(body).not.toContain(KEY)
    expect(body).not.toContain(TOKEN)
    expect(JSON.parse(body).secrets.apiKey).toEqual({ configured: true, last4: '1111' })
    expect((await PUT(put({ provider: 'sarvam', values: { apiKey: SARVAM } }))).status).toBe(200)
    for (const { config_enc } of store.values()) {
      expect(config_enc).toMatch(/^v1:/)
      for (const s of [KEY, TOKEN, SARVAM]) expect(config_enc).not.toContain(s)
    }

    const g = await GET(new NextRequest(url))
    expect(g.status).toBe(200)
    expect(g.headers.get('cache-control')).toBe('no-store')
    const text = await g.text()
    for (const s of [KEY, TOKEN, SARVAM, 'sk-ant-env-secret-7777']) expect(text).not.toContain(s)
    const j = JSON.parse(text)
    expect(j.voice.exotel.apiToken).toEqual({ configured: true, last4: '2222' })
    expect(j.voice.sarvam.apiKey).toEqual({ configured: true, last4: '3333' })
    expect(j.voice.anthropic).toMatchObject({ source: 'env', apiKey: { configured: true, last4: null } })
    expect(j.dlt).toMatchObject({ entityId: null, senderIds: [] })
  })

  it('clears one provider', async () => {
    await PUT(put({ provider: 'sarvam', values: { apiKey: SARVAM } }))
    expect((await DELETE(del('sarvam'))).status).toBe(200)
    const j = await (await GET(new NextRequest(url))).json()
    expect(j.voice.sarvam.apiKey).toEqual({ configured: false, last4: null })
  })
})
