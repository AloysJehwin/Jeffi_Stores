// Builds packages/cli/manifest/admin-api.json from the admin route handlers (TypeScript compiler API).
//   npx tsx scripts/gen-admin-manifest.ts           write the manifest
//   npx tsx scripts/gen-admin-manifest.ts --check   fail when the committed manifest is stale
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'
import { ALL_SCOPE_KEYS, getScopeForPath } from '../packages/store-core/src/lib/auth/scopes'
import { assignCommandNames, type HostClass, type NamingRoute } from '../packages/cli/src/naming'
import type { JsonSchema, Manifest, ManifestRoute, Overrides, QueryParam } from '../packages/cli/src/manifest-types'
import { type Mod, ROOT, findExport, literalValue, loadMod, resolveSpec, unwrap } from './admin-manifest/modules'
import { conv, looksZod } from './admin-manifest/zod'
import { emitShape, hasContent, inferRequest } from './admin-manifest/infer'
import { generatedSummary } from './admin-manifest/summary'
import { declarationSchema } from './admin-manifest/types'

const MANIFEST_PATH = path.join(ROOT, 'packages/cli/manifest/admin-api.json')
const OVERRIDES_PATH = path.join(ROOT, 'packages/cli/manifest/overrides.json')
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

interface Source {
  host: HostClass
  dir: string
  prefix: string
  /** Only methods that authenticate an admin are included (storefront serves customers too). */
  adminOnly: boolean
}

const SOURCES: Source[] = [
  { host: 'admin', dir: 'admin-service/src/app/api/(admin)/admin', prefix: '/api/admin', adminOnly: false },
  { host: 'platform', dir: 'controller-service/src/app/api/(admin)/admin', prefix: '/api/admin', adminOnly: false },
  { host: 'storefront', dir: 'storefront-service/src/app/api', prefix: '/api', adminOnly: true },
]

// Browser redirects, provider callbacks and the device-login handshake are not admin API calls.
const EXCLUDE: RegExp[] = [/(^|\/)callback(\/|$)/, /(^|\/)webhooks?(\/|$)/, /^cli-auth(\/|$)/, /^cli\/approve(\/|$)/, /^delhivery\/sync-statuses$/]

const AUTH_CALLS = new Set(['authenticateAdmin', 'requireAdminScope', 'authenticateServiceAccount', 'ecomOverviewGet', 'proxyAdminDocs', 'proxyAdminMessaging', 'requireStaff'])
const ADMIN_AUTH_CALLS = new Set(['authenticateAdmin', 'requireAdminScope', 'authenticateServiceAccount', 'ecomOverviewGet'])
const CRON_CALLS = new Set(['verifyCronRequest', 'verifyCronSecret'])
const SCOPE_KEYS = new Set(ALL_SCOPE_KEYS)

// ── Handler analysis ─────────────────────────────────────────────────────────────────────────

interface Found {
  auth: boolean
  adminAuth: boolean
  cron: boolean
  platform: 'admin' | 'owner' | null
  scopes: string[]
  bodies: { expr: ts.Expression; mod: Mod; strong: boolean }[]
  query: Set<string>
  imported: { mod: Mod; name: string }[]
}

function setPlatform(f: { platform: 'admin' | 'owner' | null }, kind: 'admin' | 'owner') {
  if (f.platform !== 'admin') f.platform = kind
}

function calleeName(c: ts.CallExpression): string | null {
  const e = unwrap(c.expression)
  if (ts.isIdentifier(e)) return e.text
  if (ts.isPropertyAccessExpression(e)) return e.name.text
  return null
}

function scopeLiteral(arg: ts.Expression, mod: Mod): string | null {
  const v = literalValue(arg, mod)
  return typeof v === 'string' && SCOPE_KEYS.has(v) ? v : null
}

function analyse(start: ts.Node, mod: Mod): Found {
  const f: Found = { auth: false, adminAuth: false, cron: false, platform: null, scopes: [], bodies: [], query: new Set(), imported: [] }
  const seen = new Set<ts.Node>()
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) {
      const parent = n.parent
      const isPropName = parent && ts.isPropertyAccessExpression(parent) && parent.name === n
      if (!isPropName) {
        const local = mod.locals.get(n.text)
        if (local && !seen.has(local)) {
          seen.add(local)
          visit(local)
        }
        const imp = mod.imports.get(n.text)
        if (imp && imp.name !== '*') f.imported.push({ mod, name: n.text })
      }
    }
    if (ts.isCallExpression(n)) {
      const name = calleeName(n)
      if (name && AUTH_CALLS.has(name)) f.auth = true
      if (name && ADMIN_AUTH_CALLS.has(name)) f.adminAuth = true
      if (name && CRON_CALLS.has(name)) f.cron = true
      if (name === 'ecomOverviewGet' || name === 'isPlatformAdmin') setPlatform(f, 'admin')
      if (name === 'isPlatformOwner') setPlatform(f, 'owner')
      for (const a of n.arguments) {
        const s = scopeLiteral(a, mod)
        if (s && !f.scopes.includes(s)) f.scopes.push(s)
      }
      if (name === 'parseBody' && n.arguments[0]) f.bodies.push({ expr: n.arguments[0], mod, strong: true })
      const callee = unwrap(n.expression)
      if (ts.isPropertyAccessExpression(callee)) {
        const m = callee.name.text
        const recv = unwrap(callee.expression)
        if (['safeParse', 'parse', 'safeParseAsync', 'parseAsync'].includes(m) && !/^(JSON|Date|Number|URL|path)$/.test(recv.getText(mod.sf)) && looksZod(recv, mod)) {
          f.bodies.push({ expr: recv, mod, strong: false })
        }
        if (['get', 'getAll', 'has'].includes(m) && n.arguments.length === 1) {
          const k = n.arguments[0]
          const rt = recv.getText(mod.sf)
          const isSp = /searchParams$/.test(rt) || (ts.isIdentifier(recv) && mod.spNames.has(recv.text))
          if (isSp && !/headers|cookies/i.test(rt) && (ts.isStringLiteral(k) || ts.isNoSubstitutionTemplateLiteral(k))) f.query.add(k.text)
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(start)
  return f
}

// Guards found in imported helpers (draft-route factories, wrappers), a few modules deep.
const delegatedCache = new Map<string, { auth: boolean; cron: boolean; platform: 'admin' | 'owner' | null }>()

function delegatedGuard(mod: Mod, name: string, depth: number): { auth: boolean; cron: boolean; platform: 'admin' | 'owner' | null } {
  const none = { auth: false, cron: false, platform: null }
  const imp = mod.imports.get(name)
  if (!imp || imp.name === '*' || depth > 3) return none
  const file = resolveSpec(imp.spec, mod.file)
  if (!file) return none
  const key = `${file}#${imp.name}`
  const cached = delegatedCache.get(key)
  if (cached) return cached
  delegatedCache.set(key, none)
  const m = loadMod(file)
  const hit = m && findExport(m, imp.name)
  if (!hit) return none
  const f = analyse(hit.node, hit.mod)
  const out = { auth: f.auth, cron: f.cron, platform: f.platform }
  if (!out.auth && !out.cron) {
    for (const i of f.imported) {
      const d = delegatedGuard(i.mod, i.name, depth + 1)
      if (d.auth || d.cron) {
        out.auth ||= d.auth
        out.cron ||= d.cron
        if (d.platform) setPlatform(out, d.platform)
        break
      }
    }
  }
  delegatedCache.set(key, out)
  return out
}

function handlerNode(mod: Mod, method: string): ts.Node | null {
  for (const st of mod.sf.statements) {
    const exported = ts.canHaveModifiers(st) && ts.getModifiers(st)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    if (!exported) continue
    if (ts.isFunctionDeclaration(st) && st.name?.text === method) return st
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === method && d.initializer) return st
    }
  }
  const alias = mod.exportAlias.get(method)
  if (alias) return mod.locals.get(alias) ?? null
  return mod.reexports.has(method) ? findExport(mod, method)?.node ?? null : null
}

function cleanComment(raw: string): string {
  return raw
    .replace(/^\/\*\*?|\*\/$/g, '')
    .split('\n')
    .map(l => l.replace(/^\s*(\/\/+|\*)\s?/, '').trim())
    .filter(l => l && !/^eslint-|^@ts-|^prettier-/.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function summaryOf(node: ts.Node, mod: Mod): string | null {
  const ranges = ts.getLeadingCommentRanges(mod.sf.text, node.getFullStart()) ?? []
  const text = cleanComment(ranges.map(r => mod.sf.text.slice(r.pos, r.end)).join('\n'))
  if (!text) return null
  if (text.length <= 240) return text
  const cut = text.slice(0, 240)
  const dot = cut.lastIndexOf('. ')
  return (dot > 60 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, '') + '…')
}

function pickScope(scopes: string[], method: string): string | null {
  if (!scopes.length) return null
  const want = method === 'GET' ? ':read' : ':write'
  return scopes.find(s => s.endsWith(want)) ?? scopes[0]
}

// ── Request description ──────────────────────────────────────────────────────────────────────

type BodyFields = Pick<ManifestRoute, 'body' | 'bodySource' | 'bodyContentType' | 'bodyAlternatives' | 'noBody' | 'bodyUnknown'>

/** A request body is never `null` itself. */
function rootSchema(s: JsonSchema): JsonSchema {
  if (Array.isArray(s.type)) {
    const t = (s.type as string[]).filter(x => x !== 'null')
    return { ...s, type: t.length === 1 ? t[0] : t }
  }
  return s
}

/** Body classification and typed query parameters for one handler. */
function describeRequest(node: ts.Node, mod: Mod, method: string, f: Found): { body: BodyFields; queryParams: QueryParam[] } {
  const info = inferRequest(node, mod, method)
  const qs = info.query
  const names = new Set([...f.query, ...qs.props.keys()])
  const queryParams: QueryParam[] = [...names].sort().map(name => {
    const c = qs.props.get(name)
    const schema = c ? emitShape(c, 'query') : { type: 'string' }
    return { name, ...(c && qs.required.has(name) && !c.optional ? { required: true } : {}), schema }
  })
  if (method === 'GET') return { body: { body: null }, queryParams }
  let body: BodyFields | null = null
  const form = info.form && hasContent(info.form) ? rootSchema(emitShape(info.form, 'form')) : null
  if (info.json && hasContent(info.json)) {
    body = { body: rootSchema(emitShape(info.json, 'json')), bodySource: info.json.zod ? 'zod' : 'inferred', bodyContentType: 'application/json' }
    if (form) body.bodyAlternatives = [{ contentType: 'multipart/form-data', schema: form }]
  } else if (form) {
    body = { body: form, bodySource: 'inferred', bodyContentType: 'multipart/form-data' }
  } else {
    // Zod parses the analysis above didn't tie to the request body (shared helpers, spreads).
    const b = f.bodies.find(x => x.strong) ?? f.bodies[0]
    const c = b && conv(b.expr, b.mod)
    if (c) body = { body: c.s, bodySource: 'zod', bodyContentType: 'application/json' }
  }
  if (body) return { body, queryParams }
  const reads = !!info.json || !!info.form || info.rawBody
  if (!reads && !info.unresolved.size) return { body: { body: null, noBody: true }, queryParams }
  const why = info.json || info.form
    ? 'the handler reads a body but no fields could be inferred'
    : info.rawBody
      ? 'the handler reads the raw body'
      : `the request is passed to ${[...info.unresolved].join(', ')}`
  return { body: { body: { raw: true, description: why }, bodyUnknown: true }, queryParams }
}

// ── Walk ─────────────────────────────────────────────────────────────────────────────────────

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : e.name === 'route.ts' ? [p] : []
  })
}

interface Draft extends Omit<ManifestRoute, 'command'> {
  segments: string[]
}

function collect(): Draft[] {
  const out: Draft[] = []
  for (const src of SOURCES) {
    const abs = path.join(ROOT, src.dir)
    for (const file of walk(abs).sort()) {
      const relDirs = path.relative(abs, path.dirname(file)).split(path.sep).filter(Boolean).filter(s => !/^\(.*\)$/.test(s))
      const pathParams: ManifestRoute['pathParams'] = []
      const segs = relDirs.map(s => {
        const m = /^\[(\[)?(\.\.\.)?([^\]]+)\]?\]$/.exec(s)
        if (!m) return s
        pathParams.push({ name: m[3], catchAll: !!m[2], optional: !!m[1] })
        return `{${m[2] ? '...' : ''}${m[3]}}`
      })
      const rest = segs.join('/')
      if (EXCLUDE.some(re => re.test(rest))) continue
      const mod = loadMod(file)
      if (!mod) continue
      const appPath = `${src.prefix}/${rest}`.replace(/\/$/, '')
      const urlPath = appPath.replace(/\{\.\.\.([^}]+)\}/g, '{$1}')
      for (const method of METHODS) {
        const node = handlerNode(mod, method)
        if (!node) continue
        const f = analyse(node, mod)
        if (src.adminOnly && !f.adminAuth) continue
        let guard: ManifestRoute['guard'] = f.auth ? 'auth' : f.cron ? 'cron' : 'none'
        if (guard === 'none') {
          for (const i of f.imported) {
            const d = delegatedGuard(i.mod, i.name, 0)
            if (d.auth || d.cron) {
              guard = d.auth ? 'delegated' : 'cron'
              if (d.platform) setPlatform(f, d.platform)
              break
            }
          }
        }
        const req = describeRequest(node, mod, method, f)
        const literal = pickScope(f.scopes, method)
        const byPath = getScopeForPath(appPath)
        const scope = literal ?? byPath
        const naming = src.host === 'platform' && segs[0] === 'ecom' ? segs.slice(1) : segs
        out.push({
          id: `${src.host} ${method} ${urlPath}`,
          host: src.host,
          method,
          path: urlPath,
          gatewayPath: src.host === 'storefront' ? null : `/v1/${src.host === 'platform' ? 'platform' : 'admin'}${urlPath.slice('/api/admin'.length)}`,
          file: path.relative(ROOT, file).split(path.sep).join('/'),
          pathParams,
          query: req.queryParams.map(q => q.name),
          queryParams: req.queryParams,
          scope,
          scopeSource: literal ? 'literal' : byPath ? 'path' : null,
          scopes: [...f.scopes].sort(),
          guard,
          platform: f.platform,
          ...req.body,
          summary: summaryOf(node, mod) ?? generatedSummary(method, naming, src.host),
          segments: naming,
        })
      }
    }
  }
  return out.sort((a, b) => a.host.localeCompare(b.host) || a.path.localeCompare(b.path) || METHODS.indexOf(a.method as never) - METHODS.indexOf(b.method as never))
}

// ── Output ───────────────────────────────────────────────────────────────────────────────────

/** `{ "$ref": "path/to/file.ts#Name" }` in an override body: that export's zod schema or TS type. `"x-partial": true` drops `required`. */
function resolveRefs(v: unknown, where: string): unknown {
  if (Array.isArray(v)) return v.map(x => resolveRefs(x, where))
  if (!v || typeof v !== 'object') return v
  const o = v as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(o)) if (k !== '$ref' && k !== 'x-partial') out[k] = resolveRefs(x, where)
  if (typeof o.$ref !== 'string') return out
  const [file, name] = o.$ref.split('#')
  const mod = loadMod(path.join(ROOT, file))
  const val = mod && findExport(mod, name)
  const typ = mod && findExport(mod, name, 'type')
  let s: JsonSchema | null = null
  if (val && ts.isVariableDeclaration(val.node) && val.node.initializer && looksZod(val.node.initializer, val.mod)) s = conv(val.node.initializer, val.mod)?.s ?? null
  if (!s && typ) s = declarationSchema(typ.node, typ.mod)
  if (!s) throw new Error(`overrides.json ${where}: can't resolve $ref ${o.$ref}`)
  s = structuredClone(s)
  if (o['x-partial']) delete s.required
  return { ...s, ...out }
}

function readOverrides(): Overrides {
  if (!fs.existsSync(OVERRIDES_PATH)) return { routes: {} }
  const raw = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8')) as Partial<Overrides>
  return { routes: raw.routes ?? {} }
}

const KEY_ORDER: (keyof ManifestRoute)[] = ['id', 'host', 'method', 'path', 'gatewayPath', 'file', 'pathParams', 'query', 'queryParams', 'scope', 'scopeSource', 'scopes', 'guard', 'platform', 'body', 'bodySource', 'bodyContentType', 'bodyAlternatives', 'noBody', 'bodyUnknown', 'summary', 'command', 'hidden']

function order(r: ManifestRoute): ManifestRoute {
  const out: Record<string, unknown> = {}
  for (const k of KEY_ORDER) if (r[k] !== undefined) out[k] = r[k]
  return out as unknown as ManifestRoute
}

export function buildManifest(): { manifest: Manifest; unguarded: ManifestRoute[] } {
  const drafts = collect()
  const overrides = readOverrides()
  const fixed: Record<string, string> = {}
  for (const [id, o] of Object.entries(overrides.routes)) if (o.command) fixed[id] = o.command
  const naming: NamingRoute[] = drafts.map(d => ({ key: d.id, host: d.host, method: d.method, segments: d.segments }))
  const names = assignCommandNames(naming, fixed)
  const routes: ManifestRoute[] = drafts.map(({ segments: _segments, ...d }) => {
    const o = overrides.routes[d.id] ?? {}
    const r: ManifestRoute = { ...d, command: names.get(d.id)! }
    const qp = d.queryParams ?? []
    if (o.summary !== undefined) r.summary = o.summary
    if (o.query) {
      r.query = o.query
      r.queryParams = o.query.map(name => qp.find(q => q.name === name) ?? { name, schema: { type: 'string' } })
    }
    for (const q of o.queryParams ?? []) {
      const list = (r.queryParams ??= [])
      const i = list.findIndex(x => x.name === q.name)
      if (i >= 0) list[i] = q
      else list.push(q)
      if (!r.query.includes(q.name)) r.query.push(q.name)
    }
    if (o.body !== undefined || o.noBody || o.bodyUnknown) {
      delete r.bodySource
      delete r.bodyContentType
      delete r.bodyAlternatives
      delete r.noBody
      delete r.bodyUnknown
      if (o.noBody) {
        r.body = null
        r.noBody = true
      } else if (o.bodyUnknown) {
        r.body = { raw: true, description: o.reason ?? 'not statically known' }
        r.bodyUnknown = true
      } else {
        r.body = o.body ? (resolveRefs(o.body, d.id) as JsonSchema) : null
        if (r.body) {
          r.bodySource = 'override'
          r.bodyContentType = o.bodyContentType ?? 'application/json'
        }
      }
    }
    if (o.hidden) r.hidden = true
    return order(r)
  })
  const unknown = Object.keys(overrides.routes).filter(id => !drafts.some(d => d.id === id))
  if (unknown.length) throw new Error(`overrides.json names routes that no longer exist: ${unknown.join(', ')}`)
  const manifestHash = crypto.createHash('sha256').update(JSON.stringify(routes)).digest('hex')
  return { manifest: { version: 1, manifestHash, routes }, unguarded: routes.filter(r => r.guard === 'none') }
}

const serialize = (m: Manifest) => JSON.stringify(m, null, 1) + '\n'

function main() {
  const check = process.argv.includes('--check')
  const { manifest, unguarded } = buildManifest()
  const text = serialize(manifest)
  const byHost: Record<string, number> = {}
  for (const r of manifest.routes) byHost[r.host] = (byHost[r.host] ?? 0) + 1
  const writes = manifest.routes.filter(r => r.method !== 'GET')
  const withBody = writes.filter(r => r.body && !r.body.raw).length
  const noBody = writes.filter(r => r.noBody).length
  const unknown = writes.filter(r => r.bodyUnknown)
  const withQuery = manifest.routes.filter(r => r.query.length).length
  console.log(`${manifest.routes.length} routes (${Object.entries(byHost).map(([h, n]) => `${h} ${n}`).join(', ')}); ${writes.length} writes: body ${withBody}, no body ${noBody}, unknown ${unknown.length}; query params on ${withQuery}; hash ${manifest.manifestHash.slice(0, 12)}`)
  if (unknown.length) {
    console.log(`\nWrites with an unknown body (${unknown.length}); describe them in overrides.json:`)
    for (const r of unknown) console.log(`  ${r.id}  (${r.body?.description})`)
  }
  if (unguarded.length) {
    console.log(`\nRoutes with no guard at all (${unguarded.length}):`)
    for (const r of unguarded) console.log(`  ${r.method.padEnd(6)} ${r.path}  (${r.file})`)
  }
  if (check) {
    const current = fs.existsSync(MANIFEST_PATH) ? fs.readFileSync(MANIFEST_PATH, 'utf8') : ''
    if (!fs.existsSync(OVERRIDES_PATH)) {
      console.error('\npackages/cli/manifest/overrides.json is missing; run npm run cli:manifest')
      process.exit(1)
    }
    if (current !== text) {
      let detail = ''
      try {
        const old = (JSON.parse(current) as Manifest).routes
        const oldIds = new Map(old.map(r => [r.id, JSON.stringify(r)]))
        const added = manifest.routes.filter(r => !oldIds.has(r.id)).map(r => r.id)
        const removed = old.filter(r => !manifest.routes.some(n => n.id === r.id)).map(r => r.id)
        const changed = manifest.routes.filter(r => oldIds.has(r.id) && oldIds.get(r.id) !== JSON.stringify(r)).map(r => r.id)
        detail = [added.length && `added: ${added.slice(0, 10).join(', ')}`, removed.length && `removed: ${removed.slice(0, 10).join(', ')}`, changed.length && `changed: ${changed.slice(0, 10).join(', ')}`].filter(Boolean).join('\n  ')
      } catch {
        detail = 'the committed file is missing or not JSON'
      }
      console.error(`\npackages/cli/manifest/admin-api.json is stale; run npm run cli:manifest and commit it.${detail ? `\n  ${detail}` : ''}`)
      process.exit(1)
    }
    console.log('\nThe admin API manifest is up to date.')
    return
  }
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true })
  fs.writeFileSync(MANIFEST_PATH, text)
  if (!fs.existsSync(OVERRIDES_PATH)) fs.writeFileSync(OVERRIDES_PATH, JSON.stringify({ routes: {} }, null, 2) + '\n')
  console.log(`\nWrote ${path.relative(ROOT, MANIFEST_PATH)}`)
}

if (require.main === module) main()
