import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  queryMany: vi.fn(),
}))

vi.mock('@/lib/mail-audit', () => ({ sendAuditedMail: vi.fn() }))

vi.mock('@/lib/email', () => ({
  transporter: {
    sendMail: vi.fn(),
  },
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/access-request/route'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany } from '@/lib/db'
import { transporter } from '@/lib/email'
import { sendAuditedMail } from '@/lib/mail-audit'

const mockAuth = vi.mocked(authenticateAdmin)
const mockQueryMany = vi.mocked(queryMany)
// Mail now goes through the audited chokepoint, not the raw transport.
const mockSendMail = vi.mocked(sendAuditedMail)

const adminPayload = {
  adminId: 'admin-1',
  email: 'testadmin@example.com',
  first_name: 'Test',
  last_name: 'Admin',
  role: 'admin',
  scopes: ['products'],
}

function makeRequest(body: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/admin/access-request', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'admin_sid=valid' },
    body: JSON.stringify(body),
  })
}

const superAdmins = [
  { email: 'super@example.com', first_name: 'Super' },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/access-request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SES_ADMIN_FROM_EMAIL = 'admin@jeffistores.in'
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest({ scopeKey: 'orders', pagePath: '/admin/orders' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 400 when scopeKey is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    const res = await POST(makeRequest({ pagePath: '/admin/orders' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/missing required/i)
  })

  it('returns 400 when pagePath is missing', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    const res = await POST(makeRequest({ scopeKey: 'orders' }))
    expect(res.status).toBe(400)
  })

  it('returns ok:true immediately when no super admins found', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockQueryMany.mockResolvedValue([])

    const res = await POST(makeRequest({ scopeKey: 'orders', pagePath: '/admin/orders' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('sends email to all super admins and returns ok', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockQueryMany.mockResolvedValue(superAdmins)
    mockSendMail.mockResolvedValue(undefined as any)

    const res = await POST(makeRequest({ scopeKey: 'orders', scopeLabel: 'Orders', pagePath: '/admin/orders' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(mockSendMail).toHaveBeenCalledOnce()
    const mailArgs = mockSendMail.mock.calls[0][0] as any
    expect(mailArgs.to).toContain('super@example.com')
    expect(mailArgs.subject).toContain('Orders')
  })

  it('falls back to email as requester name when first/last name absent', async () => {
    const adminNoName = { ...adminPayload, first_name: undefined, last_name: undefined }
    mockAuth.mockResolvedValue(adminNoName as any)
    mockQueryMany.mockResolvedValue(superAdmins)
    mockSendMail.mockResolvedValue(undefined as any)

    await POST(makeRequest({ scopeKey: 'orders', pagePath: '/admin/orders' }))

    const mailArgs = mockSendMail.mock.calls[0][0] as any
    expect(mailArgs.subject).toContain('testadmin@example.com')
  })

  it('returns 500 on sendMail error', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockQueryMany.mockResolvedValue(superAdmins)
    mockSendMail.mockRejectedValue(new Error('SMTP failure'))

    const res = await POST(makeRequest({ scopeKey: 'orders', pagePath: '/admin/orders' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/SMTP failure/i)
  })
})
