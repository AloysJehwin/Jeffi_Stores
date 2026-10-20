// Mobile backend (mobile.jeffistores.in): the one host the app talks to. Owns the mobile contract
// (/v1/app/*: version gate, store identity, feature flags — read from the shared DB) and forwards the
// storefront operations under /api/* to the controller in-cluster with the caller's own bearer token,
// so order creation, payments and auth keep one implementation. Endpoints move off the proxy one at a
// time as they get a native handler here.
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import Redis from 'ioredis'
import { request as undici } from 'undici'
import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { mainPool } from '@jeffi/tenancy'

const CONTROLLER_URL = (process.env.CONTROLLER_URL || 'http://localhost:3000').replace(/\/$/, '')
const PUBLIC_SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://jeffistores.in').replace(/\/$/, '')
const SITE_HOST = new URL(PUBLIC_SITE_URL).host
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null

let pool: pg.Pool | undefined
function db(): pg.Pool {
  if (pool) return pool
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  pool = mainPool(url, 5)
  return pool
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' }, genReqId: () => randomUUID(), trustProxy: true })

// Accept an empty JSON body (DELETE / body-less POST with Content-Type: application/json).
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  try { done(null, body ? JSON.parse(body as string) : {}) } catch (e: any) { e.statusCode = 400; done(e, undefined) }
})

const fail = (reply: FastifyReply, status: number, error: string, message: string) => reply.code(status).send({ error, message })

app.get('/healthz', async () => ({ ok: true, service: 'mobile' }))
app.get('/api/health', async () => ({ ok: true, service: 'mobile' }))

await app.register(rateLimit, {
  global: true,
  redis: redis ?? undefined,
  max: 240,
  timeWindow: '1 minute',
  addHeaders: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true, 'x-ratelimit-reset': true, 'retry-after': true },
})

// ── Native: what the app needs before it can do anything else ──
// Bump MIN_APP_VERSION to force an update; the app compares against its own version on launch.
const MIN_APP_VERSION = process.env.MIN_APP_VERSION || '1.0.0'
const SETTING_KEYS = ['business_name', 'business_logo_url', 'business_phone', 'business_email', 'feature_razorpay_enabled', 'feature_cod_enabled']
let configCache: { at: number; value: unknown } | null = null
app.get('/v1/app/config', async (_req, reply) => {
  if (configCache && Date.now() - configCache.at < 60_000) return reply.header('cache-control', 'public, max-age=60').send(configCache.value)
  const rows = (await db().query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key = ANY($1::text[])`, [SETTING_KEYS])).rows
  const m = new Map(rows.map(r => [r.key, r.value ?? '']))
  const bool = (k: string, def: boolean) => (m.get(k) ? m.get(k)!.toLowerCase() === 'true' : def)
  const value = {
    min_app_version: MIN_APP_VERSION,
    site_url: PUBLIC_SITE_URL,
    store: { name: m.get('business_name') || 'Jeffi Stores', logo_url: m.get('business_logo_url') || '', phone: m.get('business_phone') || '', email: m.get('business_email') || '' },
    features: { razorpay: bool('feature_razorpay_enabled', true), cod: bool('feature_cod_enabled', true) },
  }
  configCache = { at: Date.now(), value }
  return reply.header('cache-control', 'public, max-age=60').send(value)
})

// ── Forwarded: the storefront API, same paths the web uses ──
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate', 'host', 'content-length'])
async function forward(req: FastifyRequest, reply: FastifyReply) {
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) if (v && !HOP.has(k)) headers[k] = Array.isArray(v) ? v.join(', ') : v
  // The controller resolves the store from the host; present the public one so it behaves as for the web.
  headers.host = SITE_HOST
  headers['x-forwarded-host'] = SITE_HOST
  headers['x-forwarded-proto'] = 'https'
  headers['x-forwarded-for'] = req.ip
  headers['x-request-id'] = req.id
  headers['x-jeffi-client'] = 'mobile'
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  const res = await undici(CONTROLLER_URL + req.url, {
    method: req.method as any,
    headers,
    body: hasBody ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})) : undefined,
    headersTimeout: 30_000,
    bodyTimeout: 120_000,
  })
  for (const [k, v] of Object.entries(res.headers)) if (v && !HOP.has(k) && k !== 'set-cookie') reply.header(k, v as string)
  if (res.headers['set-cookie']) reply.header('set-cookie', res.headers['set-cookie'] as string[])
  return reply.code(res.statusCode).send(res.body)
}
app.all('/api/*', forward)
// Razorpay webhooks and other server-to-server hooks stay on the web host; the app never needs them.

app.setNotFoundHandler((_req, reply) => fail(reply, 404, 'not_found', 'No such endpoint'))
app.setErrorHandler((err: any, req, reply) => {
  if (err.statusCode === 429) return reply.code(429).send({ error: 'rate_limited', message: 'Too many requests; slow down' })
  if (err.statusCode && err.statusCode < 500) return fail(reply, err.statusCode, 'bad_request', err.message)
  req.log.error(err)
  return fail(reply, 502, 'upstream_error', 'The store is not reachable right now')
})

const port = Number(process.env.PORT || 3103)
await app.listen({ port, host: '0.0.0.0' })
