// Mobile backend (mobile.jeffistores.in): the one host the app talks to. Owns the mobile contract
// (/v1/app/*: version gate, store identity, feature flags — read from the shared DB) and forwards the
// storefront operations under /api/* to the controller in-cluster with the caller's own bearer token,
// so order creation, payments and auth keep one implementation. Endpoints move off the proxy one at a
// time as they get a native handler here.
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { Readable } from 'node:stream'
import rateLimit from '@fastify/rate-limit'
import Redis from 'ioredis'
import { request as undici } from 'undici'
import { randomUUID, timingSafeEqual } from 'node:crypto'
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

// Anything that isn't JSON (multipart uploads, form posts) is forwarded untouched as a stream.
app.addContentTypeParser('*', (_req, payload, done) => done(null, payload))

// Accept an empty JSON body (DELETE / body-less POST with Content-Type: application/json).
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  try { done(null, body ? JSON.parse(body as string) : {}) } catch (e: any) { e.statusCode = 400; done(e, undefined) }
})

const fail = (reply: FastifyReply, status: number, error: string, message: string) => reply.code(status).send({ error, message })

// Behind CloudFront the peer is an edge, so the user is in CloudFront-Viewer-Address ("ip:port"). Trusted only when
// the request carries the origin secret CloudFront adds; anything else (direct hits) keeps the socket address.
const EDGE_SECRET = Buffer.from(process.env.EDGE_ORIGIN_SECRET || '')
function fromEdge(req: FastifyRequest): boolean {
  const got = req.headers['x-jeffi-edge']
  if (!EDGE_SECRET.length || typeof got !== 'string') return false
  const b = Buffer.from(got)
  return b.length === EDGE_SECRET.length && timingSafeEqual(b, EDGE_SECRET)
}
function clientIp(req: FastifyRequest): string {
  const viewer = req.headers['cloudfront-viewer-address']
  if (typeof viewer === 'string' && fromEdge(req)) {
    const i = viewer.lastIndexOf(':')
    if (i > 0) return viewer.slice(0, i).replace(/^\[|\]$/g, '')
  }
  return req.ip
}

app.get('/healthz', async () => ({ ok: true, service: 'mobile' }))
app.get('/api/health', async () => ({ ok: true, service: 'mobile' }))

await app.register(rateLimit, {
  global: true,
  redis: redis ?? undefined,
  max: 240,
  timeWindow: '1 minute',
  keyGenerator: clientIp,
  addHeaders: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true, 'x-ratelimit-reset': true, 'retry-after': true },
})

// ── Native: what the app needs before it can do anything else ──
// Bump MIN_APP_VERSION to force an update; the app compares against its own version on launch.
const MIN_APP_VERSION = process.env.MIN_APP_VERSION || '1.0.0'
// The web host's /_next/image serves the app's resized images; APP_IMAGE_RESIZE=false sends it the originals.
const IMAGE_RESIZE = process.env.APP_IMAGE_RESIZE !== 'false'
// On only once the web host resizes a real gallery image: a release can roll this service out before the controller
// that allows the CDN host. Re-checked hourly when on, every 5 minutes while off.
let resizeProbe: { at: number; ok: boolean } | null = null
async function imageResizeReady(): Promise<boolean> {
  if (!IMAGE_RESIZE) return false
  if (resizeProbe && Date.now() - resizeProbe.at < (resizeProbe.ok ? 3_600_000 : 300_000)) return resizeProbe.ok
  let ok = false
  try {
    const row = (
      await db().query<{ url: string }>(
        `SELECT thumbnail_url AS url FROM gallery_images WHERE thumbnail_url LIKE 'https://%' ORDER BY created_at DESC LIMIT 1`,
      )
    ).rows[0]
    if (row) {
      const res = await undici(`${CONTROLLER_URL}/_next/image?url=${encodeURIComponent(row.url)}&w=64&q=70`, {
        headers: { host: SITE_HOST, accept: 'image/webp' },
        headersTimeout: 5000,
        bodyTimeout: 5000,
      })
      ok = res.statusCode === 200
      await res.body.dump()
    }
  } catch {
    ok = false
  }
  resizeProbe = { at: Date.now(), ok }
  return ok
}
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
    image_resize: await imageResizeReady(),
  }
  configCache = { at: Date.now(), value }
  return reply.header('cache-control', 'public, max-age=60').send(value)
})

// ── Forwarded: the storefront API, same paths the web uses ──
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate', 'host', 'content-length', 'x-jeffi-edge'])
async function forward(req: FastifyRequest, reply: FastifyReply) {
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) if (v && !HOP.has(k)) headers[k] = Array.isArray(v) ? v.join(', ') : v
  // The controller resolves the store from the host; present the public one so it behaves as for the web.
  headers.host = SITE_HOST
  headers['x-forwarded-host'] = SITE_HOST
  headers['x-forwarded-proto'] = 'https'
  headers['x-forwarded-for'] = clientIp(req)
  headers['x-request-id'] = req.id
  headers['x-jeffi-client'] = 'mobile'
  // Auth responses are rewritten below (token injection), so ask for them uncompressed.
  if (req.url.startsWith('/api/auth/')) delete headers['accept-encoding']
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  const res = await undici(CONTROLLER_URL + req.url, {
    method: req.method as any,
    headers,
    body: !hasBody
      ? undefined
      : req.body instanceof Readable
        ? req.body
        : typeof req.body === 'string'
          ? req.body
          : JSON.stringify(req.body ?? {}),
    headersTimeout: 30_000,
    bodyTimeout: 120_000,
  })
  const cookies = ([] as string[]).concat((res.headers['set-cookie'] as string | string[] | undefined) ?? [])
  // Sign-in responses carry the session only as a cookie; the app keeps it as a bearer token instead
  // (the controller accepts `Authorization: Bearer <sid>`), so copy it into the JSON body as `token`.
  const sid = cookies.map(c => /^user_sid=([^;]+)/.exec(c)?.[1]).find(v => v && v !== 'deleted')
  const json = String(res.headers['content-type'] ?? '').includes('application/json')
  for (const [k, v] of Object.entries(res.headers)) {
    if (v && !HOP.has(k) && k !== 'set-cookie' && !(sid && json && k === 'content-encoding')) reply.header(k, v as string)
  }
  if (cookies.length) reply.header('set-cookie', cookies)
  if (sid && json) {
    const body = await res.body.json().catch(() => null)
    if (body && typeof body === 'object' && !Array.isArray(body)) return reply.code(res.statusCode).send({ ...body, token: decodeURIComponent(sid) })
    return reply.code(res.statusCode).send(body)
  }
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
