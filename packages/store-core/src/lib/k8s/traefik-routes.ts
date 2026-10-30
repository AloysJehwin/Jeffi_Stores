import { ROUTES, type AppName, type HostClass, type PathMatch } from '@/lib/service-routing'

// The ingress side of lib/service-routing.ts: Traefik routes that send each (host, path) where routeFor does.
// Traefik picks the highest-priority router that matches, across every IngressRoute in the cluster, so
// the table's order becomes priorities inside a band: hosts of one store or the platform never overlap,
// and the catch-all for unclaimed hosts sits in a lower band than every named host.

export const EDGE_NS = 'jeffi-edge'
export const STRIP_ASSET_PREFIX = { name: 'strip-asset-prefix', namespace: EDGE_NS }

// Bands: a store's or the platform's named hosts; the platform's catch-all for hosts no store claims, below
// every route left at Traefik's default priority (its rule's length; public-api, mobile, documents); and
// routes that must beat both on a shared host (a store's own-key webhook on the platform host).
export const PRIORITY_BAND = { named: 1000, catchAll: 0, override: 2000 } as const

export interface HostGroup {
  classes: Exclude<HostClass, 'any'>[]
  /** A Traefik host matcher, e.g. Host(`a`) || Host(`b`) or HostRegexp(`…`). */
  match: string
}

export interface Backend {
  name: string
  port: number
  namespace?: string
}

const q = (s: string) => `\`${s}\``

export const hostMatch = (hosts: string[]) => hosts.map(h => `Host(${q(h)})`).join(' || ')

// RE2 (Go) has no lookaround and takes flags inline.
const regex = (re: RegExp) => `${re.flags.includes('i') ? '(?i)' : ''}${re.source}`

export function pathRule(m: PathMatch): string {
  if ('prefix' in m) return `PathPrefix(${q(m.prefix)})`
  if ('under' in m) return `Path(${q(m.under)}) || PathPrefix(${q(m.under + '/')})`
  if ('exact' in m) return `Path(${q(m.exact)})`
  return `PathRegexp(${q(regex(m.pattern))})`
}

const or = (parts: string[]) => (parts.length === 1 ? parts[0] : parts.map(p => `(${p})`).join(' || '))

export interface TraefikRoute {
  match: string
  kind: 'Rule'
  priority: number
  middlewares?: { name: string; namespace?: string }[]
  services: Backend[]
}

/**
 * The routes for a set of hosts that share TLS and middlewares (one IngressRoute). Rules whose app has no
 * backend here are left out: a store has no controller, so those paths fall through to the next rule.
 */
export function trafficRoutes(opts: {
  groups: HostGroup[]
  backends: Partial<Record<AppName, Backend>>
  middlewares?: { name: string; namespace?: string }[]
  band: number
}): TraefikRoute[] {
  const out: TraefikRoute[] = []
  ROUTES.forEach((rule, i) => {
    const backend = opts.backends[rule.app]
    if (!backend) return
    const groups = opts.groups.filter(g => rule.hosts === 'any' || g.classes.includes(rule.hosts))
    if (!groups.length) return
    const hosts = or(groups.map(g => g.match))
    const match = rule.paths ? `(${hosts}) && (${or(rule.paths.map(pathRule))})` : hosts
    const middlewares = [...(opts.middlewares ?? []), ...(rule.strip ? [STRIP_ASSET_PREFIX] : [])]
    out.push({
      match,
      kind: 'Rule',
      priority: opts.band + ROUTES.length - i,
      ...(middlewares.length ? { middlewares } : {}),
      services: [backend],
    })
  })
  return out
}
