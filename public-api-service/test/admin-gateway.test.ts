import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Readable } from 'node:stream'
import Fastify from 'fastify'

process.env.ADMIN_GATEWAY_SECRET = 'test-secret'
delete process.env.KUBERNETES_SERVICE_HOST

import { GATEWAY_HEADER, verifyGatewayToken } from '@jeffi/service-auth'
import { PLATFORM_TENANT_ID } from '@jeffi/tenancy'
import { classifyHost, registerAdminGateway, safeSubPath, upstreamsFor, type AdminTokenRow, type StoreRef } from '../src/admin-gateway'
import { adminPaths, adminRoutesFor, type Manifest } from '../src/admin-docs'

const ACME: StoreRef = { tenantId: 't-acme', slug: 'acme', name: 'Acme', planScopes: new Set(['orders:read', 'orders:write']) }
const FLAG: StoreRef = { tenantId: PLATFORM_TENANT_ID, slug: null, name: 'Jeffi Stores', planScopes: null }
const JFC = 'jfc_' + 'a'.repeat(43)
const JSA = 'jsa_' + 'b'.repeat(43)
const token = (o: Partial<AdminTokenRow> = {}): AdminTokenRow => ({ id: 'tok-1', tenantId: 't-acme', kind: 'cli', adminId: 'adm-1', serviceAccountId: null, adminRole: 'admin', scopes: ['*'], ...o })

function upstream(status = 200, body: unknown = { ok: true }, headers: Record<string, string> = { 'content-type': 'application/json' }) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  const stream = Object.assign(Readable.from([Buffer.from(text)]), { text: async () => text })
  return { statusCode: status, headers, body: stream } as any
}

let tokens: Record<string, AdminTokenRow>
const send = vi.fn()

function memIdem() {
  const m = new Map<string, string>()
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => m.set(k, v),
    claim: async (k: string, v: string) => (m.has(k) ? false : (m.set(k, v), true)),
    del: async (k: string) => m.delete(k),
  }
}

function build(idem: ReturnType<typeof memIdem> | null = null) {
  const app = Fastify()
  registerAdminGateway(app, {
    lookupToken: async plain => tokens[plain] ?? null,
    resolveStore: async ph => (ph.kind === 'flagship' ? FLAG : ph.kind === 'store' && ph.slug === 'acme' ? ACME : null),
    send,
    idem,
  })
  return app
}

beforeEach(() => {
  tokens = { [JFC]: token() }
  send.mockReset().mockResolvedValue(upstream())
})

const call = (app: ReturnType<typeof build>, o: { url: string; host: string; method?: string; bearer?: string; body?: string; headers?: Record<string, string> }) =>
  app.inject({
    method: (o.method ?? 'GET') as any,
    url: o.url,
    headers: { host: o.host, ...(o.bearer ? { authorization: `Bearer ${o.bearer}` } : {}), ...(o.headers ?? {}) },
    ...(o.body !== undefined ? { payload: o.body } : {}),
  })

describe('admin gateway: who may call', () => {
  it('needs a known jfc_/jsa_ token', async () => {
    const app = build()
    expect((await call(app, { url: '/v1/admin/orders', host: 'public-acme.jeffistores.in' })).statusCode).toBe(401)
    expect((await call(app, { url: '/v1/admin/orders', host: 'public-acme.jeffistores.in', bearer: 'jfc_' + 'z'.repeat(43) })).statusCode).toBe(401)
    expect((await call(app, { url: '/v1/admin/orders', host: 'public-acme.jeffistores.in', bearer: 'eyJhbGciOi.x.y' })).statusCode).toBe(401)
    expect(send).not.toHaveBeenCalled()
  })

  it("a token works only on its own store's host", async () => {
    const app = build()
    const r = await call(app, { url: '/v1/admin/orders', host: 'public.jeffistores.in', bearer: JFC })
    expect(r.statusCode).toBe(403)
    expect(r.json().error).toBe('wrong_store')
    expect((await call(app, { url: '/v1/admin/orders', host: 'public-nope.jeffistores.in', bearer: JFC })).statusCode).toBe(404)
    expect((await call(app, { url: '/v1/admin/orders', host: 'shop.example.com', bearer: JFC })).statusCode).toBe(404)
    expect(send).not.toHaveBeenCalled()
  })

  it('the platform API: flagship host, full-scope token of a platform administrator only', async () => {
    tokens = {
      [JFC]: token({ tenantId: PLATFORM_TENANT_ID, adminRole: 'administrator' }),
      [JSA]: token({ tenantId: PLATFORM_TENANT_ID, kind: 'service_account', adminId: null, serviceAccountId: 'sa-1', adminRole: null }),
    }
    const app = build()
    expect((await call(app, { url: '/v1/platform/ecom/customers', host: 'public-acme.jeffistores.in', bearer: JFC })).statusCode).toBe(404)
    expect((await call(app, { url: '/v1/platform/ecom/customers', host: 'public.jeffistores.in', bearer: JSA })).json().error).toBe('platform_forbidden')
    tokens[JFC + 'x'] = token({ tenantId: PLATFORM_TENANT_ID, adminRole: 'administrator', scopes: ['ecom_customers:read'] })
    tokens['jfc_' + 'c'.repeat(43)] = token({ tenantId: PLATFORM_TENANT_ID, adminRole: 'super_admin' })
    expect((await call(app, { url: '/v1/platform/ecom/customers', host: 'public.jeffistores.in', bearer: 'jfc_' + 'c'.repeat(43) })).statusCode).toBe(403)
    expect((await call(app, { url: '/v1/platform/ecom/customers', host: 'public.jeffistores.in', bearer: JFC })).statusCode).toBe(200)
  })

  it('ecom routes live only under /v1/platform, and nothing else does', async () => {
    tokens = { [JFC]: token({ tenantId: PLATFORM_TENANT_ID, adminRole: 'administrator' }) }
    const app = build()
    expect((await call(app, { url: '/v1/admin/ecom/customers', host: 'public.jeffistores.in', bearer: JFC })).statusCode).toBe(404)
    expect((await call(app, { url: '/v1/platform/orders', host: 'public.jeffistores.in', bearer: JFC })).statusCode).toBe(404)
  })

  it('refuses path tricks', async () => {
    const app = build()
    for (const url of ['/v1/admin/a%2fb', '/v1/admin/a%5cb', '/v1/admin/a//b']) {
      expect([url, (await call(app, { url, host: 'public-acme.jeffistores.in', bearer: JFC })).statusCode]).toEqual([url, 400])
    }
    // inject() resolves dot segments itself, so check the parser directly.
    expect(safeSubPath('a/%2e%2e/b')).toBeNull()
    expect(safeSubPath('a/./b')).toBeNull()
    expect(safeSubPath('orders/123')).toBe('orders/123')
  })
})

describe('admin gateway: forwarding', () => {
  it("passes method, path, query, body and content type to the store's admin, as the admin host", async () => {
    send.mockResolvedValue(upstream(201, { id: 'c1' }, { 'content-type': 'application/json', 'set-cookie': 'x=1', location: '/x' }))
    const app = build()
    const r = await call(app, {
      url: '/v1/admin/coupons?draft=1',
      host: 'public-acme.jeffistores.in',
      method: 'POST',
      bearer: JFC,
      body: '{"code":"A"}',
      headers: { 'content-type': 'application/json', cookie: 'admin_sid=s', 'x-request-id': 'rq-1' },
    })
    expect(r.statusCode).toBe(201)
    expect(r.json()).toEqual({ id: 'c1' })
    expect(r.headers.location).toBe('/x')
    expect(r.headers['set-cookie']).toBeUndefined()
    const [url, opts] = send.mock.calls[0]
    expect(url).toBe('http://localhost:3000/api/admin/coupons?draft=1')
    expect(opts.method).toBe('POST')
    expect(opts.body.toString()).toBe('{"code":"A"}')
    expect(opts.headers).toMatchObject({ host: 'admin-acme.jeffistores.in', 'x-forwarded-host': 'admin-acme.jeffistores.in', 'content-type': 'application/json', 'x-request-id': 'rq-1' })
    expect(opts.headers.authorization).toBeUndefined()
    expect(opts.headers.cookie).toBeUndefined()
  })

  it('attaches a short-lived signed header bound to the store, holder and host', async () => {
    const app = build()
    await call(app, { url: '/v1/admin/orders', host: 'public-acme.jeffistores.in', bearer: JFC })
    const c = verifyGatewayToken(send.mock.calls[0][1].headers[GATEWAY_HEADER])
    expect(c).toMatchObject({ tenantId: 't-acme', kind: 'cli', adminId: 'adm-1', scopes: ['*'], tokenId: 'tok-1', host: 'admin-acme.jeffistores.in' })
    expect(c!.platform).toBeUndefined()
    expect(c!.exp - Date.now() / 1000).toBeLessThanOrEqual(60)
  })

  it('a platform call goes to the controller, marked platform', async () => {
    tokens = { [JFC]: token({ tenantId: PLATFORM_TENANT_ID, adminRole: 'administrator' }) }
    const app = build()
    await call(app, { url: '/v1/platform/ecom/customers/overview', host: 'public.jeffistores.in', bearer: JFC })
    const [url, opts] = send.mock.calls[0]
    expect(url).toBe('http://localhost:3000/api/admin/ecom/customers/overview')
    expect(opts.headers.host).toBe('admin.jeffistores.in')
    expect(verifyGatewayToken(opts.headers[GATEWAY_HEADER])).toMatchObject({ platform: true, tenantId: PLATFORM_TENANT_ID })
  })

  it("the device login's start and poll need no token and carry no gateway header", async () => {
    const app = build()
    const r = await call(app, { url: '/v1/admin/cli-auth/start', host: 'public-acme.jeffistores.in', method: 'POST', body: '{"client_id":"jeffi-cli"}', headers: { 'content-type': 'application/json' } })
    expect(r.statusCode).toBe(200)
    const [url, opts] = send.mock.calls[0]
    expect(url).toBe('http://localhost:3000/api/admin/cli-auth/start')
    expect(opts.headers[GATEWAY_HEADER]).toBeUndefined()
    expect(opts.headers.host).toBe('admin-acme.jeffistores.in')
  })

  it("502 when the store's admin does not answer", async () => {
    send.mockRejectedValue(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))
    const app = build()
    expect((await call(app, { url: '/v1/admin/orders', host: 'public-acme.jeffistores.in', bearer: JFC })).statusCode).toBe(502)
  })
})

describe('admin gateway: Idempotency-Key', () => {
  const post = (app: ReturnType<typeof build>, body = '{"code":"A"}', url = '/v1/admin/coupons', key = 'k-1') =>
    call(app, { url, host: 'public-acme.jeffistores.in', method: 'POST', bearer: JFC, body, headers: { 'content-type': 'application/json', 'idempotency-key': key } })

  it('replays the first response for the same request', async () => {
    send.mockResolvedValue(upstream(201, { id: 'c1' }))
    const app = build(memIdem())
    expect((await post(app)).statusCode).toBe(201)
    const again = await post(app)
    expect(again.statusCode).toBe(201)
    expect(again.json()).toEqual({ id: 'c1' })
    expect(again.headers['idempotent-replayed']).toBe('true')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('the same key on another body, path or query is 422, and is scoped to the token', async () => {
    const idem = memIdem()
    const app = build(idem)
    await post(app)
    expect((await post(app, '{"code":"B"}')).json().error).toBe('idempotency_key_reused')
    expect((await post(app, '{"code":"A"}', '/v1/admin/products')).statusCode).toBe(422)
    expect((await post(app, '{"code":"A"}', '/v1/admin/coupons?x=1')).statusCode).toBe(422)
    tokens[JSA] = token({ id: 'tok-2', kind: 'service_account', adminId: null, serviceAccountId: 'sa-1' })
    const other = await call(app, { url: '/v1/admin/coupons', host: 'public-acme.jeffistores.in', method: 'POST', bearer: JSA, body: '{"code":"B"}', headers: { 'content-type': 'application/json', 'idempotency-key': 'k-1' } })
    expect(other.statusCode).toBe(200)
    expect(send).toHaveBeenCalledTimes(2)
    expect([...idem.m.keys()].every(k => /^idem:adm:tok-[12]:[0-9a-f]{64}$/.test(k))).toBe(true)
  })

  it('a duplicate while the first still runs is 409, and a 5xx frees the key', async () => {
    let finish!: (v: unknown) => void
    send.mockReturnValueOnce(new Promise(r => (finish = r)))
    const app = build(memIdem())
    const first = post(app)
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect((await post(app)).json().error).toBe('idempotency_in_progress')
    finish(upstream(500, { error: 'boom' }))
    expect((await first).statusCode).toBe(500)
    send.mockResolvedValue(upstream(201, { id: 'c2' }))
    expect((await post(app)).statusCode).toBe(201)
    expect(send).toHaveBeenCalledTimes(2)
  })
})

describe('hosts and upstreams', () => {
  afterEach(() => {
    delete process.env.KUBERNETES_SERVICE_HOST
  })

  it('classifies public hosts', () => {
    expect(classifyHost('public.jeffistores.in')).toMatchObject({ kind: 'flagship' })
    expect(classifyHost('public-acme.jeffistores.in')).toMatchObject({ kind: 'store', slug: 'acme' })
    expect(classifyHost('public-acme.localhost:3000')).toMatchObject({ kind: 'store', slug: 'acme' })
    expect(classifyHost('public-acme.evil.com')).toMatchObject({ kind: 'other' })
    expect(classifyHost('admin.jeffistores.in')).toMatchObject({ kind: 'other' })
  })

  it('in the cluster: the store namespace, the platform admin, or the controller', () => {
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1'
    expect(upstreamsFor(ACME, false)).toEqual([
      'http://acme-admin-service.tenant-acme.svc.cluster.local:3000',
      'http://acme-controller-service.tenant-acme.svc.cluster.local:3000',
    ])
    expect(upstreamsFor(FLAG, false)).toEqual(['http://jeffi-stores-admin-service.jeffi.svc.cluster.local:3000'])
    expect(upstreamsFor(FLAG, true)).toEqual(['http://jeffi-stores-controller-service.jeffi.svc.cluster.local:3000'])
    expect(classifyHost('localhost:3100')).toMatchObject({ kind: 'other' })
  })
})

describe('per-host docs', () => {
  const r = (o: object) => ({ host: 'admin', method: 'GET', path: '/api/admin/x', gatewayPath: '/v1/admin/x', pathParams: [], query: [], scope: null, platform: null, body: null, summary: null, command: 'x', ...o })
  const m: Manifest = {
    manifestHash: 'h',
    routes: [
      r({ gatewayPath: '/v1/admin/orders', scope: 'orders:read' }),
      r({ gatewayPath: '/v1/admin/gst', scope: 'gst:read' }),
      r({ gatewayPath: '/v1/admin/flagship-only', platform: 'admin' }),
      r({ gatewayPath: '/v1/admin/mfa/verify' }),
      r({ gatewayPath: '/v1/admin/cli/whoami' }),
      r({ gatewayPath: '/v1/admin/cli/approve', method: 'POST' }),
      r({ host: 'platform', gatewayPath: '/v1/platform/ecom/customers', platform: 'admin' }),
      r({ host: 'storefront', gatewayPath: null }),
    ] as any,
  }

  it("a store's document: its plan's admin routes, nothing flagship-only, no sign-in routes", () => {
    expect(adminRoutesFor(m, ACME).map(x => x.gatewayPath)).toEqual(['/v1/admin/orders', '/v1/admin/cli/whoami'])
  })

  it('renders typed query parameters and every body variant, DELETE bodies included', () => {
    const file = { type: 'object', properties: { file: { type: 'string', format: 'binary' } } }
    const paths: any = adminPaths([
      r({ gatewayPath: '/v1/admin/up', method: 'POST', body: file, bodyContentType: 'multipart/form-data' }),
      r({ gatewayPath: '/v1/admin/notes', method: 'POST', body: { type: 'object', properties: { title: { type: 'string', description: 'Heading' } } }, bodyAlternatives: [{ contentType: 'multipart/form-data', schema: file }] }),
      r({ gatewayPath: '/v1/admin/einvoice', method: 'DELETE', body: { type: 'object', properties: { reason: { type: 'number' } } } }),
      r({ gatewayPath: '/v1/admin/clear', method: 'POST', body: null, noBody: true }),
      r({ gatewayPath: '/v1/admin/list', query: ['old'], queryParams: [{ name: 'tab', required: true, schema: { type: 'string', enum: ['a', 'b'], default: 'a' } }] }),
      r({ gatewayPath: '/v1/admin/legacy', query: ['page'] }),
    ] as any)
    expect(paths['/v1/admin/up'].post.requestBody.content).toEqual({ 'multipart/form-data': { schema: file } })
    expect(Object.keys(paths['/v1/admin/notes'].post.requestBody.content)).toEqual(['application/json', 'multipart/form-data'])
    expect(paths['/v1/admin/notes'].post.requestBody.content['application/json'].schema.properties.title.description).toBe('Heading')
    expect(paths['/v1/admin/einvoice'].delete.requestBody.content['application/json'].schema.properties.reason).toEqual({ type: 'number' })
    expect(paths['/v1/admin/clear'].post.requestBody).toBeUndefined()
    expect(paths['/v1/admin/list'].get.parameters).toEqual([{ name: 'tab', in: 'query', required: true, schema: { type: 'string', enum: ['a', 'b'], default: 'a' } }])
    expect(paths['/v1/admin/legacy'].get.parameters).toEqual([{ name: 'page', in: 'query', required: false, schema: { type: 'string' } }])
  })

  it("the flagship's document adds the platform API", () => {
    expect(adminRoutesFor(m, FLAG).map(x => x.gatewayPath)).toEqual(['/v1/admin/orders', '/v1/admin/gst', '/v1/admin/flagship-only', '/v1/admin/cli/whoami', '/v1/platform/ecom/customers'])
  })
})
