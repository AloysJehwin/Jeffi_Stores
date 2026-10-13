import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import apiReference from '@scalar/fastify-api-reference'
import Redis from 'ioredis'
import { request as undici } from 'undici'
import { randomUUID } from 'node:crypto'
import { signServiceToken } from '@jeffi/service-auth'
import { priceList, toPaise } from '@jeffi/pricing'
import * as wallet from '@jeffi/wallet'
import type { ApiScope } from '@jeffi/api-contracts'
import { lookupKey, touchKey, type ApiKeyRow } from './keys.js'
import { buildOpenApi } from './openapi.js'

const MESSAGING_URL = (process.env.MESSAGING_URL || 'http://localhost:3101').replace(/\/$/, '')
const DOCUMENTS_URL = (process.env.DOCUMENTS_URL || 'http://localhost:3102').replace(/\/$/, '')
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' }, genReqId: () => randomUUID() })

// Accept an empty JSON body (DELETE / body-less POST with Content-Type: application/json).
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  try { done(null, body ? JSON.parse(body as string) : {}) } catch (e: any) { e.statusCode = 400; done(e, undefined) }
})

declare module 'fastify' {
  interface FastifyRequest {
    key: ApiKeyRow
  }
}

// ── public, unauthenticated ──
app.get('/healthz', async () => ({ ok: true, service: 'public-api' }))
const openapi = buildOpenApi()
app.get('/openapi.json', async () => openapi)
await app.register(apiReference, { routePrefix: '/docs', configuration: { content: openapi, theme: 'kepler' } })
// Scalar's /docs → /docs/ 301 bounces with Next's trailingSlash:false (which 308s /docs/ back
// to /docs), creating an infinite redirect loop behind the public.* Next rewrite. Serve
// /docs/'s HTML directly on /docs with a 200 AND rewrite the HTML's relative asset paths
// (`js/scalar.js`, `./openapi.json`) to absolute `/docs/*` so the browser resolves them
// against the right directory regardless of the URL having no trailing slash.
app.addHook('onSend', async (req, reply, payload) => {
  if (req.url === '/docs' && reply.statusCode === 301) {
    const r = await app.inject({ method: 'GET', url: '/docs/' })
    const html = r.payload
      .replace(/(src|href)="(?!https?:|\/|data:)([^"]+)"/g, '$1="/docs/$2"')
      .replace(/"\.?\/?openapi\.json"/g, '"/openapi.json"')
    reply.code(200)
    const ct = r.headers['content-type']
    if (ct) reply.header('content-type', ct)
    reply.header('content-length', Buffer.byteLength(html))
    return html
  }
  return payload
})
app.get('/', async (_req, reply) => reply.redirect('/docs'))
app.get('/v1/pricing', async () => priceList())

// ── API-key auth for /v1/* ──
await app.register(rateLimit, {
  global: false,
  redis: redis ?? undefined,
  keyGenerator: req => (req as FastifyRequest).key?.id ?? req.ip,
  max: req => (req as FastifyRequest).key?.rate_limit_per_min ?? 30,
  timeWindow: '1 minute',
  addHeadersOnExceeding: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true, 'x-ratelimit-reset': true },
  addHeaders: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true, 'x-ratelimit-reset': true, 'retry-after': true },
})

const fail = (reply: FastifyReply, status: number, error: string, message: string) => reply.code(status).send({ error, message })

async function auth(req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization
  const plain = h?.startsWith('Bearer ') ? h.slice(7).trim() : ''
  if (!plain.startsWith('jk_')) return fail(reply, 401, 'unauthorized', 'Pass your API key as `Authorization: Bearer jk_live_…`')
  const key = await lookupKey(plain)
  if (!key) return fail(reply, 401, 'unauthorized', 'Unknown or revoked API key')
  req.key = key
}

const need =
  (scope: ApiScope, service: 'messaging' | 'documents') =>
  async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.key.scopes.includes(scope)) return fail(reply, 403, 'forbidden', `This key lacks the '${scope}' scope`)
    if (!req.key.service_types.includes(service)) return fail(reply, 403, 'service_not_enabled', `Enable the ${service} service in your dashboard first`)
    // Sending/rendering waits for Jeffi's approval; reads and previews don't.
    const gate = req.key.pending_services.find(p => p.service === service)
    if (gate && (scope === 'messages:send' || scope === 'documents:render')) {
      return gate.status === 'rejected'
        ? fail(reply, 403, 'service_rejected', `Your ${service} access was not approved. Contact support@jeffistores.in.`)
        : fail(reply, 403, 'service_pending_approval', `Your ${service} access is under review — sending starts once Jeffi approves it (usually the same day).`)
    }
  }

// Idempotency: replay the stored response for a repeated POST with the same key within 24 h.
async function idempotent(req: FastifyRequest, reply: FastifyReply) {
  if (!redis || req.method !== 'POST') return
  const k = req.headers['idempotency-key']
  if (!k || typeof k !== 'string') return
  const cached = await redis.get(`idem:${req.key.id}:${k}`)
  if (cached) {
    const { status, body } = JSON.parse(cached)
    reply.header('idempotent-replayed', 'true')
    return reply.code(status).send(body)
  }
}
async function remember(req: FastifyRequest, status: number, body: unknown) {
  if (!redis || req.method !== 'POST') return
  const k = req.headers['idempotency-key']
  if (k && typeof k === 'string') await redis.set(`idem:${req.key.id}:${k}`, JSON.stringify({ status, body }), 'EX', 86400)
}

/** Forward to a service with a short-lived HMAC token carrying the tenant. */
async function proxy(req: FastifyRequest, reply: FastifyReply, base: string, path: string, kind: 'messages' | 'documents' | null, map?: (body: any) => any) {
  const token = signServiceToken({ service: 'public-api', tenantId: req.key.tenant_id, tenantSlug: req.key.tenant_slug, apiKeyId: req.key.id }, 60)
  const res = await undici(base + path, {
    method: req.method as 'GET' | 'POST' | 'PUT' | 'DELETE',
    headers: { authorization: `Bearer ${token}`, 'x-request-id': req.id, ...(req.method === 'POST' || req.method === 'PUT' ? { 'content-type': 'application/json' } : {}) },
    body: req.method === 'POST' || req.method === 'PUT' ? JSON.stringify(req.body ?? {}) : undefined,
  })
  const ctype = String(res.headers['content-type'] ?? '')
  if (!ctype.includes('json')) {
    // Binary passthrough (PDFs, images, ZIPs) — streamed, not buffered.
    touchKey(req.key.id, null)
    for (const h of ['content-type', 'content-disposition', 'cache-control']) if (res.headers[h]) reply.header(h, res.headers[h] as string)
    return reply.code(res.statusCode).send(res.body)
  }
  const text = await res.body.text()
  let body: any = text
  try {
    body = JSON.parse(text)
  } catch {}
  const spend = res.statusCode === 200 && kind ? toPaise(Number(body?.charged_inr ?? body?.price_inr ?? 0)) : 0
  touchKey(req.key.id, res.statusCode === 200 ? kind : null, spend)
  if (map && res.statusCode === 200) body = map(body)
  await remember(req, res.statusCode, body)
  return reply.code(res.statusCode).send(body)
}

const enc = (s: string) => encodeURIComponent(s)
const publicBase = (req: FastifyRequest) => (process.env.PUBLIC_API_URL || `${req.protocol}://${req.host}`).replace(/\/$/, '')
const qs = (req: FastifyRequest) => {
  const i = req.url.indexOf('?')
  return i === -1 ? '' : req.url.slice(i)
}

app.register(async v1 => {
  v1.addHook('preHandler', auth)
  v1.addHook('preHandler', v1.rateLimit())
  v1.addHook('preHandler', idempotent)

  v1.post('/messages', { preHandler: need('messages:send', 'messaging') }, (req, reply) => proxy(req, reply, MESSAGING_URL, '/messages', 'messages'))
  v1.post('/messages/batch', { preHandler: need('messages:send', 'messaging') }, (req, reply) => proxy(req, reply, MESSAGING_URL, '/messages/batch', 'messages'))
  // Bulk = async jobs: POST returns 202 + the job; poll GET …/bulk/:id, then page through …/items.
  const msgBulk = { preHandler: need('messages:send', 'messaging') }
  v1.post('/messages/bulk', { ...msgBulk, bodyLimit: 10_000_000 }, (req, reply) => proxy(req, reply, MESSAGING_URL, '/messages/bulk', null))
  v1.get('/messages/bulk', msgBulk, (req, reply) => proxy(req, reply, MESSAGING_URL, '/messages/bulk' + qs(req), null))
  v1.get<{ Params: { id: string } }>('/messages/bulk/:id', msgBulk, (req, reply) => proxy(req, reply, MESSAGING_URL, `/messages/bulk/${enc(req.params.id)}`, null))
  v1.get<{ Params: { id: string } }>('/messages/bulk/:id/items', msgBulk, (req, reply) => proxy(req, reply, MESSAGING_URL, `/messages/bulk/${enc(req.params.id)}/items` + qs(req), null))
  v1.post<{ Params: { id: string } }>('/messages/bulk/:id/cancel', msgBulk, (req, reply) => proxy(req, reply, MESSAGING_URL, `/messages/bulk/${enc(req.params.id)}/cancel`, null))
  v1.post<{ Params: { id: string } }>('/messages/bulk/:id/retry', msgBulk, (req, reply) => proxy(req, reply, MESSAGING_URL, `/messages/bulk/${enc(req.params.id)}/retry`, null))
  v1.get('/messages', { preHandler: need('messages:send', 'messaging') }, (req, reply) => proxy(req, reply, MESSAGING_URL, '/messages' + qs(req), null))
  v1.get<{ Params: { id: string } }>('/messages/:id', { preHandler: need('messages:send', 'messaging') }, (req, reply) => proxy(req, reply, MESSAGING_URL, `/messages/${req.params.id}`, null))
  // Templates = the templates library (the same records as the dashboard's Messaging → Templates):
  // your copies plus the standard templates; saving a standard slug creates your own copy.
  // Slugs contain '/', so URL-encode them in paths (cart%2Fabandoned).
  const read = { preHandler: need('templates:read', 'messaging') }
  const write = { preHandler: need('templates:write', 'messaging') }
  v1.get('/templates', read, (req, reply) => proxy(req, reply, MESSAGING_URL, '/v2/templates' + qs(req), null))
  v1.get<{ Params: { channel: string; slug: string } }>('/templates/:channel/:slug', read, (req, reply) =>
    proxy(req, reply, MESSAGING_URL, `/v2/templates/${req.params.channel}/${enc(req.params.slug)}` + qs(req), null))
  v1.get<{ Params: { channel: string } }>('/templates/:channel/versions', read, (req, reply) => proxy(req, reply, MESSAGING_URL, `/v2/templates/${req.params.channel}/versions`, null)) // :channel = template id
  v1.post('/templates/preview', read, (req, reply) => proxy(req, reply, MESSAGING_URL, '/v2/templates/preview', null))
  v1.post('/templates/validate', read, (req, reply) => proxy(req, reply, MESSAGING_URL, '/v2/templates/validate', null))
  v1.post('/templates', write, (req, reply) => proxy(req, reply, MESSAGING_URL, '/v2/templates', null))
  v1.put<{ Params: { id: string } }>('/templates/:id', write, (req, reply) => proxy(req, reply, MESSAGING_URL, `/v2/templates/${req.params.id}`, null))
  v1.post<{ Params: { id: string } }>('/templates/:id/publish', write, (req, reply) => proxy(req, reply, MESSAGING_URL, `/v2/templates/${req.params.id}/publish`, null))
  v1.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/templates/:id/submit-approval', write, (req, reply) => {
    req.body = { ...(req.body ?? {}), templateId: req.params.id }
    return proxy(req, reply, MESSAGING_URL, '/v2/templates/wa/submit-approval', null)
  })
  v1.post('/templates/sync-approval', write, (req, reply) => proxy(req, reply, MESSAGING_URL, '/v2/templates/wa/sync-approval', null))
  v1.delete<{ Params: { channel: string; slug: string } }>('/templates/:channel/:slug', write, (req, reply) =>
    proxy(req, reply, MESSAGING_URL, `/v2/templates/${req.params.channel}/${enc(req.params.slug)}`, null))
  v1.post<{ Params: { type: string } }>('/documents/:type', { preHandler: need('documents:render', 'documents') }, (req, reply) => proxy(req, reply, DOCUMENTS_URL, `/documents/${req.params.type}`, 'documents'))
  const docsRead = { preHandler: need('documents:read', 'documents') }
  v1.get('/documents', docsRead, (req, reply) => proxy(req, reply, DOCUMENTS_URL, '/documents' + qs(req), null))
  const docsRender = { preHandler: need('documents:render', 'documents') }
  const zipUrl = (req: FastifyRequest) => (j: any) => ({ ...j, zip_url: j.zip_url ? `${publicBase(req)}/v1${j.zip_url}` : undefined })
  v1.post('/documents/bulk', { ...docsRender, bodyLimit: 10_000_000 }, (req, reply) => proxy(req, reply, DOCUMENTS_URL, '/documents/bulk', null, zipUrl(req)))
  v1.get('/documents/bulk', docsRead, (req, reply) => proxy(req, reply, DOCUMENTS_URL, '/documents/bulk' + qs(req), null, b => ({ ...b, items: b.items.map(zipUrl(req)) })))
  v1.get<{ Params: { id: string } }>('/documents/bulk/:id', docsRead, (req, reply) => proxy(req, reply, DOCUMENTS_URL, `/documents/bulk/${enc(req.params.id)}`, null, zipUrl(req)))
  v1.get<{ Params: { id: string } }>('/documents/bulk/:id/items', docsRead, (req, reply) => proxy(req, reply, DOCUMENTS_URL, `/documents/bulk/${enc(req.params.id)}/items` + qs(req), null))
  v1.get<{ Params: { id: string } }>('/documents/bulk/:id/zip', docsRead, (req, reply) => proxy(req, reply, DOCUMENTS_URL, `/documents/bulk/${enc(req.params.id)}/zip`, null))
  v1.post<{ Params: { id: string } }>('/documents/bulk/:id/cancel', docsRender, (req, reply) => proxy(req, reply, DOCUMENTS_URL, `/documents/bulk/${enc(req.params.id)}/cancel`, null, zipUrl(req)))
  v1.post<{ Params: { id: string } }>('/documents/bulk/:id/retry', docsRender, (req, reply) => proxy(req, reply, DOCUMENTS_URL, `/documents/bulk/${enc(req.params.id)}/retry`, null, zipUrl(req)))
  v1.get('/documents/designs', docsRead, (req, reply) => proxy(req, reply, DOCUMENTS_URL, '/designs', null, b => ({
    ...b, designs: b.designs.map((d: any) => ({ ...d, thumbnail_url: `${publicBase(req)}/v1/documents${d.thumbnail_url}` })),
  })))
  v1.get<{ Params: { key: string; type: string } }>('/documents/designs/:key/preview/:type', docsRead, (req, reply) =>
    proxy(req, reply, DOCUMENTS_URL, `/designs/${encodeURIComponent(req.params.key)}/preview/${encodeURIComponent(req.params.type)}` + qs(req), null))
  v1.get<{ Params: { id: string } }>('/documents/:id', { preHandler: need('documents:read', 'documents') }, (req, reply) => proxy(req, reply, DOCUMENTS_URL, `/documents/${req.params.id}`, null))
  v1.get<{ Params: { id: string } }>('/documents/:id/pdf', { preHandler: need('documents:read', 'documents') }, (req, reply) => proxy(req, reply, DOCUMENTS_URL, `/documents/${req.params.id}/pdf`, null))
  v1.get('/wallet', { preHandler: async (req, reply) => { if (!req.key.scopes.includes('wallet:read')) return fail(reply, 403, 'forbidden', "This key lacks the 'wallet:read' scope") } }, async req => {
    const since = new Date()
    since.setHours(0, 0, 0, 0)
    const [balance, spent] = await Promise.all([wallet.getBalance(req.key.tenant_id), wallet.spendSince(req.key.tenant_id, since)])
    touchKey(req.key.id, null)
    return { balance_inr: balance, spent_today_inr: spent, currency: 'INR' }
  })
}, { prefix: '/v1' })

// Design thumbnails are the same for everyone, so they need no key (usable as plain <img> sources).
app.get<{ Params: { key: string } }>('/v1/documents/designs/:key/thumbnail.png', async (req, reply) => {
  const res = await undici(`${DOCUMENTS_URL}/designs/${encodeURIComponent(req.params.key)}/thumbnail.png`)
  if (res.statusCode !== 200) { await res.body.dump(); return fail(reply, 404, 'not_found', 'Unknown design') }
  return reply.header('content-type', 'image/png').header('cache-control', 'public, max-age=86400').send(Buffer.from(await res.body.arrayBuffer()))
})

// Public document viewer (token-only; no API key) — proxied to the document service.
app.get<{ Params: { token: string } }>('/d/:token/pdf', async (req, reply) => {
  const res = await undici(`${DOCUMENTS_URL}/view/${encodeURIComponent(req.params.token)}/pdf`)
  if (res.statusCode !== 200) { await res.body.dump(); return fail(reply, 404, 'not_found', 'Document not found') }
  for (const h of ['content-type', 'content-disposition']) if (res.headers[h]) reply.header(h, res.headers[h] as string)
  return reply.send(Buffer.from(await res.body.arrayBuffer()))
})
app.get<{ Params: { token: string } }>('/d/:token', async (req, reply) => {
  const res = await undici(`${DOCUMENTS_URL}/view/${encodeURIComponent(req.params.token)}`)
  reply.header('content-type', res.headers['content-type'] ?? 'text/html')
  return reply.code(res.statusCode).send(await res.body.text())
})

app.setNotFoundHandler((_req, reply) => fail(reply, 404, 'not_found', 'No such endpoint — see /docs'))
app.setErrorHandler((err: any, req, reply) => {
  if (err.statusCode === 429) return reply.code(429).send({ error: 'rate_limited', message: 'Too many requests; slow down' })
  if (err.validation) return fail(reply, 400, 'validation_error', err.message)
  req.log.error(err)
  return fail(reply, 502, 'upstream_error', 'A downstream service failed')
})

const port = Number(process.env.PORT || 3100)
await app.listen({ port, host: '0.0.0.0' })
