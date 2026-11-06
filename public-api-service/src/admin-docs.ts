import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ROOT_DOMAIN } from '@jeffi/tenancy'
import type { PublicHost, StoreRef } from './admin-gateway.js'

// /openapi.json per public host, from the CLI's admin route manifest (packages/cli/manifest/admin-api.json):
//   public-{slug}: that store's /v1/admin routes its plan sells, nothing flagship-only (no messaging,
//                  documents, templates, media, wallet, pricing, designs, /d/:token, /v1/platform)
//   public.:       today's document plus the flagship's /v1/admin and /v1/platform sections

export interface ManifestRoute {
  host: 'admin' | 'platform' | 'storefront'
  method: string
  path: string
  gatewayPath: string | null
  pathParams: { name: string; catchAll: boolean; optional: boolean }[]
  query: string[]
  queryParams?: { name: string; required?: boolean; schema?: Record<string, unknown> }[] | null
  scope: string | null
  platform: 'admin' | 'owner' | null
  body: Record<string, unknown> | null
  bodyContentType?: string | null
  bodyAlternatives?: { contentType: string; schema: Record<string, unknown> }[] | null
  noBody?: boolean | null
  bodyUnknown?: boolean | null
  summary: string | null
  command: string
  hidden?: boolean
}

export interface Manifest {
  manifestHash: string
  routes: ManifestRoute[]
}

const MANIFEST_URL = new URL('../../packages/cli/manifest/admin-api.json', import.meta.url)
let manifestCache: { mtimeMs: number; m: Manifest | null } | null = null

/** The manifest, re-read when the file changes; null when it isn't there. */
export function loadManifest(file = fileURLToPath(MANIFEST_URL)): Manifest | null {
  let st: fs.Stats
  try {
    st = fs.statSync(file)
  } catch {
    return null
  }
  if (manifestCache && manifestCache.mtimeMs === st.mtimeMs) return manifestCache.m
  let m: Manifest | null = null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (raw && Array.isArray(raw.routes)) m = { manifestHash: String(raw.manifestHash ?? ''), routes: raw.routes }
  } catch {}
  manifestCache = { mtimeMs: st.mtimeMs, m }
  return m
}

// Sign-in, credential and session routes: no token reaches them through the gateway (principalDenied).
const NOT_FOR_TOKENS = /^\/v1\/admin\/(auth|mfa|token|sessions?|refresh|logout|check-session|access-request|certificates|account)(\/|$)|^\/v1\/admin\/cli\/(?!(whoami|logout)$)/

export function adminRoutesFor(m: Manifest, store: StoreRef): ManifestRoute[] {
  return m.routes.filter(r => {
    if (!r.gatewayPath || r.hidden || NOT_FOR_TOKENS.test(r.gatewayPath)) return false
    if (r.host === 'platform') return store.slug === null
    if (r.host !== 'admin') return false
    if (store.slug === null) return true
    // A store: nothing platform-administrator-only, and only what its plan sells.
    if (r.platform === 'admin') return false
    return !r.scope || !!store.planScopes?.has(r.scope)
  })
}

const opId = (r: ManifestRoute) => `${r.method.toLowerCase()}_${r.gatewayPath!.replace(/^\/v1\//, '').replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+/g, '_')}`

function tagOf(r: ManifestRoute): string {
  const rest = r.gatewayPath!.replace(/^\/v1\/(admin|platform)\//, '').replace(/^ecom\//, '')
  const seg = rest.split('/').find(s => s && !s.startsWith('{')) ?? 'misc'
  return `${r.host === 'platform' ? 'Platform' : 'Admin'} · ${seg}`
}

const schemaOf = (b: Record<string, unknown>) => (b.raw ? { type: 'object', additionalProperties: true } : b)

// JSON by default, multipart where the route reads a form; alternatives add content types to one body.
function requestBody(r: ManifestRoute) {
  if (r.noBody || r.method === 'GET' || r.method === 'HEAD') return {}
  if (r.bodyUnknown && !r.body) {
    return { requestBody: { description: 'The shape of this body is not documented yet.', content: { 'application/json': { schema: {} } } } }
  }
  if (!r.body) return {}
  const content: Record<string, { schema: unknown }> = { [r.bodyContentType || 'application/json']: { schema: schemaOf(r.body) } }
  for (const alt of r.bodyAlternatives ?? []) if (alt?.contentType && !content[alt.contentType]) content[alt.contentType] = { schema: schemaOf(alt.schema ?? {}) }
  return { requestBody: { content } }
}

function operation(r: ManifestRoute) {
  const query = r.queryParams?.length
    ? r.queryParams.map(q => ({ name: q.name, in: 'query', required: !!q.required, schema: q.schema ?? { type: 'string' } }))
    : r.query.map(q => ({ name: q, in: 'query', required: false, schema: { type: 'string' } }))
  const params = [
    ...r.pathParams.map(p => ({ name: p.name, in: 'path', required: true, schema: { type: 'string' }, ...(p.catchAll ? { description: 'Rest of the path; may contain /' } : {}) })),
    ...query,
  ]
  const body = requestBody(r)
  const notes = [r.scope ? `Scope: \`${r.scope}\`.` : null, r.host === 'platform' ? 'Platform administrators only.' : null, `CLI: \`jeffi ${r.command}\``].filter(Boolean)
  return {
    operationId: opId(r),
    tags: [tagOf(r)],
    summary: r.summary?.split(/(?<=\.)\s/)[0]?.slice(0, 120) || `${r.method} ${r.gatewayPath}`,
    description: [r.summary, notes.join(' ')].filter(Boolean).join('\n\n'),
    security: [{ AdminToken: [] }],
    ...(params.length ? { parameters: params } : {}),
    ...body,
    ...(r.scope ? { 'x-scope': r.scope } : {}),
    responses: {
      200: { description: 'OK' },
      401: { description: 'Missing, unknown, expired or revoked token' },
      403: { description: "The token lacks the scope, or belongs to another store" },
    },
  }
}

export function adminPaths(routes: ManifestRoute[]): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const r of routes) {
    const p = (paths[r.gatewayPath!] ??= {})
    const m = r.method.toLowerCase()
    if (!p[m]) p[m] = operation(r)
  }
  return paths
}

const ADMIN_TOKEN = {
  type: 'http',
  scheme: 'bearer',
  description: 'A service-account key (`jsa_…`, shown once when the account is created) or a person\'s token (`jfc_…`, from `jeffi login`).',
}

export function publicOrigin(ph: PublicHost, store: StoreRef): string {
  const local = ph.host.split(':')[0].endsWith('localhost')
  const port = local && ph.host.includes(':') ? `:${ph.host.split(':')[1]}` : ''
  const root = local ? 'localhost' : ROOT_DOMAIN
  return `${local ? 'http' : 'https'}://${store.slug ? `public-${store.slug}` : 'public'}.${root}${port}`
}

const ADMIN_NOTES = [
  '**Auth** — `Authorization: Bearer <token>`: a service-account key (`jsa_…`) or a CLI token (`jfc_…`, `jeffi login`). A token works only on its own store\'s host and never beyond its holder\'s current permissions.',
  '**Idempotency** — send `Idempotency-Key: <uuid>` on POSTs to make retries safe for 24 h.',
  '**Rate limits** — per token; see `X-RateLimit-*` headers.',
]

/** One store's own document. */
export function storeSpec(m: Manifest | null, ph: PublicHost, store: StoreRef) {
  const routes = m ? adminRoutesFor(m, store) : []
  return {
    openapi: '3.1.0',
    info: { title: `${store.name} Admin API`, version: '1.0.0', description: [`The admin API of ${store.name}.`, '', ...ADMIN_NOTES].join('\n'), ...(m ? { 'x-manifest-hash': m.manifestHash } : {}) },
    servers: [{ url: publicOrigin(ph, store), description: store.name }],
    components: { securitySchemes: { AdminToken: ADMIN_TOKEN } },
    paths: adminPaths(routes),
  }
}

/** Today's flagship document plus its /v1/admin and /v1/platform routes. */
export function flagshipSpec(base: any, m: Manifest | null, store: StoreRef) {
  const doc = structuredClone(base)
  if (!m) return doc
  doc.paths = { ...(doc.paths ?? {}), ...adminPaths(adminRoutesFor(m, store)) }
  doc.components = { ...(doc.components ?? {}), securitySchemes: { ...(doc.components?.securitySchemes ?? {}), AdminToken: ADMIN_TOKEN } }
  doc.info = {
    ...doc.info,
    description: `${doc.info?.description ?? ''}\n\n**Store admin & platform** — \`/v1/admin/*\` is the flagship store's admin API, \`/v1/platform/*\` the platform's (administrators only). Every store has its own host, \`public-{slug}.${ROOT_DOMAIN}\`.\n${ADMIN_NOTES.join('\n')}`,
    'x-manifest-hash': m.manifestHash,
  }
  return doc
}

const specCache = new Map<string, { doc: unknown; at: number }>()
const SPEC_TTL_MS = 5 * 60_000

/** The document for a host, cached per store, plan and manifest for a few minutes. */
export function specFor(base: unknown, ph: PublicHost, store: StoreRef, m = loadManifest()) {
  const plan = store.planScopes ? [...store.planScopes].sort().join(',') : '*'
  const key = `${ph.kind}:${publicOrigin(ph, store)}:${store.tenantId}:${plan}:${m?.manifestHash ?? '-'}`
  const hit = specCache.get(key)
  if (hit && Date.now() - hit.at < SPEC_TTL_MS) return hit.doc
  const doc = store.slug === null ? flagshipSpec(base, m, store) : storeSpec(m, ph, store)
  if (specCache.size > 500) specCache.clear()
  specCache.set(key, { doc, at: Date.now() })
  return doc
}
