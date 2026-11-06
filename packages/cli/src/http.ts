import dns from 'node:dns'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Agent, FormData, fetch, type Dispatcher } from 'undici'
import { FLAGSHIP, type Context } from './config'
import { CLI_VERSION, CliError } from './util'

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family: number) => void

/** `*.localhost` → 127.0.0.1 (not every resolver does it); everything else goes to dns.lookup. */
export function localhostLookup(hostname: string, options: dns.LookupOptions, cb: LookupCb) {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    if (options?.all) return cb(null, [{ address: '127.0.0.1', family: 4 }], 4)
    return cb(null, '127.0.0.1', 4)
  }
  dns.lookup(hostname, options, cb)
}

export function makeDispatcher(ctx: Pick<Context, 'cert' | 'certPassword'>, withCert: boolean): Dispatcher {
  const connect: Record<string, unknown> = { lookup: localhostLookup }
  if (withCert && ctx.cert) {
    try {
      connect.pfx = fs.readFileSync(ctx.cert)
    } catch (e) {
      throw new CliError(`Can't read the certificate ${ctx.cert}: ${(e as Error).message}`)
    }
    if (ctx.certPassword) connect.passphrase = ctx.certPassword
  }
  return new Agent({ connect })
}

export interface Target {
  url: string
  platform: boolean
}

/**
 * Where a path goes. Accepts /v1/admin/…, /v1/platform/…, /api/admin/…, /api/… (storefront admin
 * routes, admin host only) or a bare `products/123` (= /api/admin/products/123).
 * Gateway: /api/admin/ecom/… → /v1/platform/ecom/…, /api/admin/x → /v1/admin/x.
 * Direct: everything back to the app path on the store's admin host.
 */
export function resolveTarget(rawPath: string, ctx: Pick<Context, 'base' | 'adminBase' | 'direct'>): Target {
  if (/^https?:\/\//.test(rawPath)) throw new CliError('Pass a path, not a URL; set the host with --host or a profile')
  let p = rawPath.startsWith('/') ? rawPath : `/api/admin/${rawPath}`
  const qi = p.indexOf('?')
  const qs = qi >= 0 ? p.slice(qi) : ''
  if (qi >= 0) p = p.slice(0, qi)
  let platform = false
  let appPath: string
  if (p.startsWith('/v1/platform/')) {
    platform = true
    appPath = `/api/admin/${p.slice('/v1/platform/'.length)}`
  } else if (p.startsWith('/v1/admin/')) appPath = `/api/admin/${p.slice('/v1/admin/'.length)}`
  else if (p.startsWith('/v1/')) appPath = p
  else appPath = p
  if (appPath.startsWith('/api/admin/ecom/') || appPath === '/api/admin/ecom') platform = true
  if (ctx.direct) {
    if (appPath.startsWith('/v1/')) throw new CliError(`${appPath} is only served by the public API; drop --direct`)
    return { url: ctx.adminBase + appPath + qs, platform }
  }
  if (appPath.startsWith('/v1/')) return { url: ctx.base + appPath + qs, platform }
  if (!appPath.startsWith('/api/admin/')) throw new CliError(`${appPath} isn't served by the public API; run it with --direct (the store's admin host and its .p12)`)
  const rest = appPath.slice('/api/admin/'.length)
  return { url: `${ctx.base}/v1/${platform ? 'platform' : 'admin'}/${rest}${qs}`, platform }
}

export function assertPlatformAllowed(ctx: Pick<Context, 'profile'>) {
  if (ctx.profile.store !== FLAGSHIP) {
    const what = ctx.profile.store ? `store "${ctx.profile.store}"` : 'an unknown store'
    throw new CliError(`Platform commands need a flagship profile; this one is for ${what}. Use a profile with --store flagship.`, 2)
  }
}

export interface ApiRequest {
  method: string
  path: string
  query?: [string, string][]
  body?: unknown
  /** multipart/form-data parts, sent instead of a JSON body: text values or files read from disk. */
  multipart?: [string, string | { path: string }][]
  headers?: Record<string, string>
}

// Upload handlers check the part's type, so name the common ones.
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
  pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', json: 'application/json', xml: 'application/xml', zip: 'application/zip',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', mp4: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', p12: 'application/x-pkcs12', pem: 'application/x-pem-file',
}

function formOf(parts: [string, string | { path: string }][]): FormData {
  const form = new FormData()
  for (const [k, v] of parts) {
    if (typeof v === 'string') {
      form.append(k, v)
      continue
    }
    let buf: Buffer
    try {
      buf = fs.readFileSync(v.path)
    } catch (e) {
      throw new CliError(`Can't read ${v.path}: ${(e as Error).message}`)
    }
    const type = MIME[path.extname(v.path).slice(1).toLowerCase()] ?? 'application/octet-stream'
    form.append(k, new Blob([new Uint8Array(buf)], { type }), path.basename(v.path))
  }
  return form
}

export interface ApiResponse {
  status: number
  ok: boolean
  headers: Headers
  contentType: string
  data: unknown
  text: string
}

export interface HttpDeps {
  dispatcher?: Dispatcher
}

export function withQuery(url: string, query: [string, string][] = []): string {
  if (!query.length) return url
  const u = new URL(url)
  for (const [k, v] of query) u.searchParams.append(k, v)
  return u.toString()
}

export async function send(ctx: Context, req: ApiRequest, deps: HttpDeps = {}): Promise<ApiResponse> {
  const target = resolveTarget(req.path, ctx)
  if (target.platform) assertPlatformAllowed(ctx)
  if (!ctx.token && !(ctx.direct && ctx.cert)) throw new CliError('Not signed in. Run jeffi login, or add a service-account key with jeffi profiles add --service-account jsa_…', 2)
  const headers: Record<string, string> = { accept: 'application/json', 'x-jeffi-cli': CLI_VERSION, ...req.headers }
  if (ctx.token) headers.authorization = `Bearer ${ctx.token}`
  let body: string | FormData | undefined
  if (req.multipart && req.method !== 'GET' && req.method !== 'HEAD') body = formOf(req.multipart)
  else if (req.body !== undefined && req.method !== 'GET' && req.method !== 'HEAD') {
    body = JSON.stringify(req.body)
    headers['content-type'] = 'application/json'
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && !headers['idempotency-key']) headers['idempotency-key'] = crypto.randomUUID()
  const dispatcher = deps.dispatcher ?? makeDispatcher(ctx, ctx.direct)
  let res
  try {
    res = await fetch(withQuery(target.url, req.query), { method: req.method, headers, body, dispatcher })
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } }).cause
    throw new CliError(`Request to ${target.url} failed: ${cause?.code || cause?.message || (e as Error).message}`)
  }
  const contentType = res.headers.get('content-type') || ''
  const text = await res.text()
  let data: unknown = text
  if (/json/.test(contentType) && text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  return { status: res.status, ok: res.ok, headers: res.headers as unknown as Headers, contentType, data, text }
}

export function errorMessage(res: ApiResponse): string {
  const d = res.data as { error?: unknown; message?: unknown } | string
  const msg = typeof d === 'object' && d ? String(d.error ?? d.message ?? '') : String(d || '').slice(0, 300)
  const hint = res.status === 401 ? ' (sign in again with jeffi login)' : res.status === 403 ? ' (the credential lacks the scope, or the store/role is wrong)' : ''
  return `HTTP ${res.status}${msg ? `: ${msg}` : ''}${hint}`
}

/** send(), throwing on a non-2xx answer. */
export async function call(ctx: Context, req: ApiRequest, deps: HttpDeps = {}): Promise<ApiResponse> {
  const res = await send(ctx, req, deps)
  if (!res.ok) throw new CliError(errorMessage(res), res.status === 401 || res.status === 403 ? 3 : 1, res.data)
  return res
}
