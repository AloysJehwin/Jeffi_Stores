import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Readable } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import type { ApiKeyRow } from '../../src/keys'
import { API_SCOPES } from '@jeffi/api-contracts'
import { buildOpenApi } from '../../src/openapi'
// @ts-expect-error plain .mjs, no types
import { extractRoutes } from '../../../scripts/check-service-routes.mjs'
import { readFileSync } from 'node:fs'

process.env.SERVICE_AUTH_SECRET = 'test-secret'
process.env.ADMIN_GATEWAY_SECRET = 'test-secret'
process.env.MESSAGING_URL = 'http://messaging.test'
process.env.DOCUMENTS_URL = 'http://documents.test'
delete process.env.REDIS_URL
delete process.env.KUBERNETES_SERVICE_HOST

let captured: FastifyInstance | undefined
vi.mock('fastify', async orig => {
  const mod = (await orig()) as typeof import('fastify')
  const factory = (opts?: any) => {
    const app = (mod.default as any)(opts)
    app.listen = async () => ''
    captured = app
    return app
  }
  return { ...mod, default: Object.assign(factory, mod.default) }
})
const KEY = 'jk_live_contract'
vi.mock('../../src/keys.js', () => ({
  cp: () => ({ query: vi.fn(async () => ({ rows: [] })) }),
  lookupKey: async (p: string) => (p === KEY ? fullKey() : null),
  touchKey: vi.fn(),
}))
const undiciMock = vi.fn()
vi.mock('undici', () => ({ request: (...a: any[]) => undiciMock(...a) }))
vi.mock('@jeffi/wallet', () => ({ getBalance: vi.fn(async () => 123.45), spendSince: vi.fn(async () => 6.78) }))
vi.mock('@scalar/fastify-api-reference', () => ({ default: async () => {} }))

const fullKey = (): ApiKeyRow => ({
  id: 'key-1', owner_id: 'own-1', tenant_id: 't-1', tenant_slug: 'acme', service_types: ['messaging', 'documents'], pending_services: [],
  name: 'k', key_prefix: 'jk_live_aaaa', scopes: [...API_SCOPES], rate_limit_per_min: 120, status: 'active',
})

const up = (status: number, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) => {
  const text = JSON.stringify(body)
  return { statusCode: status, headers, body: Object.assign(Readable.from([Buffer.from(text)]), { text: async () => text, arrayBuffer: async () => Buffer.from(text), dump: async () => {} }) } as any
}

// ── a small OpenAPI 3.1 response checker: declared status, declared content type, required fields and types ──
const spec: any = buildOpenApi()
const deref = (s: any): any => (s?.$ref ? deref(spec.components.schemas[String(s.$ref).split('/').pop()!]) : s)
const typeOk = (t: string, v: unknown) =>
  t === 'integer' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number' : t === 'array' ? Array.isArray(v) : t === 'object' ? !!v && typeof v === 'object' && !Array.isArray(v) : t === 'null' ? v === null : typeof v === t

function problems(schema: any, v: unknown, at = '$'): string[] {
  const s = deref(schema)
  if (!s) return []
  const out: string[] = []
  for (const sub of s.allOf ?? []) out.push(...problems(sub, v, at))
  const alts = s.anyOf ?? s.oneOf
  if (alts && !alts.some((a: any) => problems(a, v, at).length === 0)) out.push(`${at}: matches none of the alternatives`)
  const types: string[] = Array.isArray(s.type) ? s.type : s.type ? [s.type] : []
  if (types.length && !types.some(t => typeOk(t, v))) return [...out, `${at}: expected ${types.join('|')}, got ${v === null ? 'null' : typeof v}`]
  if (s.enum && !s.enum.includes(v)) out.push(`${at}: ${JSON.stringify(v)} not in enum`)
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of s.required ?? []) if (!(k in (v as object))) out.push(`${at}.${k}: required field missing`)
    for (const [k, sub] of Object.entries<any>(s.properties ?? {})) if (k in (v as object)) out.push(...problems(sub, (v as any)[k], `${at}.${k}`))
  }
  if (Array.isArray(v) && s.items) v.slice(0, 3).forEach((x, i) => out.push(...problems(s.items, x, `${at}[${i}]`)))
  return out
}

/** Conformance of one response against the spec for `method path`: status declared, and (when it has a schema) the body shape. */
function conforms(method: string, specPath: string, res: { statusCode: number; headers: any; body: string }) {
  const op = spec.paths?.[specPath]?.[method.toLowerCase()]
  if (!op) return [`${method} ${specPath} is not in the OpenAPI spec`]
  const declared = op.responses?.[String(res.statusCode)]
  if (!declared) return [`${method} ${specPath}: status ${res.statusCode} is not declared (declared: ${Object.keys(op.responses ?? {}).join(', ')})`]
  const ctype = String(res.headers['content-type'] ?? '').split(';')[0]
  const media = declared.content?.[ctype]
  if (declared.content && !media) return [`${method} ${specPath}: content-type ${ctype} is not declared (declared: ${Object.keys(declared.content).join(', ')})`]
  if (!media?.schema || ctype !== 'application/json') return []
  return problems(media.schema, JSON.parse(res.body))
}

const message = { id: '0f8fad5b-d9cb-469f-a165-70867728950e', channel: 'sms', to: '+919999999999', template: null, status: 'sent', provider_ref: 'SM1', price_inr: 0.5, charged_inr: 0.5, error: null, reference: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' }
const totals = { subtotal: 100, discount: 0, charges: 0, taxable: 100, cgst: 9, sgst: 9, igst: 0, round_off: 0, total: 118, amount_paid: 0, balance_due: 118 }
const document = { id: '1f8fad5b-d9cb-469f-a165-70867728950e', type: 'invoice', number: 'INV/26-27/0001', template: 'aurora', totals, pdf_url: 'https://x.test/d/t/pdf', view_url: 'https://x.test/d/t', price_inr: 1.5, reference: null, created_at: '2026-11-01T00:00:00Z' }
const job = (kind: string) => ({ id: '2f8fad5b-d9cb-469f-a165-70867728950e', kind, status: 'queued', total: 2, succeeded: 0, failed: 0, skipped: 0, pending: 2, spent_inr: 0, reference: null, error: null, created_at: '2026-11-01T00:00:00Z', started_at: null, finished_at: null })
const errBody = { error: 'insufficient_balance', message: 'Top up' }

type Case = { name: string; method: string; url: string; specPath: string; status: number; upstream: unknown; payload?: unknown }
const cases: Case[] = [
  { name: 'send a message', method: 'POST', url: '/v1/messages', specPath: '/v1/messages', status: 200, upstream: message, payload: {} },
  { name: 'send a message, wallet short', method: 'POST', url: '/v1/messages', specPath: '/v1/messages', status: 402, upstream: errBody, payload: {} },
  { name: 'list messages', method: 'GET', url: '/v1/messages?limit=1', specPath: '/v1/messages', status: 200, upstream: { items: [message], next_cursor: null } },
  { name: 'get a message', method: 'GET', url: '/v1/messages/m1', specPath: '/v1/messages/{id}', status: 200, upstream: message },
  { name: 'get a missing message', method: 'GET', url: '/v1/messages/nope', specPath: '/v1/messages/{id}', status: 404, upstream: { error: 'not_found', message: 'Message not found' } },
  { name: 'batch send', method: 'POST', url: '/v1/messages/batch', specPath: '/v1/messages/batch', status: 200, upstream: { batch_id: '3f8fad5b-d9cb-469f-a165-70867728950e', accepted: 1, rejected: [{ to: 'x', reason: 'bounced' }] }, payload: {} },
  { name: 'host media', method: 'POST', url: '/v1/media', specPath: '/v1/media', status: 200, upstream: { id: 'a', url: 'https://cdn.test/a.png', charged_inr: 0.1 }, payload: {} },
  { name: 'bulk send', method: 'POST', url: '/v1/messages/bulk', specPath: '/v1/messages/bulk', status: 202, upstream: job('messages'), payload: {} },
  { name: 'bulk send, template missing', method: 'POST', url: '/v1/messages/bulk', specPath: '/v1/messages/bulk', status: 404, upstream: { error: 'not_found', message: 'Template not found' }, payload: {} },
  { name: 'bulk message job', method: 'GET', url: '/v1/messages/bulk/j1', specPath: '/v1/messages/bulk/{id}', status: 200, upstream: job('messages') },
  { name: 'bulk message jobs', method: 'GET', url: '/v1/messages/bulk', specPath: '/v1/messages/bulk', status: 200, upstream: { items: [job('messages')], next_cursor: null } },
  { name: 'render a document', method: 'POST', url: '/v1/documents/invoice', specPath: '/v1/documents/{type}', status: 200, upstream: document, payload: {} },
  { name: 'render a document, wallet short', method: 'POST', url: '/v1/documents/invoice', specPath: '/v1/documents/{type}', status: 402, upstream: errBody, payload: {} },
  { name: 'get a document', method: 'GET', url: '/v1/documents/d1', specPath: '/v1/documents/{id}', status: 200, upstream: document },
  { name: 'list documents', method: 'GET', url: '/v1/documents', specPath: '/v1/documents', status: 200, upstream: { items: [document], next_cursor: null } },
  { name: 'bulk render', method: 'POST', url: '/v1/documents/bulk', specPath: '/v1/documents/bulk', status: 202, upstream: job('documents'), payload: {} },
  { name: 'bulk render, invalid items', method: 'POST', url: '/v1/documents/bulk', specPath: '/v1/documents/bulk', status: 400, upstream: { error: 'validation_error', message: '1 item(s) are invalid', details: [{ index: 0, message: 'x' }] }, payload: {} },
  { name: 'bulk document job', method: 'GET', url: '/v1/documents/bulk/j1', specPath: '/v1/documents/bulk/{id}', status: 200, upstream: job('documents') },
  { name: 'bulk document jobs', method: 'GET', url: '/v1/documents/bulk', specPath: '/v1/documents/bulk', status: 200, upstream: { items: [job('documents')], next_cursor: null } },
  { name: 'bulk items', method: 'GET', url: '/v1/documents/bulk/j1/items', specPath: '/v1/documents/bulk/{id}/items', status: 200, upstream: { items: [{ seq: 1, status: 'done', error: null, reference: null, result: document }], next_cursor: null } },
  { name: 'bulk cancel', method: 'POST', url: '/v1/documents/bulk/j1/cancel', specPath: '/v1/documents/bulk/{id}/cancel', status: 200, upstream: job('documents'), payload: {} },
  { name: 'designs', method: 'GET', url: '/v1/documents/designs', specPath: '/v1/documents/designs', status: 200, upstream: { designs: [{ key: 'aurora', name: 'Aurora', description: 'd', accent: '#112233', font: 'editorial', thumbnail_url: '/designs/aurora/thumbnail.png' }], fonts: [{ key: 'editorial', label: 'Editorial' }], default: 'aurora' } },
  { name: 'wallet (served in-process)', method: 'GET', url: '/v1/wallet', specPath: '/v1/wallet', status: 200, upstream: null },
]

let app!: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  if (!app) {
    await import('../../src/server')
    app = captured!
    await app.ready()
  }
})

describe('public API responses match the OpenAPI definition', () => {
  for (const c of cases) {
    it(`${c.method} ${c.specPath} -> ${c.status}: ${c.name}`, async () => {
      undiciMock.mockResolvedValue(up(c.status, c.upstream))
      const res = await app.inject({ method: c.method as any, url: c.url, headers: { authorization: `Bearer ${KEY}`, host: 'public.jeffistores.in', ...(c.payload ? { 'content-type': 'application/json' } : {}) }, ...(c.payload ? { payload: JSON.stringify(c.payload) } : {}) })
      expect(res.statusCode).toBe(c.status)
      expect(conforms(c.method, c.specPath, { statusCode: res.statusCode, headers: res.headers, body: res.body })).toEqual([])
    })
  }

  it('the PDF endpoints answer with a declared application/pdf body', async () => {
    const pdf = Buffer.from('%PDF-1.4 x')
    const stream = () => ({ statusCode: 200, headers: { 'content-type': 'application/pdf' }, body: Object.assign(Readable.from([pdf]), { dump: async () => {} }) }) as any
    for (const [url, specPath] of [['/v1/documents/d1/pdf', '/v1/documents/{id}/pdf'], ['/v1/documents/designs/aurora/preview/invoice', '/v1/documents/designs/{key}/preview/{type}']]) {
      undiciMock.mockResolvedValue(stream())
      const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${KEY}` } })
      expect(res.statusCode).toBe(200)
      expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF')
      expect(conforms('GET', specPath, { statusCode: 200, headers: res.headers, body: '' })).toEqual([])
    }
  })

  it('the ZIP endpoint answers with a declared application/zip body', async () => {
    undiciMock.mockResolvedValue({ statusCode: 200, headers: { 'content-type': 'application/zip' }, body: Object.assign(Readable.from([Buffer.from('PK')]), { dump: async () => {} }) } as any)
    const res = await app.inject({ method: 'GET', url: '/v1/documents/bulk/j1/zip', headers: { authorization: `Bearer ${KEY}` } })
    expect(res.statusCode).toBe(200)
    expect(conforms('GET', '/v1/documents/bulk/{id}/zip', { statusCode: 200, headers: res.headers, body: '' })).toEqual([])
  })

  it('the checker itself rejects a body missing a required field', () => {
    const { id: _drop, ...broken } = message
    expect(conforms('GET', '/v1/messages/{id}', { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(broken) })).toEqual(['$.id: required field missing'])
    expect(conforms('GET', '/v1/messages/{id}', { statusCode: 418, headers: {}, body: '{}' })[0]).toContain('status 418 is not declared')
  })
})

describe('every authenticated /v1 route is documented in the OpenAPI spec', () => {
  const norm = (p: string) => p.replace(/\{[^}]+\}/g, '{}').replace(/:[A-Za-z]+/g, '{}')
  const served = (extractRoutes(readFileSync(new URL('../../src/server.ts', import.meta.url), 'utf8'), { v1: '/v1' }) as { method: string; path: string }[])
    .filter(r => r.path.startsWith('/v1/'))
    // key-less by design: design thumbnails are plain <img> sources
    .filter(r => !r.path.endsWith('/thumbnail.png'))
    .map(r => `${r.method} ${norm(r.path)}`)
  const documented = Object.entries<any>(spec.paths).flatMap(([p, ops]) => Object.keys(ops).filter(m => ['get', 'post', 'put', 'delete', 'patch'].includes(m)).map(m => `${m.toUpperCase()} ${norm(p)}`))

  it('has a spec entry for each served route', () => {
    expect(served.filter(r => !documented.includes(r))).toEqual([])
  })
  it('serves every route the spec documents', () => {
    expect(documented.filter(r => !r.includes('/v1/admin') && !r.includes('/v1/platform') && !served.includes(r))).toEqual([])
  })
})
