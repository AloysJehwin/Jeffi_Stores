import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const reg = vi.hoisted(() => ({ getTenant: vi.fn(), hasService: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const svc = vi.hoisted(() => ({ fetchService: vi.fn() }))
vi.mock('@/lib/ecom/service-client', () => svc)

import { GET, POST } from '@controller/app/api/(admin)/admin/ecom/customers/[id]/messaging/[...path]/route'

const ctx = { params: Promise.resolve({ id: 't-1', path: ['v1', 'send message'] }) }
const get = () => GET(new NextRequest('http://localhost/api/admin/ecom/customers/t-1/messaging/v1/x?limit=5'), ctx)
const post = (body: unknown) => POST(new NextRequest('http://localhost/api/admin/ecom/customers/t-1/messaging/v1/x', { method: 'POST', body: body as string }), ctx)
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'acme' })
  reg.hasService.mockReturnValue(true)
  svc.fetchService.mockResolvedValue(jsonRes({ ok: 1 }))
})

describe('/api/admin/ecom/customers/[id]/messaging/[...path]', () => {
  it('401s, 403s, 404s and 400s without messaging', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await get()).status).toBe(403)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
    reg.getTenant.mockResolvedValue(null)
    expect((await get()).status).toBe(404)
    reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'acme' })
    reg.hasService.mockReturnValue(false)
    expect((await get()).status).toBe(400)
    expect(svc.fetchService).not.toHaveBeenCalled()
  })

  it('proxies a GET to the messaging service as the api space, internal', async () => {
    const res = await get()
    expect(await res.json()).toEqual({ ok: 1 })
    expect(svc.fetchService).toHaveBeenCalledWith('messaging', { id: 't-1', slug: 'acme' }, '/v1/send%20message?limit=5', {
      method: 'GET',
      body: undefined,
      space: 'api',
      internal: true,
    })
  })

  it('forwards a POST body and the upstream status', async () => {
    svc.fetchService.mockResolvedValue(jsonRes({ error: 'nope' }, 422))
    const res = await post(JSON.stringify({ to: '+1' }))
    expect(res.status).toBe(422)
    expect(svc.fetchService.mock.calls[0][3]).toMatchObject({ method: 'POST', body: { to: '+1' } })
  })

  it('passes a non-JSON response through as bytes', async () => {
    svc.fetchService.mockResolvedValue(new Response('csv,data', { status: 200, headers: { 'content-type': 'text/csv' } }))
    const res = await get()
    expect(res.headers.get('content-type')).toBe('text/csv')
    expect(await res.text()).toBe('csv,data')
  })
})
