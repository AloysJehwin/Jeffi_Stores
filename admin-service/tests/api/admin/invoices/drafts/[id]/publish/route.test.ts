import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'
import { NextRequest } from 'next/server'

// Forwards to document-service through @/lib/documents/proxy: auth, scope and what is forwarded.

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn(), authenticateAnyUser: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: vi.fn(async () => null) }))

import { POST } from '@admin/app/api/(admin)/admin/invoices/drafts/[id]/publish/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['invoices'] }
const ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const URL_ = `http://localhost/api/admin/invoices/drafts/${ID}/publish`
const ctx = { params: Promise.resolve({ id: ID }) }
const BODY = { note: 'x', total: 1180, gst: 180 }

const CALLS: { method: string; scope: string; upstream: string; handler: (r: NextRequest, c: any) => Promise<Response> }[] = [
  { method: 'POST', scope: 'invoices:write', upstream: `/admin/invoices/drafts/${ID}/publish`, handler: POST },
]

const req = (method: string, qs = '') =>
  new NextRequest(
    new Request(URL_ + qs, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(BODY),
    })
  )

let fetchMock: MockInstance<typeof fetch>

beforeEach(() => {
  process.env.SERVICE_AUTH_SECRET = 'test-secret'
  vi.mocked(authenticateAdmin).mockReset().mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReset().mockReturnValue(true)
  fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
  )
})

describe.each(CALLS)('$method invoices/drafts/[id]/publish forwards to document-service', ({ method, scope, upstream, handler }) => {
  it('is rejected with 401 when unauthenticated and 403 without the scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await handler(req(method), ctx)).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await handler(req(method), ctx)
    expect(res.status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith(ADMIN.role, ADMIN.scopes, scope)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards the method, path, query and body with a service token', async () => {
    const res = await handler(req(method, '?page=2'), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(hasScope).toHaveBeenCalledWith(ADMIN.role, ADMIN.scopes, scope)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url).replace(/^.*?\/admin\//, '/admin/')).toBe(`${upstream}?page=2`)
    expect(init?.method).toBe(method)
    expect((init?.headers as Record<string, string>).authorization).toMatch(/^Bearer .+\..+$/)
    expect(init?.body).toBe(method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(BODY))
  })

  it('passes a document-service failure status and body through', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"Invoice not found"}', { status: 404, headers: { 'content-type': 'application/json' } }))
    const res = await handler(req(method), ctx)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Invoice not found' })
  })
})
