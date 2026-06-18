import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/automation-emails', () => ({ sendTestCampaignEmail: vi.fn() }))
vi.mock('@/lib/marketing', () => ({}))

import { POST } from '@/app/api/admin/campaigns/[kind]/test/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { sendTestCampaignEmail } from '@/lib/automation-emails'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockSendTestEmail = vi.mocked(sendTestCampaignEmail)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['mailer'] }
const params = { kind: 'welcome' }

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/campaigns/welcome/test', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/admin/campaigns/[kind]/test', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest({ email: 'test@example.com' }), { params })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest({ email: 'test@example.com' }), { params })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/insufficient/i)
  })

  it('returns 400 when email is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeRequest({}), { params })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/email/i)
  })

  it('returns 400 when email has no @ sign', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeRequest({ email: 'notanemail' }), { params })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/email/i)
  })

  it('returns 400 when email is not a string', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeRequest({ email: 12345 }), { params })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/email/i)
  })

  it('sends test email and returns success', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockSendTestEmail.mockResolvedValue({ ok: true } as any)

    const res = await POST(makeRequest({ email: 'test@example.com' }), { params })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockSendTestEmail).toHaveBeenCalledWith('welcome', 'test@example.com')
  })

  it('returns 500 when send fails', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockSendTestEmail.mockResolvedValue({ ok: false, reason: 'SMTP down' } as any)

    const res = await POST(makeRequest({ email: 'test@example.com' }), { params })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('SMTP down')
  })

  it('returns 500 with generic message when reason is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockSendTestEmail.mockResolvedValue({ ok: false } as any)

    const res = await POST(makeRequest({ email: 'test@example.com' }), { params })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/failed to send/i)
  })
})
