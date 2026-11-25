import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const resolveTenantId = vi.hoisted(() => vi.fn())
const testExotelCredentials = vi.hoisted(() => vi.fn())
const testAzureSpeechCredentials = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformOwner: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId }))
vi.mock('@/lib/providers/voice-config', () => ({ testExotelCredentials, testAzureSpeechCredentials }))

import { POST } from '@admin/app/api/(admin)/admin/settings/providers/credentials/test/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformOwner } from '@/lib/auth/scopes'

const post = (body: unknown) => new NextRequest('http://localhost/api/admin/settings/providers/credentials/test', { method: 'POST', body: JSON.stringify(body) })

describe('/api/admin/settings/providers/credentials/test', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a', role: 'administrator', scopes: [] } as any)
    vi.mocked(isPlatformOwner).mockReturnValue(true)
    resolveTenantId.mockResolvedValue(null)
    testExotelCredentials.mockResolvedValue({ ok: true, message: 'Exotel accepted the credentials (api.in.exotel.com).' })
    testAzureSpeechCredentials.mockResolvedValue({ ok: true, message: 'Azure Speech accepted the key (centralindia).' })
  })

  it('runs the read-only Exotel check for the platform owner', async () => {
    const r = await POST(post({ provider: 'exotel' }))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, message: 'Exotel accepted the credentials (api.in.exotel.com).' })
  })

  it('runs the read-only Azure Speech check, and not the Exotel one', async () => {
    const r = await POST(post({ provider: 'azure_speech' }))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, message: 'Azure Speech accepted the key (centralindia).' })
    expect(testExotelCredentials).not.toHaveBeenCalled()
  })

  it('tests nothing else and refuses a non-owner', async () => {
    expect((await POST(post({ provider: 'sarvam' }))).status).toBe(400)
    vi.mocked(isPlatformOwner).mockReturnValue(false)
    expect((await POST(post({ provider: 'exotel' }))).status).toBe(403)
    expect(testExotelCredentials).not.toHaveBeenCalled()
    expect(testAzureSpeechCredentials).not.toHaveBeenCalled()
  })
})
