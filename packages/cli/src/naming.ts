// Command names for manifest routes: `resource action`, shared by the generator and the CLI.

export type HostClass = 'admin' | 'platform' | 'storefront'

export interface NamingRoute {
  key: string
  host: HostClass
  method: string
  /** Path segments after the host's prefix, params as `{id}` / `{...path}`. */
  segments: string[]
}

export const isParamSegment = (s: string) => s.startsWith('{') && s.endsWith('}')

const ITEM_ACTION: Record<string, string> = { GET: 'get', PATCH: 'update', PUT: 'update', DELETE: 'delete', POST: 'post' }
const COLLECTION_ACTION: Record<string, string> = { GET: 'list', POST: 'create', PATCH: 'bulk-update', PUT: 'bulk-update', DELETE: 'bulk-delete' }
const SINGLETON_ACTION: Record<string, string> = { GET: 'get', POST: 'create', PATCH: 'update', PUT: 'update', DELETE: 'delete' }
const METHOD_VERB: Record<string, string> = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }

// Top-level names the CLI owns; a route resource with one of these names gets an `-api` suffix.
export const RESERVED_RESOURCES = new Set(['platform', 'storefront', 'login', 'logout', 'whoami', 'profiles', 'api', 'help'])

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'x'
const paramName = (s: string) => s.replace(/^\{(\.\.\.)?|\}$/g, '')
const pathKey = (r: NamingRoute) => `${r.host}:${r.segments.join('/')}`

/** Paths with a `{param}` segment right below them somewhere, i.e. collections. */
export function collectionPaths(routes: NamingRoute[]): Set<string> {
  const out = new Set<string>()
  for (const r of routes) {
    r.segments.forEach((s, i) => {
      if (i > 0 && isParamSegment(s) && !isParamSegment(r.segments[i - 1])) out.add(`${r.host}:${r.segments.slice(0, i).join('/')}`)
    })
  }
  return out
}

export function baseCommand(r: NamingRoute, collections: Set<string>): { resource: string; action: string } {
  const statics = r.segments.filter(s => !isParamSegment(s))
  const last = r.segments[r.segments.length - 1]
  let resource: string
  let action: string
  if (!last) {
    resource = 'root'
    action = SINGLETON_ACTION[r.method] ?? r.method.toLowerCase()
  } else if (isParamSegment(last)) {
    resource = statics.join('-') || 'root'
    action = ITEM_ACTION[r.method] ?? r.method.toLowerCase()
  } else if (collections.has(pathKey(r))) {
    resource = statics.join('-')
    action = COLLECTION_ACTION[r.method] ?? r.method.toLowerCase()
  } else if (statics.length === 1) {
    resource = statics[0]
    action = SINGLETON_ACTION[r.method] ?? r.method.toLowerCase()
  } else {
    resource = statics.slice(0, -1).join('-')
    action = last
  }
  resource = clean(resource)
  if (r.host === 'admin' && RESERVED_RESOURCES.has(resource)) resource = `${resource}-api`
  return { resource, action: clean(action) }
}

const prefixOf = (host: HostClass) => (host === 'admin' ? '' : `${host} `)
const paramCount = (r: NamingRoute) => r.segments.filter(isParamSegment).length

/**
 * Unique command per route. Within a colliding name: routes on deeper paths get `-by-<param>`;
 * several methods on one path get a method suffix (create / update / delete, the GET keeps the
 * plain name, then the raw method if that still collides); anything left gets -2, -3 in path
 * order. `fixed` names (overrides) are taken first and never renamed.
 */
export function assignCommandNames(routes: NamingRoute[], fixed: Record<string, string> = {}): Map<string, string> {
  const collections = collectionPaths(routes)
  const out = new Map<string, string>()
  const taken = new Set(Object.values(fixed))
  for (const r of routes) if (fixed[r.key]) out.set(r.key, fixed[r.key])
  const names = new Map<NamingRoute, string>()
  for (const r of routes) {
    if (fixed[r.key]) continue
    const { resource, action } = baseCommand(r, collections)
    names.set(r, `${prefixOf(r.host)}${resource} ${action}`)
  }
  const passes: ((group: NamingRoute[], name: string) => void)[] = [
    (group, name) => {
      if (new Set(group.map(pathKey)).size < 2) return
      const min = Math.min(...group.map(paramCount))
      for (const r of group) {
        const params = r.segments.filter(isParamSegment)
        if (paramCount(r) > min) names.set(r, `${name}-by-${clean(paramName(params[params.length - 1]))}`)
      }
    },
    group => {
      const byPath = new Map<string, NamingRoute[]>()
      for (const r of group) byPath.set(pathKey(r), [...(byPath.get(pathKey(r)) ?? []), r])
      for (const rs of byPath.values()) {
        if (rs.length < 2) continue
        for (const r of rs) if (r.method !== 'GET') names.set(r, `${names.get(r)}-${METHOD_VERB[r.method] ?? r.method.toLowerCase()}`)
      }
    },
    group => {
      for (const r of group) if (r.method !== 'GET' && !names.get(r)!.endsWith(`-${r.method.toLowerCase()}`)) names.set(r, `${names.get(r)}-${r.method.toLowerCase()}`)
    },
  ]
  const collisions = () => {
    const groups = new Map<string, NamingRoute[]>()
    for (const [r, n] of names) groups.set(n, [...(groups.get(n) ?? []), r])
    return [...groups].filter(([n, rs]) => rs.length > 1 || taken.has(n))
  }
  for (const pass of passes) for (const [name, group] of collisions()) pass(group, name)
  const sorted = [...names].sort(([a], [b]) => a.segments.join('/').localeCompare(b.segments.join('/')) || a.key.localeCompare(b.key))
  for (const [r, name] of sorted) {
    let n = name
    for (let k = 2; taken.has(n); k++) n = `${name}-${k}`
    taken.add(n)
    out.set(r.key, n)
  }
  return out
}
