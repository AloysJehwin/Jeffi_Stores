import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Readable } from 'node:stream'
import Fastify, { type FastifyInstance } from 'fastify'
import type { ApiKeyRow } from '../src/keys'
import { API_SCOPES, type ApiScope } from '@jeffi/api-contracts'

// Env before importing server.ts. Flagship host, no redis, no k8s.
process.env.SERVICE_AUTH_SECRET = 'test-secret'
process.env.ADMIN_GATEWAY_SECRET = 'test-secret'
process.env.MESSAGING_URL = 'http://messaging.test'
process.env.DOCUMENTS_URL = 'http://documents.test'
delete process.env.REDIS_URL
delete process.env.KUBERNETES_SERVICE_HOST

// ── capture the Fastify app the module builds; never bind a port ──
let captured: FastifyInstance | undefined
vi.mock('fastify', async orig => {
  const mod = (await orig()) as typeof import('fastify')
  const factory = (opts?: any) => {
    const app = (mod.default as any)(opts)
    app.listen = async () => '' // no-op, never binds
    captured = app
    return app
  }
  return { ...mod, default: Object.assign(factory, mod.default) }
})

// ── keys: lookup + touch + cp are all mocked (no DB) ──
const keyRows = new Map<string, ApiKeyRow | null>()
const lookupKey = vi.fn(async (plain: string) => keyRows.get(plain) ?? null)
const touchKey = vi.fn()
vi.mock('../src/keys.js', () => ({
  cp: () => ({ query: vi.fn(async () => ({ rows: [] })) }),
  lookupKey: (p: string) => lookupKey(p),
  touchKey: (...a: any[]) => touchKey(...a),
}))

// ── downstream services via undici ──
const undiciMock = vi.fn()
vi.mock('undici', () => ({ request: (...a: any[]) => undiciMock(...a) }))

// ── wallet ──
vi.mock('@jeffi/wallet', () => ({
  getBalance: vi.fn(async () => 123.45),
  spendSince: vi.fn(async () => 6.78),
}))

// ── scalar docs plugin: register /docs and /docs/ returning HTML ──
vi.mock('@scalar/fastify-api-reference', () => ({
  default: async (app: FastifyInstance) => {
    app.get('/docs', async (_req, reply) => reply.code(301).header('location', '/docs/').send(''))
    app.get('/docs/', async (_req, reply) =>
      reply.header('content-type', 'text/html').send('<html><head><title>Scalar API Reference</title></head><body><script src="js/scalar.js"></script><script>const spec="./openapi.json"</script></body></html>'))
  },
}))

const FLAG_HOST = 'public.jeffistores.in'
const STORE_HOST = 'public-acme.jeffistores.in'

// Build an ApiKeyRow with all scopes + both services enabled, nothing pending.
const fullKey = (over: Partial<ApiKeyRow> = {}): ApiKeyRow => ({
  id: 'key-1',
  owner_id: 'own-1',
  tenant_id: 't-1',
  tenant_slug: 'acme',
  service_types: ['messaging', 'documents'],
  pending_services: [],
  name: 'k',
  key_prefix: 'jk_live_aaaa',
  scopes: [...API_SCOPES],
  rate_limit_per_min: 120,
  status: 'active',
  ...over,
})

const KEY = 'jk_live_fullscope'
const bearer = (k = KEY) => ({ authorization: `Bearer ${k}` })

// JSON upstream response shaped like undici's ResponseData.
function up(status = 200, body: unknown = { ok: true }, headers: Record<string, string> = { 'content-type': 'application/json' }) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    statusCode: status,
    headers,
    body: Object.assign(Readable.from([Buffer.from(text)]), {
      text: async () => text,
      arrayBuffer: async () => Buffer.from(text),
      dump: async () => {},
    }),
  } as any
}

let app!: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  keyRows.clear()
  keyRows.set(KEY, fullKey())
  undiciMock.mockResolvedValue(up())
  if (!app) {
    await import('../src/server')
    app = captured!
    await app.ready()
  }
})

// Maps each scope to a representative endpoint that gates on exactly that scope.
const SCOPE_ROUTE: Record<ApiScope, { method: string; url: string }> = {
  'messages:send': { method: 'POST', url: '/v1/messages' },
  'templates:read': { method: 'GET', url: '/v1/templates' },
  'templates:write': { method: 'POST', url: '/v1/templates' },
  'documents:render': { method: 'POST', url: '/v1/documents/invoice' },
  'documents:read': { method: 'GET', url: '/v1/documents' },
  'wallet:read': { method: 'GET', url: '/v1/wallet' },
}

const serviceFor = (s: ApiScope) => (s.startsWith('documents') ? 'documents' : s === 'wallet:read' ? null : 'messaging')

describe('public API — scope gate matrix (every ApiScope)', () => {
  for (const scope of API_SCOPES) {
    const { method, url } = SCOPE_ROUTE[scope]
    const svc = serviceFor(scope)

    it(`${scope}: a key missing the scope → 403 forbidden`, async () => {
      keyRows.set(KEY, fullKey({ scopes: API_SCOPES.filter(s => s !== scope) }))
      const r = await app.inject({ method: method as any, url, headers: { ...bearer(), 'content-type': 'application/json' }, payload: '{}' })
      expect(r.statusCode).toBe(403)
      expect(r.json().error).toBe('forbidden')
      expect(r.json().message).toContain(`'${scope}' scope`)
    })

    it(`${scope}: a key with the scope passes the gate`, async () => {
      // wallet:read is served in-process; everything else proxies to a (mocked) service.
      const r = await app.inject({ method: method as any, url, headers: { ...bearer(), 'content-type': 'application/json' }, payload: '{}' })
      expect(r.statusCode).toBe(200)
      if (svc) expect(undiciMock).toHaveBeenCalled()
    })
  }
})

describe('public API — auth', () => {
  it('no bearer / non-jk key → 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/templates' })).statusCode).toBe(401)
    const r = await app.inject({ method: 'GET', url: '/v1/templates', headers: { authorization: 'Bearer nope' } })
    expect(r.statusCode).toBe(401)
    expect(r.json().message).toContain('jk_live_')
  })

  it('unknown / revoked key → 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/templates', headers: bearer('jk_live_unknown') })
    expect(r.statusCode).toBe(401)
    expect(r.json().message).toContain('Unknown or revoked')
  })
})

describe('public API — service enablement + approval gates', () => {
  it('service not enabled → 403 service_not_enabled', async () => {
    keyRows.set(KEY, fullKey({ service_types: ['documents'] })) // messaging not enabled
    const r = await app.inject({ method: 'POST', url: '/v1/messages', headers: { ...bearer(), 'content-type': 'application/json' }, payload: '{}' })
    expect(r.statusCode).toBe(403)
    expect(r.json().error).toBe('service_not_enabled')
  })

  it('pending approval → 403 service_pending_approval (send only)', async () => {
    keyRows.set(KEY, fullKey({ pending_services: [{ service: 'messaging', status: 'pending' }] }))
    const r = await app.inject({ method: 'POST', url: '/v1/messages', headers: { ...bearer(), 'content-type': 'application/json' }, payload: '{}' })
    expect(r.statusCode).toBe(403)
    expect(r.json().error).toBe('service_pending_approval')
  })

  it('rejected approval → 403 service_rejected (send only)', async () => {
    keyRows.set(KEY, fullKey({ pending_services: [{ service: 'documents', status: 'rejected' }] }))
    const r = await app.inject({ method: 'POST', url: '/v1/documents/invoice', headers: { ...bearer(), 'content-type': 'application/json' }, payload: '{}' })
    expect(r.statusCode).toBe(403)
    expect(r.json().error).toBe('service_rejected')
  })

  it('a pending service still allows reads (templates:read passes while messaging pending)', async () => {
    keyRows.set(KEY, fullKey({ pending_services: [{ service: 'messaging', status: 'pending' }] }))
    const r = await app.inject({ method: 'GET', url: '/v1/templates', headers: bearer() })
    expect(r.statusCode).toBe(200)
  })
})

describe('public API — proxying', () => {
  it('forwards method + path to the messaging service with a signed service token', async () => {
    await app.inject({ method: 'GET', url: '/v1/messages?limit=5', headers: bearer() })
    const [url, opts] = undiciMock.mock.calls[0]
    expect(url).toBe('http://messaging.test/messages?limit=5')
    expect(opts.headers.authorization).toMatch(/^Bearer /)
  })

  it('charges the wallet on a 200 send (toPaise of charged_inr) and records usage', async () => {
    undiciMock.mockResolvedValue(up(200, { id: 'm1', charged_inr: 1.5 }))
    const r = await app.inject({ method: 'POST', url: '/v1/messages', headers: { ...bearer(), 'content-type': 'application/json' }, payload: '{}' })
    expect(r.statusCode).toBe(200)
    expect(touchKey).toHaveBeenCalledWith('key-1', 'messages', 150)
  })

  it('binary passthrough: non-JSON upstream is streamed with its headers, no spend', async () => {
    undiciMock.mockResolvedValue(up(200, 'PDFBYTES', { 'content-type': 'application/pdf', 'content-disposition': 'inline' }))
    const r = await app.inject({ method: 'GET', url: '/v1/documents/doc-1/pdf', headers: bearer() })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toContain('application/pdf')
    expect(touchKey).toHaveBeenCalledWith('key-1', null)
  })

  it('maps zip_url to an absolute /v1 url on documents bulk', async () => {
    undiciMock.mockResolvedValue(up(200, { id: 'j1', zip_url: '/documents/bulk/j1/zip' }))
    const r = await app.inject({ method: 'POST', url: '/v1/documents/bulk', headers: { ...bearer(), 'content-type': 'application/json', host: FLAG_HOST }, payload: '{}' })
    expect(r.statusCode).toBe(200)
    expect(r.json().zip_url).toMatch(/\/v1\/documents\/bulk\/j1\/zip$/)
  })

  it('submit-approval injects templateId from the path', async () => {
    await app.inject({ method: 'POST', url: '/v1/templates/abc/submit-approval', headers: { ...bearer(), 'content-type': 'application/json' }, payload: '{}' })
    const [url, opts] = undiciMock.mock.calls[0]
    expect(url).toBe('http://messaging.test/v2/templates/wa/submit-approval')
    expect(JSON.parse(opts.body).templateId).toBe('abc')
  })
})

describe('public API — wallet endpoint', () => {
  it('returns balance + today spend from the wallet package', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/wallet', headers: bearer() })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ balance_inr: 123.45, spent_today_inr: 6.78, currency: 'INR' })
  })
})

describe('public API — public, unauthenticated', () => {
  it('healthz is open', async () => {
    const r = await app.inject({ method: 'GET', url: '/healthz' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ ok: true, service: 'public-api' })
  })

  it('/v1/pricing is open', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/pricing' })
    expect(r.statusCode).toBe(200)
  })

  it('/ redirects to /docs', async () => {
    const r = await app.inject({ method: 'GET', url: '/' })
    expect(r.statusCode).toBe(302)
    expect(r.headers.location).toBe('/docs')
  })

  it('openapi.json: flagship host returns the full spec', async () => {
    const r = await app.inject({ method: 'GET', url: '/openapi.json', headers: { host: FLAG_HOST } })
    expect(r.statusCode).toBe(200)
    expect(r.json().openapi).toBe('3.1.0')
    expect(r.json().info.title).toContain('Jeffi')
  })

  it('openapi.json: a non-public host returns the base spec (other)', async () => {
    const r = await app.inject({ method: 'GET', url: '/openapi.json', headers: { host: 'shop.example.com' } })
    expect(r.statusCode).toBe(200)
    expect(r.json().openapi).toBe('3.1.0')
  })
})

describe('public API — docs branding', () => {
  it('/docs serves the /docs/ HTML with a 200 and the Jeffi title, rewriting asset paths', async () => {
    const r = await app.inject({ method: 'GET', url: '/docs', headers: { host: FLAG_HOST } })
    expect(r.statusCode).toBe(200)
    expect(r.payload).toContain('<title>Jeffi API Reference</title>')
    expect(r.payload).toContain('src="/docs/js/scalar.js"')
    expect(r.payload).toContain('"/openapi.json"')
  })

  it('/docs/ direct hit rebrands the tab in place', async () => {
    const r = await app.inject({ method: 'GET', url: '/docs/', headers: { host: FLAG_HOST } })
    expect(r.statusCode).toBe(200)
    expect(r.payload).toContain('<title>Jeffi API Reference</title>')
  })
})

describe('public API — store-host routing', () => {
  it("a store host blocks non-admin/docs paths with 404", async () => {
    // A store host serving /v1/pricing (flagship-only) → 404 via the onRequest guard.
    const r = await app.inject({ method: 'GET', url: '/v1/pricing', headers: { host: STORE_HOST } })
    expect(r.statusCode).toBe(404)
    expect(r.json().error).toBe('not_found')
  })

  it('a store host allows /healthz', async () => {
    const r = await app.inject({ method: 'GET', url: '/healthz', headers: { host: STORE_HOST } })
    expect(r.statusCode).toBe(200)
  })
})

describe('public API — unauthenticated document proxies', () => {
  it('design thumbnail passthrough (200 image)', async () => {
    undiciMock.mockResolvedValue(up(200, 'PNG', { 'content-type': 'image/png' }))
    const r = await app.inject({ method: 'GET', url: '/v1/documents/designs/aurora/thumbnail.png' })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toBe('image/png')
  })

  it('design thumbnail 404 when upstream misses', async () => {
    undiciMock.mockResolvedValue(up(404, '', { 'content-type': 'text/plain' }))
    const r = await app.inject({ method: 'GET', url: '/v1/documents/designs/nope/thumbnail.png' })
    expect(r.statusCode).toBe(404)
  })

  it('public document viewer /d/:token/pdf passthrough', async () => {
    undiciMock.mockResolvedValue(up(200, 'PDF', { 'content-type': 'application/pdf', 'content-disposition': 'inline' }))
    const r = await app.inject({ method: 'GET', url: '/d/tok-1/pdf' })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toContain('application/pdf')
  })

  it('/d/:token/pdf 404 when upstream misses', async () => {
    undiciMock.mockResolvedValue(up(404, '', { 'content-type': 'text/plain' }))
    const r = await app.inject({ method: 'GET', url: '/d/tok-x/pdf' })
    expect(r.statusCode).toBe(404)
  })

  it('/d/:token HTML viewer passthrough', async () => {
    undiciMock.mockResolvedValue(up(200, '<html>doc</html>', { 'content-type': 'text/html' }))
    const r = await app.inject({ method: 'GET', url: '/d/tok-1' })
    expect(r.statusCode).toBe(200)
    expect(r.payload).toContain('doc')
  })
})

describe('public API — error + not-found handlers', () => {
  it('unknown endpoint → 404 not_found', async () => {
    const r = await app.inject({ method: 'GET', url: '/nope', headers: { host: FLAG_HOST } })
    expect(r.statusCode).toBe(404)
    expect(r.json().error).toBe('not_found')
  })

  it('a downstream failure surfaces as 502 upstream_error', async () => {
    undiciMock.mockRejectedValue(new Error('boom'))
    const r = await app.inject({ method: 'GET', url: '/v1/messages', headers: bearer() })
    expect(r.statusCode).toBe(502)
    expect(r.json().error).toBe('upstream_error')
  })
})

describe('public API — every scoped route forwards to its upstream path', () => {
  // Exercises each v1 route handler (functions coverage) and the path/qs building.
  const cases: { method: string; url: string; expect: string; payload?: boolean }[] = [
    { method: 'POST', url: '/v1/media', expect: 'http://messaging.test/media', payload: true },
    { method: 'POST', url: '/v1/messages/batch', expect: 'http://messaging.test/messages/batch', payload: true },
    { method: 'POST', url: '/v1/messages/bulk', expect: 'http://messaging.test/messages/bulk', payload: true },
    { method: 'GET', url: '/v1/messages/bulk?limit=2', expect: 'http://messaging.test/messages/bulk?limit=2' },
    { method: 'GET', url: '/v1/messages/bulk/j1', expect: 'http://messaging.test/messages/bulk/j1' },
    { method: 'GET', url: '/v1/messages/bulk/j1/items?cursor=c', expect: 'http://messaging.test/messages/bulk/j1/items?cursor=c' },
    { method: 'POST', url: '/v1/messages/bulk/j1/cancel', expect: 'http://messaging.test/messages/bulk/j1/cancel', payload: true },
    { method: 'POST', url: '/v1/messages/bulk/j1/retry', expect: 'http://messaging.test/messages/bulk/j1/retry', payload: true },
    { method: 'GET', url: '/v1/messages/m1', expect: 'http://messaging.test/messages/m1' },
    { method: 'GET', url: '/v1/templates/email/cart%2Fabandoned', expect: 'http://messaging.test/v2/templates/email/cart%2Fabandoned' },
    { method: 'GET', url: '/v1/templates/tid/versions', expect: 'http://messaging.test/v2/templates/tid/versions' },
    { method: 'POST', url: '/v1/templates/preview', expect: 'http://messaging.test/v2/templates/preview', payload: true },
    { method: 'POST', url: '/v1/templates/validate', expect: 'http://messaging.test/v2/templates/validate', payload: true },
    { method: 'PUT', url: '/v1/templates/tid', expect: 'http://messaging.test/v2/templates/tid', payload: true },
    { method: 'POST', url: '/v1/templates/tid/publish', expect: 'http://messaging.test/v2/templates/tid/publish', payload: true },
    { method: 'POST', url: '/v1/templates/sync-approval', expect: 'http://messaging.test/v2/templates/wa/sync-approval', payload: true },
    { method: 'DELETE', url: '/v1/templates/email/cart%2Fabandoned', expect: 'http://messaging.test/v2/templates/email/cart%2Fabandoned' },
    { method: 'GET', url: '/v1/documents/bulk/j1', expect: 'http://documents.test/documents/bulk/j1' },
    { method: 'GET', url: '/v1/documents/bulk/j1/items', expect: 'http://documents.test/documents/bulk/j1/items' },
    { method: 'GET', url: '/v1/documents/bulk/j1/zip', expect: 'http://documents.test/documents/bulk/j1/zip' },
    { method: 'POST', url: '/v1/documents/bulk/j1/cancel', expect: 'http://documents.test/documents/bulk/j1/cancel', payload: true },
    { method: 'POST', url: '/v1/documents/bulk/j1/retry', expect: 'http://documents.test/documents/bulk/j1/retry', payload: true },
    { method: 'GET', url: '/v1/documents/designs/aurora/preview/invoice', expect: 'http://documents.test/designs/aurora/preview/invoice' },
    { method: 'GET', url: '/v1/documents/doc-1', expect: 'http://documents.test/documents/doc-1' },
  ]

  for (const c of cases) {
    it(`${c.method} ${c.url}`, async () => {
      undiciMock.mockResolvedValue(up(200, { ok: true }))
      const headers: Record<string, string> = { ...bearer(), host: FLAG_HOST }
      if (c.payload) headers['content-type'] = 'application/json'
      const r = await app.inject({ method: c.method as any, url: c.url, headers, ...(c.payload ? { payload: '{}' } : {}) })
      expect(r.statusCode).toBe(200)
      expect(undiciMock.mock.calls[0][0]).toBe(c.expect)
    })
  }

  it('documents/bulk list maps each item zip_url', async () => {
    undiciMock.mockResolvedValue(up(200, { items: [{ id: 'j1', zip_url: '/documents/bulk/j1/zip' }] }))
    const r = await app.inject({ method: 'GET', url: '/v1/documents/bulk', headers: { ...bearer(), host: FLAG_HOST } })
    expect(r.statusCode).toBe(200)
    expect(r.json().items[0].zip_url).toMatch(/\/v1\/documents\/bulk\/j1\/zip$/)
  })

  it('documents/designs rewrites each thumbnail_url to an absolute /v1/documents path', async () => {
    undiciMock.mockResolvedValue(up(200, { designs: [{ key: 'aurora', thumbnail_url: '/designs/aurora/thumbnail.png' }] }))
    const r = await app.inject({ method: 'GET', url: '/v1/documents/designs', headers: { ...bearer(), host: FLAG_HOST } })
    expect(r.statusCode).toBe(200)
    expect(r.json().designs[0].thumbnail_url).toMatch(/\/v1\/documents\/designs\/aurora\/thumbnail\.png$/)
  })

  it('a non-200 upstream is passed through without a wallet spend', async () => {
    undiciMock.mockResolvedValue(up(402, { error: 'insufficient_balance' }))
    const r = await app.inject({ method: 'POST', url: '/v1/documents/invoice', headers: { ...bearer(), 'content-type': 'application/json', host: FLAG_HOST }, payload: '{}' })
    expect(r.statusCode).toBe(402)
    expect(touchKey).toHaveBeenCalledWith('key-1', null, 0)
  })

  it('upstream non-JSON content-type leaves the body as text (no parse, no map)', async () => {
    undiciMock.mockResolvedValue(up(200, 'plain-text', { 'content-type': 'text/plain' }))
    const r = await app.inject({ method: 'GET', url: '/v1/messages', headers: bearer() })
    expect(r.statusCode).toBe(200)
  })
})

