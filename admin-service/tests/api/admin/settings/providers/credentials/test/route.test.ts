import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const resolveTenantId = vi.hoisted(() => vi.fn())
const tests = vi.hoisted(() => ({
  testExotelCredentials: vi.fn(),
  testTwilioCredentials: vi.fn(),
  testAzureSpeechCredentials: vi.fn(),
  testSarvamCredentials: vi.fn(),
}))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformOwner: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId }))
vi.mock('@/lib/providers/voice-config', () => tests)

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
    for (const [name, fn] of Object.entries(tests)) fn.mockResolvedValue({ ok: true, message: name })
  })

  it.each([
    ['exotel', 'testExotelCredentials'],
    ['twilio_voice', 'testTwilioCredentials'],
    ['azure_speech', 'testAzureSpeechCredentials'],
    ['sarvam', 'testSarvamCredentials'],
  ] as const)('runs only the %s check for the platform owner', async (provider, fn) => {
    const r = await POST(post({ provider }))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, message: fn })
    for (const [name, mock] of Object.entries(tests)) expect(mock).toHaveBeenCalledTimes(name === fn ? 1 : 0)
  })

  it('tests nothing else and refuses a non-owner', async () => {
    expect((await POST(post({ provider: 'anthropic_voice' }))).status).toBe(400)
    expect((await POST(post({ provider: 'toString' }))).status).toBe(400)
    expect((await POST(post({}))).status).toBe(400)
    vi.mocked(isPlatformOwner).mockReturnValue(false)
    expect((await POST(post({ provider: 'exotel' }))).status).toBe(403)
    for (const mock of Object.values(tests)) expect(mock).not.toHaveBeenCalled()
  })

  it('is 500 with a generic message when the check throws', async () => {
    tests.testSarvamCredentials.mockRejectedValue(new Error('boom'))
    const r = await POST(post({ provider: 'sarvam' }))
    expect(r.status).toBe(500)
    expect(await r.json()).toEqual({ ok: false, message: 'Could not run the test' })
  })
})
