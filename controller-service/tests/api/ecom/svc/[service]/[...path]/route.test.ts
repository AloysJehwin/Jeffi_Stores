import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { mockOwnerApi, mockFetchService, mockApprovals } = vi.hoisted(() => ({
  mockOwnerApi: vi.fn(),
  mockFetchService: vi.fn(),
  mockApprovals: vi.fn(),
}))

const TENANT = { id: 't-1', slug: 'acme', service_types: ['messaging'] }
vi.mock('@controller/lib/ecom/owner-api', () => ({ ownerApi: mockOwnerApi }))
vi.mock('@/lib/tenant-registry', () => ({
  hasService: (t: { service_types: string[] }, s: string) => t.service_types.includes(s),
  listServiceApprovals: mockApprovals,
  blockedServices: (rows: Array<{ service: string; status: string }>) => new Map(rows.filter(r => r.status !== 'approved').map(r => [r.service, r.status])),
}))
vi.mock('@/lib/ecom/service-client', () => ({ fetchService: mockFetchService }))

import { GET, POST } from '@controller/app/api/(ecom)/ecom/svc/[service]/[...path]/route'

const call = (handler: typeof GET, service: string, path: string[], init?: { method?: string; body?: unknown; qs?: string }) => {
  const r = new NextRequest(`https://ecom.jeffistores.in/api/ecom/svc/${service}/${path.join('/')}${init?.qs ?? ''}`, {
    method: init?.method ?? 'GET',
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } } : {}),
  })
  return handler(r, { params: Promise.resolve({ service, path }) })
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('/api/ecom/svc/[service]/[...path]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOwnerApi.mockResolvedValue({ owner: { id: 'o-1' }, tenant: TENANT })
    mockApprovals.mockResolvedValue([])
  })

  it('404s an unknown service before authenticating', async () => {
    expect((await call(GET, 'store', ['x'])).status).toBe(404)
    expect(mockOwnerApi).not.toHaveBeenCalled()
  })

  it('returns the owner-api rejection as is', async () => {
    mockOwnerApi.mockResolvedValue(NextResponse.json({ error: 'Not signed in' }, { status: 401 }))
    expect((await call(GET, 'messaging', ['templates'])).status).toBe(401)
    expect(mockFetchService).not.toHaveBeenCalled()
  })

  it('403s a service the workspace has not enabled', async () => {
    const res = await call(GET, 'documents', ['templates'])
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('documents is not enabled')
  })

  it('403s a send while approval is pending but lets browsing through', async () => {
    mockApprovals.mockResolvedValue([{ service: 'messaging', status: 'pending' }])
    const res = await call(POST, 'messaging', ['messages'], { method: 'POST', body: { to: '+91' } })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('service_pending_approval')
    expect(mockFetchService).not.toHaveBeenCalled()
    mockFetchService.mockResolvedValue(json({ items: [] }))
    expect((await call(GET, 'messaging', ['templates'])).status).toBe(200)
  })

  it('proxies a JSON call with the encoded path, query and body', async () => {
    mockFetchService.mockResolvedValue(json({ id: 'm-1' }, 202))
    const res = await call(POST, 'messaging', ['messages', 'order/confirmed'], { method: 'POST', body: { to: '+91' }, qs: '?dry=1' })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ id: 'm-1' })
    const [service, tenant, path, init] = mockFetchService.mock.calls[0]
    expect([service, tenant.id, path]).toEqual(['messaging', 't-1', '/messages/order%2Fconfirmed?dry=1'])
    expect(init).toEqual({ method: 'POST', body: { to: '+91' }, space: 'api' })
  })

  it('passes a non-JSON body (PDF) through with its headers', async () => {
    mockFetchService.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename=a.pdf' } }))
    const res = await call(GET, 'messaging', ['x'])
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename=a.pdf')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })
})
