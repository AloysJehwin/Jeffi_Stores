import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
}))

vi.mock('@/lib/auth/auth', () => ({
  createAdminUser: vi.fn(),
}))

vi.mock('@/lib/tenancy/certificates', () => ({
  generateClientCertificate: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendAdminCertificateEmail: vi.fn(),
}))

// Tenant path (#487): resolveTenant decides platform-CA vs tenant-CA issuance. Default null
// (off-tenant / platform CA); a test overrides it to exercise the tenant-CA branch.
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: vi.fn(async () => null) }))
vi.mock('@/lib/tenancy/tenant-ca', () => ({ issueTenantAdminCert: vi.fn() }))
vi.mock('@/lib/tenancy/portal-certs', () => ({ recordPortalCert: vi.fn(async () => undefined) }))

vi.mock('@/lib/tenancy/request-tenant', () => ({ resolveRequestTenantId: vi.fn(async () => null) }))
vi.mock('@/lib/auth/scopes', () => ({
  ALL_SCOPE_KEYS: ['products', 'orders', 'inventory', 'financial', 'customers', 'mailer', 'audit', 'agent'],
  hasScope: vi.fn(),
  isPlatformOwner: (role: string) => role === 'administrator' || role === 'super_admin',
  // A tenant may only hand out what its plan sells; off-tenant this is the full set.
  assignableScopeKeys: vi.fn(async () => [
    'products',
    'orders',
    'inventory',
    'financial',
    'customers',
    'mailer',
    'audit',
    'agent',
  ]),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@admin/app/api/(admin)/admin/users/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { query } from '@/lib/shared/db'
import { createAdminUser } from '@/lib/auth/auth'
import { generateClientCertificate } from '@/lib/tenancy/certificates'
import { sendAdminCertificateEmail } from '@/lib/email'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { issueTenantAdminCert } from '@/lib/tenancy/tenant-ca'

const mockAuth = vi.mocked(authenticateAdmin)
const mockQuery = vi.mocked(query)
const mockCreateAdminUser = vi.mocked(createAdminUser)
const mockGenerateCert = vi.mocked(generateClientCertificate)
const mockSendEmail = vi.mocked(sendAdminCertificateEmail)
const mockResolveTenant = vi.mocked(resolveTenant)
const mockIssueTenantCert = vi.mocked(issueTenantAdminCert)

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

const mockCreatedAdmin = { id: 'new-admin-uuid', email: 'newadmin@example.com' }

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'admin_sid=valid-token' },
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
    expect(body.admin.email).toBe('newadmin@example.com')
    expect(body.certificate.serialNumber).toBe('SERIAL-001')
    expect(body.emailSent).toBe(true)
    // #487 portal-only: the response carries ONLY non-secret metadata — never the p12/password.
    expect(body.portalInvite).toBe(true)
    expect(body.portalUrl).toContain('certificate.')
    expect(body.certificate.p12Password).toBeUndefined()
    expect(body.certificate.p12Base64).toBeUndefined()
    expect(JSON.stringify(body)).not.toMatch(/certpassword|p12Base64/i)
  })

  // #487: on a TENANT admin host, the cert must be issued from the tenant's OWN CA (not the platform
  // CA), or nginx — which validates client certs against the tenant CA — would reject it. This was
  // the "team members page not working for tenants" bug.
  it('issues the cert from the tenant CA on a tenant host (not the platform CA)', async () => {
    mockAuth.mockResolvedValue(superAdmin)
    mockCreateAdminUser.mockResolvedValue({ success: true, admin: mockCreatedAdmin })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    mockSendEmail.mockResolvedValue({ success: true } as any)
    mockResolveTenant.mockResolvedValue({ tenantId: 't-1', slug: 'acme', displayName: 'Acme' } as any)
    mockIssueTenantCert.mockResolvedValue({
      serial: 'TENANT-SERIAL',
      expiresAt: new Date('2027-06-18'),
      p12Buffer: Buffer.from('tenant-p12'),
      p12Password: 'tenantpw',
    } as any)

    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    // Tenant CA path taken; platform-CA generator NOT used.
    expect(mockIssueTenantCert).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-1', slug: 'acme' }))
    expect(mockGenerateCert).not.toHaveBeenCalled()
    expect(body.certificate.serialNumber).toBe('TENANT-SERIAL')
    // Still portal-only: no secret in the response.
    expect(JSON.stringify(body)).not.toMatch(/tenantpw|p12Base64/i)
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
    expect(mockCreateAdminUser).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }))
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
