import { createHash } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'
import type { Dispatcher } from 'undici'
import { bearer, gatewayConfigured, GATEWAY_HEADER, signGatewayToken } from '@jeffi/service-auth'
import { PLATFORM_TENANT_ID, ROOT_DOMAIN } from '@jeffi/tenancy'

// The admin API on the public hosts:
//   public-{slug}.<root>/v1/admin/<path>  → that store's admin-service /api/admin/<path>
//   public.<root>/v1/admin/<path>         → the flagship store's admin-service
//   public.<root>/v1/platform/<path>      → the controller's /api/admin/<path> (ecom), platform administrators only
// The bearer is a jfc_/jsa_ token from admin_api_tokens (control plane). The store authorises it again
// from the holder's current grant, reading the signed gateway header this attaches.

export interface AdminTokenRow {
  id: string
  tenantId: string
  kind: 'cli' | 'extension' | 'service_account'
  adminId: string | null
  serviceAccountId: string | null
  adminRole: string | null
  scopes: string[]
}

export type PublicHost = { kind: 'flagship'; host: string } | { kind: 'store'; host: string; slug: string } | { kind: 'other'; host: string }

export interface StoreRef {
  tenantId: string
  slug: string | null // null: the flagship
  name: string
  planScopes: Set<string> | null // null: never plan-limited (the flagship)
}

declare module 'fastify' {
  interface FastifyRequest {
    adminToken?: AdminTokenRow
    adminStore?: StoreRef
  }
}

export const inCluster = () => !!process.env.KUBERNETES_SERVICE_HOST
const LOCAL_DIRECT = /^(localhost|127\.0\.0\.1)(:\d+)?$/

/** The host the client addressed. Off-cluster, the dev rewrite arrives as localhost:3100 with the host forwarded. */
export function requestHost(headers: Record<string, string | string[] | undefined>): string {
  const one = (v: string | string[] | undefined) => String(Array.isArray(v) ? v[0] : (v ?? '')).split(',')[0].trim().toLowerCase()
  const direct = one(headers.host)
  const fwd = one(headers['x-forwarded-host'])
  return !inCluster() && LOCAL_DIRECT.test(direct) && fwd ? fwd : direct
}

export function classifyHost(host: string): PublicHost {
  const bare = host.split(':')[0]
  const root = bare === 'localhost' || bare.endsWith('.localhost') ? 'localhost' : ROOT_DOMAIN
  if (bare === `public.${root}`) return { kind: 'flagship', host }
  const m = bare.match(/^public-([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.(.+)$/)
  if (m && m[2] === root) return { kind: 'store', host, slug: m[1] }
  // A local call straight to :3100 is the flagship's, as before.
  if (!inCluster() && LOCAL_DIRECT.test(host)) return { kind: 'flagship', host }
  return { kind: 'other', host }
}

const devPort = () => process.env.DEV_PUBLIC_PORT || '3000'

/** The store's admin host: the upstream's Host and x-forwarded-host, and the gateway header's `host`. */
export function adminHostFor(store: StoreRef, ph: PublicHost): string {
  const local = ph.host.split(':')[0].endsWith('localhost')
  const root = local ? 'localhost' : ROOT_DOMAIN
  const host = store.slug ? `admin-${store.slug}.${root}` : `admin.${root}`
  return local ? `${host}:${devPort()}` : host
}

/** Where the store's (or the controller's) /api/admin lives; a second candidate for stores on the old all-in-one app. */
export function upstreamsFor(store: StoreRef, platform: boolean): string[] {
  if (!inCluster()) return [(process.env.ADMIN_GATEWAY_LOCAL_URL || `http://localhost:${devPort()}`).replace(/\/$/, '')]
  if (platform) return [(process.env.PLATFORM_CONTROLLER_URL || 'http://jeffi-stores-controller-service.jeffi.svc.cluster.local:3000').replace(/\/$/, '')]
  if (!store.slug) return [(process.env.PLATFORM_ADMIN_URL || 'http://jeffi-stores-admin-service.jeffi.svc.cluster.local:3000').replace(/\/$/, '')]
  const tpl = process.env.TENANT_ADMIN_URL_TEMPLATE || 'http://{slug}-admin-service.tenant-{slug}.svc.cluster.local:3000'
  const url = tpl.replaceAll('{slug}', store.slug).replace(/\/$/, '')
  const legacy = url.replace(`${store.slug}-admin-service.`, `${store.slug}-controller-service.`)
  return legacy === url ? [url] : [url, legacy]
}

const TOKEN_RE = /^(jfc|jsa)_[A-Za-z0-9_-]{32,64}$/
export const tokenHash = (plain: string) => createHash('sha256').update(plain).digest('hex')

/** The rest of /v1/{admin,platform}/… as a safe /api/admin sub-path, or null. Raw encoding is kept. */
export function safeSubPath(raw: string): string | null {
  if (!raw || raw.length > 2048 || /%2f|%5c|\\/i.test(raw)) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  const segs = decoded.split('/')
  if (segs.some(s => s === '' || s === '.' || s === '..') || [...decoded].some(c => c.charCodeAt(0) < 0x20)) return null
  return raw
}

export interface GatewayDeps {
  lookupToken(plain: string): Promise<AdminTokenRow | null>
  resolveStore(ph: PublicHost): Promise<StoreRef | null>
  send(url: string, opts: { method: Dispatcher.HttpMethod; headers: Record<string, string>; body?: Buffer }): Promise<Dispatcher.ResponseData>
  /** claim: set only if absent (NX) for ttl seconds; true when this call set it. */
  idem?: { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<unknown>; claim(k: string, v: string, ttlSeconds: number): Promise<boolean>; del(k: string): Promise<unknown> } | null
  rateLimit?: preHandlerHookHandler
}

const fail = (reply: FastifyReply, status: number, error: string, message: string) => reply.code(status).send({ error, message })
const PASS_RESPONSE = ['content-type', 'content-disposition', 'cache-control', 'location', 'retry-after', 'x-trace-id']
const PASS_REQUEST = ['accept', 'accept-language', 'x-jeffi-cli', 'x-request-id']
const isConnectError = (e: unknown) => ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes((e as { code?: string })?.code ?? '')

// An Idempotency-Key is held for this long while its request runs; a duplicate meanwhile gets 409.
const IDEM_IN_FLIGHT_S = 300
const IDEM_MAX_CACHED = 1024 * 1024
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex')

const DEVICE_PATHS = new Set(['/v1/admin/cli-auth/start', '/v1/admin/cli-auth/poll'])

export function registerAdminGateway(app: FastifyInstance, deps: GatewayDeps) {
  // `jeffi login` from anywhere: the device flow's two unauthenticated calls, passed to the store's admin
  // (whose admin host may demand a client certificate the CLI doesn't have). Rate-limited per IP.
  app.register(async dev => {
    if (deps.rateLimit) dev.addHook('preHandler', deps.rateLimit)
    // RFC 8628 clients post form bodies; the store's routes read JSON.
    dev.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 16 * 1024 }, (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))))
    })
    const device = async (req: FastifyRequest, reply: FastifyReply) => {
      const ph = classifyHost(requestHost(req.headers))
      if (ph.kind === 'other') return fail(reply, 404, 'not_found', 'No such endpoint — see /docs')
      const store = await deps.resolveStore(ph)
      if (!store) return fail(reply, 404, 'not_found', 'No such store')
      const adminHost = adminHostFor(store, ph)
      const path = req.url.split('?')[0]
      if (!DEVICE_PATHS.has(path)) return fail(reply, 404, 'not_found', 'No such endpoint — see /docs')
      const headers: Record<string, string> = {
        host: adminHost,
        'x-forwarded-host': adminHost,
        'x-forwarded-proto': inCluster() || !ph.host.split(':')[0].endsWith('localhost') ? 'https' : 'http',
        'x-forwarded-for': req.ip,
        'content-type': 'application/json',
        'user-agent': `${String(req.headers['user-agent'] ?? '').slice(0, 300)} jeffi-public-api`.trim(),
      }
      for (const h of PASS_REQUEST) if (typeof req.headers[h] === 'string') headers[h] = req.headers[h] as string
      let res: Dispatcher.ResponseData | null = null
      for (const base of upstreamsFor(store, false)) {
        try {
          res = await deps.send(`${base}/api/admin/${path.slice('/v1/admin/'.length)}`, { method: 'POST', headers, body: Buffer.from(JSON.stringify(req.body ?? {})) })
          break
        } catch (e) {
          if (!isConnectError(e)) throw e
        }
      }
      if (!res) return fail(reply, 502, 'upstream_unreachable', "The store's admin service did not answer")
      reply.header('content-type', String(res.headers['content-type'] ?? 'application/json'))
      reply.header('cache-control', 'no-store')
      return reply.code(res.statusCode).send(res.body)
    }
    for (const p of DEVICE_PATHS) dev.post(p, { bodyLimit: 16 * 1024 }, device)
  })

  app.register(async gw => {
    // Bodies pass through untouched, whatever their type (JSON, multipart uploads, CSV).
    gw.removeAllContentTypeParsers()
    gw.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 25 * 1024 * 1024 }, (_req, body, done) => done(null, body))

    const authAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
      const platform = req.url.startsWith('/v1/platform/')
      const ph = classifyHost(requestHost(req.headers))
      if (ph.kind === 'other') return fail(reply, 404, 'not_found', 'No such endpoint — see /docs')
      if (platform && ph.kind !== 'flagship') return fail(reply, 404, 'not_found', `The platform API is served on public.${ROOT_DOMAIN}`)
      if (!gatewayConfigured()) return fail(reply, 503, 'gateway_not_configured', 'The admin API is not available on this host yet')
      const plain = bearer(req) ?? ''
      if (!TOKEN_RE.test(plain)) return fail(reply, 401, 'unauthorized', 'Pass a token as `Authorization: Bearer jsa_…` (service account) or `jfc_…` (jeffi login)')
      const token = await deps.lookupToken(plain)
      if (!token) return fail(reply, 401, 'unauthorized', 'Unknown, expired or revoked token')
      const store = await deps.resolveStore(ph)
      if (!store) return fail(reply, 404, 'not_found', 'No such store')
      if (token.tenantId !== store.tenantId) return fail(reply, 403, 'wrong_store', "This token belongs to another store; call that store's own public host")
      if (platform && (token.kind === 'service_account' || token.adminRole !== 'administrator' || !token.scopes.includes('*'))) {
        return fail(reply, 403, 'platform_forbidden', 'The platform API needs a full-scope token of a platform administrator')
      }
      req.adminToken = token
      req.adminStore = store
    }
    gw.addHook('preHandler', authAdmin)
    if (deps.rateLimit) gw.addHook('preHandler', deps.rateLimit)

    const handle = (platform: boolean) => async (req: FastifyRequest, reply: FastifyReply) => {
      const token = req.adminToken!
      const store = req.adminStore!
      const prefix = platform ? '/v1/platform/' : '/v1/admin/'
      const qi = req.url.indexOf('?')
      const rest = safeSubPath((qi === -1 ? req.url : req.url.slice(0, qi)).slice(prefix.length))
      if (!rest) return fail(reply, 400, 'bad_path', 'Invalid path')
      const ecom = rest === 'ecom' || rest.startsWith('ecom/')
      if (platform !== ecom) return fail(reply, 404, 'not_found', platform ? 'Platform routes live under /v1/platform/ecom/…' : `Ecom routes are platform routes: /v1/platform/${rest} on public.${ROOT_DOMAIN}`)

      // One Idempotency-Key per token: the same key on another method, path, query or body is a client bug (422);
      // a duplicate while the first still runs gets 409; afterwards the first response is replayed.
      const idemHeader = req.headers['idempotency-key']
      const idem = deps.idem && req.method === 'POST' && typeof idemHeader === 'string' && idemHeader ? deps.idem : null
      let idemKey: string | null = null
      let fp = ''
      if (idem) {
        idemKey = `idem:adm:${token.id}:${sha(idemHeader as string)}`
        fp = sha(`${req.method}\n${req.url}\n${sha(Buffer.isBuffer(req.body) ? req.body : '')}`)
        const claimed = await idem.claim(idemKey, JSON.stringify({ fp, pending: true }), IDEM_IN_FLIGHT_S).catch(() => null)
        if (claimed === null) idemKey = null
        else if (!claimed) {
          let rec: { fp?: string; pending?: boolean; status?: number; body?: unknown; contentType?: string } | null = null
          try {
            rec = JSON.parse((await idem.get(idemKey)) ?? 'null')
          } catch {}
          if (rec && rec.fp !== fp) return fail(reply, 422, 'idempotency_key_reused', 'This Idempotency-Key was used for a different request')
          if (!rec || rec.pending) return fail(reply, 409, 'idempotency_in_progress', 'A request with this Idempotency-Key is still running')
          reply.header('idempotent-replayed', 'true')
          if (rec.contentType) reply.header('content-type', rec.contentType)
          return reply.code(rec.status ?? 200).send(rec.body)
        }
      }
      const release = async () => {
        if (idemKey) await Promise.resolve(idem!.del(idemKey)).catch(() => {})
      }
      try {
        return await forward(req, reply, { token, store, platform, rest, qi, idemKey, fp, release })
      } catch (e) {
        await release()
        throw e
      }
    }

    const forward = async (
      req: FastifyRequest,
      reply: FastifyReply,
      x: { token: AdminTokenRow; store: StoreRef; platform: boolean; rest: string; qi: number; idemKey: string | null; fp: string; release: () => Promise<void> }
    ) => {
      const { token, store, platform, rest, qi, idemKey, fp, release } = x

      const ph = classifyHost(requestHost(req.headers))
      const adminHost = adminHostFor(store, ph)
      const headers: Record<string, string> = {
        host: adminHost,
        'x-forwarded-host': adminHost,
        'x-forwarded-proto': inCluster() ? 'https' : 'http',
        'x-forwarded-for': req.ip,
        'user-agent': `${String(req.headers['user-agent'] ?? '').slice(0, 300)} jeffi-public-api`.trim(),
        [GATEWAY_HEADER]: signGatewayToken({
          tenantId: token.tenantId,
          kind: token.kind,
          ...(token.kind === 'service_account' ? { serviceAccountId: token.serviceAccountId! } : { adminId: token.adminId! }),
          scopes: token.scopes,
          tokenId: token.id,
          host: adminHost,
          ...(platform ? { platform: true } : {}),
        }),
      }
      for (const h of PASS_REQUEST) if (typeof req.headers[h] === 'string') headers[h] = req.headers[h] as string
      if (!headers['x-request-id']) headers['x-request-id'] = req.id
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && Buffer.isBuffer(req.body) && req.body.length > 0
      if (hasBody && typeof req.headers['content-type'] === 'string') headers['content-type'] = req.headers['content-type']

      let res: Dispatcher.ResponseData | null = null
      for (const base of upstreamsFor(store, platform)) {
        try {
          res = await deps.send(`${base}/api/admin/${rest}${qi === -1 ? '' : req.url.slice(qi)}`, {
            method: req.method as Dispatcher.HttpMethod,
            headers,
            body: hasBody ? (req.body as Buffer) : undefined,
          })
          break
        } catch (e) {
          if (!isConnectError(e)) throw e
        }
      }
      if (!res) {
        await release()
        return fail(reply, 502, 'upstream_unreachable', "The store's admin service did not answer")
      }

      for (const h of PASS_RESPONSE) {
        const v = res.headers[h]
        if (v != null) reply.header(h, Array.isArray(v) ? v.join(', ') : String(v))
      }
      const ctype = String(res.headers['content-type'] ?? '')
      if (!idemKey) return reply.code(res.statusCode).send(res.body)
      if (!/json|^text\//.test(ctype)) {
        await release()
        return reply.code(res.statusCode).send(res.body)
      }
      const text = await res.body.text()
      let body: unknown = text
      if (ctype.includes('json')) {
        try {
          body = JSON.parse(text)
        } catch {}
      }
      if (res.statusCode < 500 && text.length <= IDEM_MAX_CACHED) await deps.idem!.set(idemKey, JSON.stringify({ fp, status: res.statusCode, body, contentType: ctype })).catch(() => {})
      else await release()
      return reply.code(res.statusCode).send(body)
    }

    gw.all('/v1/admin/*', handle(false))
    gw.all('/v1/platform/*', handle(true))
  })
}

// ── Control-plane lookups (public-api-service can't open store DBs) ──

type Query = (sql: string, params: unknown[]) => Promise<{ rows: any[] }>

const tokenCache = new Map<string, { row: AdminTokenRow | null; at: number }>()
const TOKEN_TTL_MS = 5_000

// public-api can't import store-core: keep these liveness conditions identical to resolveApiToken
// (packages/store-core/src/lib/auth/api-tokens.ts). The store re-checks the token id anyway (isApiTokenLive).
export function tokenLookup(q: Query) {
  return async (plain: string): Promise<AdminTokenRow | null> => {
    if (!TOKEN_RE.test(plain)) return null
    const h = tokenHash(plain)
    const hit = tokenCache.get(h)
    if (hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.row
    const r = await q(
      `SELECT id, tenant_id, kind, admin_id, service_account_id, admin_role, scopes FROM admin_api_tokens
        WHERE token_hash = $1 AND status = 'active' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
      [h]
    )
    const x = r.rows[0]
    const row: AdminTokenRow | null =
      x && (x.kind === 'service_account') === plain.startsWith('jsa_')
        ? { id: x.id, tenantId: x.tenant_id, kind: x.kind, adminId: x.admin_id, serviceAccountId: x.service_account_id, adminRole: x.admin_role, scopes: Array.isArray(x.scopes) ? x.scopes : [] }
        : null
    if (tokenCache.size > 5000) tokenCache.clear()
    tokenCache.set(h, { row, at: Date.now() })
    if (row) {
      void q(`UPDATE admin_api_tokens SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`, [row.id]).catch(() => {})
    }
    return row
  }
}

const storeCache = new Map<string, { ref: StoreRef | null; at: number }>()
const STORE_TTL_MS = 60_000

export function storeLookup(q: Query) {
  return async (ph: PublicHost): Promise<StoreRef | null> => {
    if (ph.kind === 'flagship') return { tenantId: PLATFORM_TENANT_ID, slug: null, name: 'Jeffi Stores', planScopes: null }
    if (ph.kind !== 'store') return null
    const hit = storeCache.get(ph.slug)
    if (hit && Date.now() - hit.at < STORE_TTL_MS) return hit.ref
    const r = await q(
      `SELECT t.id, t.slug, t.display_name, t.status, t.instance_state, t.service_types,
              COALESCE(array_agg(pf.scope_key) FILTER (WHERE pf.scope_key IS NOT NULL), '{}') AS scopes
         FROM tenants t LEFT JOIN plan_features pf ON pf.plan_id = t.plan_id
        WHERE t.slug = $1 GROUP BY t.id`,
      [ph.slug]
    )
    const x = r.rows[0]
    // Only a live store has an admin to forward to.
    const live = x && x.status === 'active' && !['paused', 'migrating'].includes(x.instance_state) && (x.service_types ?? ['store']).includes('store')
    const ref: StoreRef | null = live ? { tenantId: x.id, slug: x.slug, name: x.display_name || x.slug, planScopes: new Set<string>(x.scopes ?? []) } : null
    storeCache.set(ph.slug, { ref, at: Date.now() })
    return ref
  }
}
