import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn(), ALL_SCOPE_KEYS: ['orders:read', 'orders:write', 'secret:x'] }))
vi.mock('@/lib/auth/scopes-server', () => ({ assignableScopeKeys: vi.fn() }))
vi.mock('@/lib/auth/admin-principal', () => ({ ensureServiceAccountAdmin: vi.fn() }))
vi.mock('@/lib/auth/api-tokens', () => ({ clientInfoFrom: vi.fn(() => ({ host: 'h.example' })), issueServiceAccountKey: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryMany: vi.fn() }))
vi.mock('@/lib/tenancy/certificates', () => ({ generateClientCertificate: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-ca', () => ({ issueTenantAdminCert: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: vi.fn() }))
vi.mock('@/lib/tenancy/request-tenant', () => ({ resolveRequestTenantId: vi.fn() }))

import { GET, POST } from '@admin/app/api/(admin)/admin/service-accounts/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { assignableScopeKeys } from '@/lib/auth/scopes-server'
import { ensureServiceAccountAdmin } from '@/lib/auth/admin-principal'
import { issueServiceAccountKey } from '@/lib/auth/api-tokens'
import { query, queryMany } from '@/lib/shared/db'
import { generateClientCertificate } from '@/lib/tenancy/certificates'
import { issueTenantAdminCert } from '@/lib/tenancy/tenant-ca'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { resolveRequestTenantId } from '@/lib/tenancy/request-tenant'

const admin = { adminId: 'a1', username: 'a', role: 'admin', scopes: ['orders:read', 'orders:write'] }
const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/x', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))
const cert = { serialNumber: 'SER1', p12Buffer: Buffer.from('p12'), p12Password: 'pw' }

describe('/api/admin/service-accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockImplementation(((_r: string, scopes: string[], s: string) => scopes.includes(s) || s.startsWith('service_accounts')) as never)
    vi.mocked(assignableScopeKeys).mockResolvedValue(['orders:read', 'orders:write'] as never)
    vi.mocked(resolveRequestTenantId).mockResolvedValue('t1' as never)
    vi.mocked(resolveTenant).mockResolvedValue(null as never)
    vi.mocked(generateClientCertificate).mockResolvedValue(cert as never)
    vi.mocked(query).mockResolvedValue({ rows: [{ id: 'sa1', name: 'bot', common_name: 'svc-bot', allowed_scopes: ['orders:read'], created_at: 'now' }] } as never)
    vi.mocked(ensureServiceAccountAdmin).mockResolvedValue(undefined as never)
    vi.mocked(issueServiceAccountKey).mockResolvedValue({ token: 'tok', prefix: 'pre' } as never)
  })

  describe('GET', () => {
    it('returns 401 and 403', async () => {
      vi.mocked(authenticateAdmin).mockResolvedValue(null)
      expect((await GET(new NextRequest('http://localhost/x'))).status).toBe(401)
      vi.mocked(authenticateAdmin).mockResolvedValue(admin)
      vi.mocked(hasScope).mockReturnValue(false)
      expect((await GET(new NextRequest('http://localhost/x'))).status).toBe(403)
      expect(hasScope).toHaveBeenLastCalledWith('admin', admin.scopes, 'service_accounts:read')
    })

    it('lists the accounts', async () => {
      vi.mocked(queryMany).mockResolvedValue([{ id: 'sa1' }])
      const res = await GET(new NextRequest('http://localhost/x'))
      expect(await res.json()).toEqual({ service_accounts: [{ id: 'sa1' }] })
    })
  })

  describe('POST', () => {
    it('returns 401 and 403 (needs service_accounts:write)', async () => {
      vi.mocked(authenticateAdmin).mockResolvedValue(null)
      expect((await post({ name: 'bot' })).status).toBe(401)
      vi.mocked(authenticateAdmin).mockResolvedValue(admin)
      vi.mocked(hasScope).mockReturnValue(false)
      expect((await post({ name: 'bot' })).status).toBe(403)
      expect(hasScope).toHaveBeenLastCalledWith('admin', admin.scopes, 'service_accounts:write')
    })

    it('returns 400 for bad JSON, a bad name, or malformed scopes', async () => {
      expect((await post('not json')).status).toBe(400)
      expect((await post({ name: 'x' })).status).toBe(400)
      expect((await post({ name: 'Bad Name' })).status).toBe(400)
      expect((await post({ name: 'bot', allowed_scopes: 'orders:read' })).status).toBe(400)
      expect((await post({ name: 'bot', allowed_scopes: [1] })).status).toBe(400)
    })

    it('returns 400 for unknown or plan-unassignable scopes', async () => {
      const a = await post({ name: 'bot', allowed_scopes: ['nope'] })
      expect(a.status).toBe(400)
      const b = await post({ name: 'bot', allowed_scopes: ['secret:x'] })
      expect(b.status).toBe(400)
      expect((await b.json()).error).toMatch(/secret:x/)
      expect(generateClientCertificate).not.toHaveBeenCalled()
    })

    it("returns 403 when granting a scope the creator doesn't hold", async () => {
      vi.mocked(authenticateAdmin).mockResolvedValue({ ...admin, scopes: ['orders:read'] })
      const res = await post({ name: 'bot', allowed_scopes: ['orders:read', 'orders:write'] })
      expect(res.status).toBe(403)
      expect((await res.json()).error).toMatch(/orders:write/)
      expect(query).not.toHaveBeenCalled()
    })

    it('issues a platform-CA certificate, stores the account and returns key and password once', async () => {
      const res = await post({ name: 'bot', allowed_scopes: ['orders:read', 'orders:read'] })
      expect(res.status).toBe(201)
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(await res.json()).toEqual({
        id: 'sa1', name: 'bot', common_name: 'svc-bot', allowed_scopes: ['orders:read'], created_at: 'now',
        p12_password: 'pw', download_url: '/api/admin/service-accounts/sa1/download', api_key: 'tok', api_key_prefix: 'pre',
      })
      expect(generateClientCertificate).toHaveBeenCalledWith('svc-bot', 'service-account')
      expect(vi.mocked(query).mock.calls[0][1]).toEqual(['bot', 'SER1', 'svc-bot', ['orders:read'], cert.p12Buffer, 'pw', 'a1'])
      expect(issueServiceAccountKey).toHaveBeenCalledWith({ tenantId: 't1', serviceAccountId: 'sa1', name: 'bot', host: 'h.example' })
    })

    it("uses the tenant's own CA on a tenant host", async () => {
      vi.mocked(resolveTenant).mockResolvedValue({ tenantId: 't9', slug: 'shop' } as never)
      vi.mocked(issueTenantAdminCert).mockResolvedValue({ serial: 'TS', p12Buffer: Buffer.from('x'), p12Password: 'tp' } as never)
      const body = await (await post({ name: 'bot' })).json()
      expect(body.p12_password).toBe('tp')
      expect(issueTenantAdminCert).toHaveBeenCalledWith({ tenantId: 't9', slug: 'shop', commonName: 'svc-bot', issuedTo: 'svc-bot' })
      expect(generateClientCertificate).not.toHaveBeenCalled()
      expect(vi.mocked(query).mock.calls[0][1]![1]).toBe('TS')
    })

    it('returns 500 when certificate generation fails', async () => {
      vi.mocked(generateClientCertificate).mockRejectedValue(new Error('ca'))
      expect((await post({ name: 'bot' })).status).toBe(500)
      expect(query).not.toHaveBeenCalled()
    })

    it('still returns the account with a null key when key issuance fails', async () => {
      vi.mocked(issueServiceAccountKey).mockRejectedValue(new Error('k'))
      vi.mocked(ensureServiceAccountAdmin).mockRejectedValue(new Error('a'))
      const body = await (await post({ name: 'bot' })).json()
      expect(body.api_key).toBeNull()
      expect(body.api_key_prefix).toBeNull()
    })
  })
})
