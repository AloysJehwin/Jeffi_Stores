import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn(), authenticateAnyUser: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: vi.fn() }))
import { authenticateAdmin } from '@/lib/auth/jwt'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { proxyAdminDocs } from '@/lib/documents/proxy'

describe('proxyAdminDocs', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.SERVICE_AUTH_SECRET = 's'
    vi.mocked(resolveTenant).mockResolvedValue({ tenantId: 't1', slug: 'acme', displayName: null, plan: null, infra: null })
  })
  it('401 without admin, 403 without scope', async () => {
    const req = new NextRequest('http://admin-acme.localhost/api/admin/invoices')
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await proxyAdminDocs(req, '/admin/invoices', 'invoices:read')).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a', role: 'staff', scopes: [] } as any)
    expect((await proxyAdminDocs(req, '/admin/invoices', 'invoices:read')).status).toBe(403)
  })
  it('forwards with a signed service token carrying the admin claims', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'staff', scopes: ['invoices:read'] } as any)
    const res = await proxyAdminDocs(new NextRequest('http://admin-acme.localhost/api/admin/invoices?page=2'), '/admin/invoices', 'invoices:read')
    expect(res.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/admin\/invoices\?page=2$/)
    const payload = JSON.parse(Buffer.from(String((init as any).headers.authorization).slice(7).split('.')[0], 'base64url').toString())
    expect(payload).toMatchObject({ tenantId: 't1', tenantSlug: 'acme', adminId: 'a1', internal: true, scopes: ['invoices:read'] })
  })
})
