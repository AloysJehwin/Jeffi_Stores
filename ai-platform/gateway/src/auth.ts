import { createHash, timingSafeEqual } from 'node:crypto'

// Shared bearer token(s). Comma-separated so a rotation can accept "new,old" until every client has the new one.
export function parseTokens(raw: string): string[] {
  return [...new Set(raw.split(',').map(t => t.trim()).filter(Boolean))]
}

// Probes stay open: kubelet, ServiceLB health and the app's reachability check carry no token.
const OPEN_PATHS = new Set(['/healthz', '/readyz'])

const digest = (s: string) => createHash('sha256').update(s).digest()

/** No tokens configured = open (the rollout's first step). Otherwise `Authorization: Bearer <token>`, compared in constant time. */
export function authorized(path: string, header: string | string[] | undefined, tokens: string[]): boolean {
  if (!tokens.length || OPEN_PATHS.has(path)) return true
  const m = typeof header === 'string' ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null
  if (!m) return false
  const got = digest(m[1])
  let ok = false
  for (const t of tokens) ok = timingSafeEqual(got, digest(t)) || ok
  return ok
}
