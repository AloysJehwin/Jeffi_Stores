import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  createAdminUser: vi.fn(),
}))

vi.mock('@/lib/certificates', () => ({
  generateClientCertificate: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendAdminCertificateEmail: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  ALL_SCOPE_KEYS: ['products', 'orders', 'inventory', 'financial', 'customers', 'mailer', 'audit', 'agent'],
  hasScope: vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/users/route'
import { authenticateAdmin } from '@/lib/jwt'
import { query } from '@/lib/db'
import { createAdminUser } from '@/lib/auth'
import { generateClientCertificate } from '@/lib/certificates'
import { sendAdminCertificateEmail } from '@/lib/email'

const mockAuth = vi.mocked(authenticateAdmin)
const mockQuery = vi.mocked(query)
const mockCreateAdminUser = vi.mocked(createAdminUser)
const mockGenerateCert = vi.mocked(generateClientCertificate)
const mockSendEmail = vi.mocked(sendAdminCertificateEmail)

// ── Helpers ───────────────────────────────────────────────────────────────────

const superAdmin = {
  adminId: 'super-admin-1',
  username: 'superadmin',
  role: 'super_admin',
  scopes: [],
}

const regularAdmin = {
  adminId: 'admin-2',
  username: 'regularadmin',
  role: 'admin',
  scopes: [],
}

const validBody = {
  username: 'newadmin',
  password: 'SecureP@ss123',
  email: 'newadmin@example.com',
  first_name: 'New',
  last_name: 'Admin',
  role: 'admin',
  scopes: ['products', 'orders'],
}

const mockCert = {
  serialNumber: 'SERIAL-001',
  expiresAt: new Date('2027-06-18'),
  downloadToken: 'token-abc',
  p12Buffer: Buffer.from('fake-p12'),
  p12Password: 'certpassword',
}

const mockCreatedAdmin = { id: 'new-admin-uuid', username: 'newadmin' }

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'admin_token=valid-token' },
    body: JSON.stringify(body),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/users', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 403 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 403 when caller is not super_admin', async () => {
    mockAuth.mockResolvedValue(regularAdmin)
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(403)
  })

  it('returns 400 when username is missing', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    const { username, ...body } = validBody
    const res = await POST(makeRequest(body))
    expect(res.status).toBe(400)
    const resBody = await res.json()
    expect(resBody.error).toMatch(/missing required fields/i)
  })

  it('returns 400 when password is missing', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    const { password, ...body } = validBody
    const res = await POST(makeRequest(body))
    expect(res.status).toBe(400)
  })

  it('returns 400 when email is missing', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    const { email, ...body } = validBody
    const res = await POST(makeRequest(body))
    expect(res.status).toBe(400)
  })

  it('returns 400 when first_name is missing', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    const { first_name, ...body } = validBody
    const res = await POST(makeRequest(body))
    expect(res.status).toBe(400)
  })

  it('returns 400 when last_name is missing', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    const { last_name, ...body } = validBody
    const res = await POST(makeRequest(body))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid role', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    const res = await POST(makeRequest({ ...validBody, role: 'super_admin' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid role/i)
  })

  it('returns 400 when scopes is not an array', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    const res = await POST(makeRequest({ ...validBody, scopes: 'products' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/scopes must be an array/i)
  })

  it('returns 400 for unknown scope key', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    const res = await POST(makeRequest({ ...validBody, scopes: ['products', 'unknown_scope'] }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid scope/i)
  })

  it('returns 400 when createAdminUser fails', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockCreateAdminUser.mockResolvedValue({ success: false, error: 'Username already taken' })
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Username already taken')
  })

  it('creates admin user and returns certificate on success', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockCreateAdminUser.mockResolvedValue({ success: true, admin: mockCreatedAdmin })
    mockGenerateCert.mockResolvedValue(mockCert as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockSendEmail.mockResolvedValue({ success: true } as any)

    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.admin.username).toBe('newadmin')
    expect(body.certificate.serialNumber).toBe('SERIAL-001')
    expect(body.certificate.p12Password).toBe('certpassword')
    expect(body.emailSent).toBe(true)
  })

  it('defaults role to admin when not specified', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    const { role, ...bodyWithoutRole } = validBody
    mockCreateAdminUser.mockResolvedValue({ success: true, admin: mockCreatedAdmin })
    mockGenerateCert.mockResolvedValue(mockCert as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockSendEmail.mockResolvedValue({ success: true } as any)

    const res = await POST(makeRequest(bodyWithoutRole))
    expect(res.status).toBe(200)
    expect(mockCreateAdminUser).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin' })
    )
  })

  it('returns 500 on unexpected error', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockCreateAdminUser.mockRejectedValue(new Error('Unexpected crash'))
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Unexpected crash')
  })
})
