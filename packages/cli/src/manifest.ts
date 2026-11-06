import fs from 'node:fs'
import manifestJson from '../manifest/admin-api.json'
import type { JsonSchema, Manifest, ManifestRoute } from './manifest-types'
import type { ApiRequest } from './http'
import { CliError, kebab, parseValue, setPath, splitPair } from './util'

export const manifest = manifestJson as unknown as Manifest

// Flags every generated command already has; route fields with these names go through --field / --query.
export const RESERVED_FLAGS = new Set(['json', 'profile', 'host', 'direct', 'data', 'field', 'query', 'help', 'version', 'header', 'raw', 'file'])

export interface FlagDef {
  flag: string
  kind: 'query' | 'body'
  key: string
  type: 'string' | 'number' | 'boolean' | 'json'
  description: string
}

const typesOf = (s: JsonSchema) => (Array.isArray(s.type) ? (s.type as string[]) : typeof s.type === 'string' ? [s.type] : []).filter(t => t !== 'null')

const isBinary = (s: JsonSchema | undefined) => !!s && (s.format === 'binary' || (typesOf(s).includes('array') && (s.items as JsonSchema | undefined)?.format === 'binary'))

function propType(s: JsonSchema): FlagDef['type'] | null {
  if (isBinary(s)) return null
  if (Array.isArray(s.enum) && s.enum.length && s.enum.every(x => typeof x === 'string')) return 'string'
  const t = typesOf(s)
  if (t.length === 1) {
    if (t[0] === 'string') return 'string'
    if (t[0] === 'number' || t[0] === 'integer') return 'number'
    if (t[0] === 'boolean') return 'boolean'
    if (t[0] === 'array' || t[0] === 'object') return 'json'
  }
  // Several types, or none known: the value is parsed as JSON when it looks like JSON, else sent as text.
  return 'json'
}

function hint(s: JsonSchema | undefined): string[] {
  if (!s) return []
  const bits: string[] = []
  if (Array.isArray(s.enum)) bits.push(`one of ${(s.enum as unknown[]).join(', ')}`)
  if (s.default !== undefined) bits.push(`default ${JSON.stringify(s.default)}`)
  if (typeof s.description === 'string' && !/type assumed|type not inferred/.test(s.description)) bits.push(s.description)
  return bits
}

/** Body schema the command sends: JSON, or the multipart variant when that's the only encoding. */
export function multipartSchema(route: ManifestRoute): JsonSchema | null {
  if (route.bodyContentType === 'multipart/form-data') return route.body
  return route.bodyAlternatives?.find(a => a.contentType === 'multipart/form-data')?.schema ?? null
}

/** Named flags for a route: one per query key, one per top-level body property (when the names don't clash). */
export function flagsFor(route: ManifestRoute): FlagDef[] {
  const out: FlagDef[] = []
  const used = new Set<string>()
  const ok = (flag: string) => !RESERVED_FLAGS.has(flag) && !used.has(flag) && !flag.startsWith('no-') && /^[a-z][a-z0-9-]*$/.test(flag)
  for (const key of route.query) {
    const flag = kebab(key)
    if (!ok(flag)) continue
    used.add(flag)
    const q = route.queryParams?.find(x => x.name === key)
    const bits = [q?.required ? 'required' : '', ...hint(q?.schema)].filter(Boolean)
    out.push({ flag, kind: 'query', key, type: 'string', description: `query ?${key}=${bits.length ? ` (${bits.join('; ')})` : ''}` })
  }
  const props = (route.body?.properties ?? {}) as Record<string, JsonSchema>
  const required = new Set((route.body?.required as string[] | undefined) ?? [])
  for (const [key, s] of Object.entries(props)) {
    const flag = kebab(key)
    const type = propType(s)
    if (!type || !ok(flag)) continue
    used.add(flag)
    const bits = [required.has(key) ? 'required' : '', ...hint(s), type === 'json' ? 'JSON' : ''].filter(Boolean)
    out.push({ flag, kind: 'body', key, type, description: `body ${key}${bits.length ? ` (${bits.join('; ')})` : ''}` })
  }
  return out
}

/** Binary fields of a multipart body (the targets of --file). */
export function fileFields(route: ManifestRoute): string[] {
  const m = multipartSchema(route)
  return Object.entries((m?.properties ?? {}) as Record<string, JsonSchema>).filter(([, s]) => isBinary(s)).map(([k]) => k)
}

export interface RequestOpts {
  data?: string
  field?: string[]
  query?: string[]
  /** `field=path` (or a bare path when the route has a single file field): sends multipart/form-data. */
  file?: string[]
  /** Values of the named flags, keyed by flag name. */
  named?: Record<string, unknown>
  readStdin?: () => string
}

/** --file values to [field, path] pairs. */
export function filePairs(route: ManifestRoute | null, files: string[]): [string, string][] {
  return files.map(f => {
    const i = f.indexOf('=')
    if (i > 0 && !/^[./~]/.test(f)) return [f.slice(0, i), f.slice(i + 1)]
    const fields = route ? fileFields(route) : []
    if (fields.length === 1) return [fields[0], f]
    throw new CliError(`--file must look like field=path${fields.length ? ` (fields: ${fields.join(', ')})` : ''}: ${f}`)
  })
}

/** A multipart request from a JSON-ish body plus files: objects are sent as JSON text. */
export function toMultipart(body: Record<string, unknown> | undefined, files: [string, string][]): [string, string | { path: string }][] {
  const parts: [string, string | { path: string }][] = []
  for (const [k, v] of Object.entries(body ?? {})) {
    if (v === undefined) continue
    if (Array.isArray(v)) for (const x of v) parts.push([k, typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x)])
    else parts.push([k, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)])
  }
  for (const [k, p] of files) parts.push([k, { path: p }])
  return parts
}

export function readData(data: string, readStdin?: () => string): unknown {
  let text = data
  if (data === '-') text = readStdin ? readStdin() : fs.readFileSync(0, 'utf8')
  else if (data.startsWith('@')) text = fs.readFileSync(data.slice(1), 'utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw new CliError('--data must be JSON (or @file / - for stdin)')
  }
}

/** Fills the path, collects query pairs and merges --data, --field and named flags into the body. */
export function buildRequest(route: ManifestRoute, positionals: (string | string[] | undefined)[], opts: RequestOpts = {}): ApiRequest {
  let i = 0
  const missing: string[] = []
  const path = route.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const p = route.pathParams.find(x => x.name === name)
    const v = positionals[i++]
    const vals = Array.isArray(v) ? v : v === undefined ? [] : [v]
    if (!vals.length && !p?.optional) missing.push(name)
    return vals.map(x => (p?.catchAll ? x.split('/').map(encodeURIComponent).join('/') : encodeURIComponent(x))).join('/')
  }).replace(/\/+$/, '')
  if (missing.length) throw new CliError(`Missing <${missing.join('>, <')}>`)

  const query: [string, string][] = []
  const flags = flagsFor(route)
  const named = opts.named ?? {}
  for (const f of flags) {
    const v = named[f.flag]
    if (f.kind === 'query' && v !== undefined && v !== false) query.push([f.key, String(v)])
  }
  for (const q of opts.query ?? []) query.push(splitPair(q, '--query'))

  let body: Record<string, unknown> | unknown[] | undefined
  if (opts.data !== undefined) {
    const d = readData(opts.data, opts.readStdin)
    if (typeof d !== 'object' || d === null) throw new CliError('--data must be a JSON object or array')
    body = d as Record<string, unknown>
  }
  const bodyFlags = flags.filter(f => f.kind === 'body' && named[f.flag] !== undefined)
  if (bodyFlags.length || opts.field?.length) {
    if (Array.isArray(body)) throw new CliError('--field cannot be combined with a JSON array in --data')
    const obj = (body as Record<string, unknown>) ?? {}
    for (const f of bodyFlags) {
      const v = named[f.flag]
      obj[f.key] = f.type === 'number' ? Number(v) : f.type === 'json' && typeof v === 'string' ? parseValue(v) : f.type === 'boolean' ? v !== false : v
      if (f.type === 'number' && Number.isNaN(obj[f.key])) throw new CliError(`--${f.flag} must be a number`)
    }
    for (const fld of opts.field ?? []) {
      const [k, v] = splitPair(fld, '--field')
      setPath(obj, k, parseValue(v))
    }
    body = obj
  }
  if (body !== undefined && route.method === 'GET') throw new CliError(`${route.command} is a GET; it takes no body`)
  const files = filePairs(route, opts.file ?? [])
  if (files.length || route.bodyContentType === 'multipart/form-data') {
    if (route.method === 'GET') throw new CliError(`${route.command} is a GET; it takes no files`)
    if (Array.isArray(body)) throw new CliError('A multipart body cannot be a JSON array')
    if (files.length && !multipartSchema(route)) throw new CliError(`${route.command} takes a JSON body, not files`)
    return { method: route.method, path, query, multipart: toMultipart(body as Record<string, unknown> | undefined, files) }
  }
  return { method: route.method, path, query, body }
}

/** The positional args of a route, for commander: <id>, <path...>, [x]. */
export function argSpec(route: ManifestRoute): string[] {
  return route.pathParams.map(p => {
    const name = p.name.replace(/[^A-Za-z0-9_-]/g, '')
    if (p.catchAll) return p.optional ? `[${name}...]` : `<${name}...>`
    return p.optional ? `[${name}]` : `<${name}>`
  })
}

export function findRoute(id: string): ManifestRoute {
  const r = manifest.routes.find(x => x.id === id)
  if (!r) throw new CliError(`This CLI's manifest has no route ${id}`)
  return r
}
