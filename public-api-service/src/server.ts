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
async function proxy(req: FastifyRequest, reply: FastifyReply, base: string, path: string, kind: 'messages' | 'documents' | null) {
  const token = signServiceToken({ service: 'public-api', tenantId: req.key.tenant_id, tenantSlug: req.key.tenant_slug, apiKeyId: req.key.id }, 60)
  const res = await undici(base + path, {
    method: req.method as 'GET' | 'POST' | 'DELETE',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-request-id': req.id },
    body: req.method === 'POST' ? JSON.stringify(req.body ?? {}) : undefined,
  })
  const text = await res.body.text()
  let body: any = text
  try {
    body = JSON.parse(text)
  } catch {}
  const spend = res.statusCode === 200 && kind ? toPaise(Number(body?.charged_inr ?? body?.price_inr ?? 0)) : 0
  touchKey(req.key.id, res.statusCode === 200 ? kind : null, spend)
  await remember(req, res.statusCode, body)
  return reply.code(res.statusCode).send(body)
}

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
  v1.get('/messages', { preHandler: need('messages:send', 'messaging') }, (req, reply) => proxy(req, reply, MESSAGING_URL, '/messages' + qs(req), null))
  v1.get<{ Params: { id: string } }>('/messages/:id', { preHandler: need('messages:send', 'messaging') }, (req, reply) => proxy(req, reply, MESSAGING_URL, `/messages/${req.params.id}`, null))
  v1.get('/templates', { preHandler: need('templates:read', 'messaging') }, (req, reply) => proxy(req, reply, MESSAGING_URL, '/templates' + qs(req), null))
  v1.post('/templates', { preHandler: need('templates:write', 'messaging') }, (req, reply) => proxy(req, reply, MESSAGING_URL, '/templates', null))
  v1.delete<{ Params: { channel: string; slug: string } }>('/templates/:channel/:slug', { preHandler: need('templates:write', 'messaging') }, (req, reply) =>
    proxy(req, reply, MESSAGING_URL, `/templates/${req.params.channel}/${req.params.slug}`, null)
  )
  v1.post<{ Params: { type: string } }>('/documents/:type', { preHandler: need('documents:render', 'documents') }, (req, reply) => proxy(req, reply, DOCUMENTS_URL, `/documents/${req.params.type}`, 'documents'))
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

// Public document viewer (token-only; no API key) — proxied to the document service.
app.get<{ Params: { token: string } }>('/d/:token', async (req, reply) => {
  const res = await undici(`${DOCUMENTS_URL}/view/${req.params.token}`)
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
