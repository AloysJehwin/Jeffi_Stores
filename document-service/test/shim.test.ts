import { describe, it, expect, vi, beforeEach } from 'vitest'

const PLATFORM_TENANT_ID = 'platform-tenant'
const lookupTenantContextByIdMock = vi.fn()
const runWithTenantMock = vi.fn((_tenant: any, fn: () => any) => fn())
const runAsPlatformMock = vi.fn((fn: () => any) => fn())

vi.mock('@jeffi/tenancy', () => ({
  PLATFORM_TENANT_ID: 'platform-tenant',
  lookupTenantContextById: (...a: any[]) => lookupTenantContextByIdMock(...a),
  runWithTenant: (...a: any[]) => runWithTenantMock(...a),
  runAsPlatform: (...a: any[]) => runAsPlatformMock(...a),
}))

import { mount, NextResponse } from '../src/shim.js'

// Fake fastify app that captures the handler registered by mount().
function makeApp() {
  let handler: any
  const app = { route: (opts: any) => { handler = opts.handler } } as any
  return { app, invoke: (req: any, reply: any) => handler(req, reply) }
}

const makeReply = () => ({ code: vi.fn().mockReturnThis(), header: vi.fn(), send: vi.fn() })

beforeEach(() => {
  lookupTenantContextByIdMock.mockReset()
  runWithTenantMock.mockClear()
  runAsPlatformMock.mockClear()
})

describe('shim mount', () => {
  it('403s when claims are not internal', async () => {
    const { app, invoke } = makeApp()
    mount(app, 'GET', '/x', async () => NextResponse.json({ ok: true }))
    const reply = makeReply()
    await invoke({ claims: { internal: false }, method: 'GET', url: '/x', headers: {}, params: {} }, reply)
    expect(reply.code).toHaveBeenCalledWith(403)
    expect(reply.send).toHaveBeenCalledWith({ error: 'forbidden', message: 'Internal calls only' })
    expect(runAsPlatformMock).not.toHaveBeenCalled()
  })

  it('platform tenant runs via runAsPlatform with no tenant (GET, no body)', async () => {
    const { app, invoke } = makeApp()
    const inner = vi.fn(async () => NextResponse.json({ hi: 1 }, { status: 201 }))
    mount(app, 'GET', '/x', inner)
    const reply = makeReply()
    await invoke({ claims: { internal: true, tenantId: PLATFORM_TENANT_ID, adminId: 'a1' }, method: 'GET', url: '/x', headers: { 'x-foo': 'bar' }, params: { id: '7' } }, reply)

    expect(runAsPlatformMock).toHaveBeenCalledTimes(1)
    expect(runAsPlatformMock.mock.calls[0][1]).toBe('a1')
    expect(lookupTenantContextByIdMock).not.toHaveBeenCalled()
    // GET → no body passed to the NextRequest
    const shim = inner.mock.calls[0][0] as Request
    expect(shim.method).toBe('GET')
    expect(await shim.text()).toBe('')
    expect(reply.code).toHaveBeenCalledWith(201)
    expect(reply.header).toHaveBeenCalledWith('content-type', 'application/json')
  })

  it('404s when a non-platform tenant is not found', async () => {
    const { app, invoke } = makeApp()
    lookupTenantContextByIdMock.mockResolvedValue(null)
    mount(app, 'GET', '/x', async () => NextResponse.json({}))
    const reply = makeReply()
    await invoke({ claims: { internal: true, tenantId: 'store-1' }, method: 'GET', url: '/x', headers: {}, params: {} }, reply)
    expect(lookupTenantContextByIdMock).toHaveBeenCalledWith('store-1')
    expect(reply.code).toHaveBeenCalledWith(404)
    expect(reply.send).toHaveBeenCalledWith({ error: 'tenant_not_found' })
    expect(runWithTenantMock).not.toHaveBeenCalled()
  })

  it('non-platform tenant runs via runWithTenant and forwards a POST body', async () => {
    const { app, invoke } = makeApp()
    const tenant = { id: 'store-1', slug: 'store' }
    lookupTenantContextByIdMock.mockResolvedValue(tenant)
    const inner = vi.fn(async (req: Request) => {
      const body = await req.json()
      return NextResponse.json({ echo: body })
    })
    mount(app, 'POST', '/x', inner)
    const reply = makeReply()
    await invoke({ claims: { internal: true, tenantId: 'store-1', adminId: 'admin-9' }, method: 'POST', url: '/x', headers: { 'content-type': 'application/json' }, body: { n: 5 }, params: {} }, reply)

    expect(runWithTenantMock).toHaveBeenCalledTimes(1)
    expect(runWithTenantMock.mock.calls[0][0]).toBe(tenant)
    expect(runWithTenantMock.mock.calls[0][2]).toBe('admin-9')
    const shim = inner.mock.calls[0][0] as Request
    expect(shim.method).toBe('POST')
    expect(reply.code).toHaveBeenCalledWith(200)
    const sent = reply.send.mock.calls[0][0]
    expect(Buffer.isBuffer(sent)).toBe(true)
    expect(JSON.parse(sent.toString())).toEqual({ echo: { n: 5 } })
  })

  it('sends undefined for an empty-body response', async () => {
    const { app, invoke } = makeApp()
    lookupTenantContextByIdMock.mockResolvedValue({ id: 'store-1' })
    mount(app, 'DELETE', '/x', async () => new NextResponse(null, { status: 204 }))
    const reply = makeReply()
    await invoke({ claims: { internal: true, tenantId: 'store-1' }, method: 'DELETE', url: '/x', headers: {}, params: {} }, reply)
    expect(reply.code).toHaveBeenCalledWith(204)
    expect(reply.send).toHaveBeenCalledWith(undefined)
  })

  it('POST with a null body is treated as having no body', async () => {
    const { app, invoke } = makeApp()
    lookupTenantContextByIdMock.mockResolvedValue({ id: 'store-1' })
    const inner = vi.fn(async (req: Request) => { expect(await req.text()).toBe(''); return NextResponse.json({ ok: 1 }) })
    mount(app, 'POST', '/x', inner)
    const reply = makeReply()
    await invoke({ claims: { internal: true, tenantId: 'store-1' }, method: 'POST', url: '/x', headers: {}, body: null, params: {} }, reply)
    expect(inner).toHaveBeenCalled()
    expect(reply.code).toHaveBeenCalledWith(200)
  })
})
