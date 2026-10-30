// A small Traefik router for tests: evaluates IngressRoute match rules (Host, HostRegexp, Path, PathPrefix,
// PathRegexp, &&, ||, parentheses) and picks the highest-priority route, as Traefik does across a cluster.

type Ctx = { host: string; path: string }

const goRegex = (src: string) => (src.startsWith('(?i)') ? new RegExp(src.slice(4), 'i') : new RegExp(src))

const MATCHERS: Record<string, (arg: string, c: Ctx) => boolean> = {
  Host: (a, c) => c.host.toLowerCase() === a.toLowerCase(),
  HostRegexp: (a, c) => goRegex(a).test(c.host),
  Path: (a, c) => c.path === a,
  PathPrefix: (a, c) => c.path.startsWith(a),
  PathRegexp: (a, c) => goRegex(a).test(c.path),
}

export function evalRule(rule: string, c: Ctx): boolean {
  let i = 0
  const ws = () => {
    while (rule[i] === ' ' || rule[i] === '\n') i++
  }
  const or = (): boolean => {
    let v = and()
    for (ws(); rule.startsWith('||', i); ws()) {
      i += 2
      v = and() || v
    }
    return v
  }
  const and = (): boolean => {
    let v = term()
    for (ws(); rule.startsWith('&&', i); ws()) {
      i += 2
      v = term() && v
    }
    return v
  }
  const term = (): boolean => {
    ws()
    if (rule[i] === '(') {
      i++
      const v = or()
      ws()
      if (rule[i++] !== ')') throw new Error(`expected ) at ${i} in ${rule}`)
      return v
    }
    const m = /^([A-Za-z]+)\(`([^`]*)`\)/.exec(rule.slice(i))
    if (!m || !MATCHERS[m[1]]) throw new Error(`bad matcher at ${i} in ${rule}`)
    i += m[0].length
    return MATCHERS[m[1]](m[2], c)
  }
  const v = or()
  ws()
  if (i !== rule.length) throw new Error(`trailing input at ${i} in ${rule}`)
  return v
}

export interface MatchedRoute {
  route: any
  ingress: any
}

/** The route Traefik sends (host, path) to among these IngressRoutes, or null. */
export function matchIngress(objs: any[], host: string, path: string): MatchedRoute | null {
  let best: MatchedRoute | null = null
  let bestPriority = -Infinity
  for (const ingress of objs.filter(o => o.kind === 'IngressRoute')) {
    for (const route of ingress.spec.routes) {
      if (!evalRule(route.match, { host, path })) continue
      const priority = route.priority ?? route.match.length
      if (priority > bestPriority) {
        best = { route, ingress }
        bestPriority = priority
      }
    }
  }
  return best
}
