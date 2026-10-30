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

import { GET, PUT, DELETE } from '@controller/app/api/(admin)/admin/settings/providers/route'
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

  it('lists settings, stores and readiness on settings:read', async () => {
    const j = await (await GET(new NextRequest(url))).json()
    expect(j.tenants).toHaveLength(1)
    expect(j.messaging.sms.aws).toBe(false)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'settings:read')
  })

  it('refuses a store admin (tenant resolved) even with an owner role', async () => {
    resolveTenantId.mockResolvedValue('33333333-3333-3333-3333-333333333333')
    expect((await GET(new NextRequest(url))).status).toBe(403)
    expect((await PUT(put({ key: 'sms_provider', value: 'twilio' }))).status).toBe(403)
    expect(policy.setProviderSetting).not.toHaveBeenCalled()
  })

  it('is platform-owner only: a non-owner is refused on every method', async () => {
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

  it('clears an override', async () => {
    const res = await DELETE(new NextRequest(`${url}?key=sms_provider&tenantId=${T}`, { method: 'DELETE' }))
    expect(res.status).toBe(200)
    expect(policy.clearProviderSetting).toHaveBeenCalledWith(T, 'sms_provider')
  })
})
