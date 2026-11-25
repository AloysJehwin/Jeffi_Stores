#!/usr/bin/env node
// Route inventory for the Fastify services: every route registered in a service's server file must be
// referenced (by path) in one of that service's tests, unless it sits in scripts/service-routes-allowlist.json.
// The allowlist only shrinks: an entry whose route gained a test, or no longer exists, fails too.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// `prefixes` maps a registering variable to the prefix it was registered under (app.register(..., { prefix })).
export const SERVICES = {
  messaging: { dir: 'messaging-service', sources: ['src/server.ts'], prefixes: {} },
  document: { dir: 'document-service', sources: ['src/server.ts'], prefixes: {} },
  'public-api': { dir: 'public-api-service', sources: ['src/server.ts', 'src/admin-gateway.ts'], prefixes: { v1: '/v1' } },
  mobile: { dir: 'mobile-service', sources: ['src/server.ts'], prefixes: {} },
}

const ROUTE = /\b(\w+)\.(get|post|put|delete|patch|all)(?:<[^()]*?>)?\(\s*(['"`])(\/[^'"`]*)\3/g

/** [{ method, path }] for every literal-path route in a source text. */
export function extractRoutes(source, prefixes = {}) {
  const text = source.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
  const seen = new Set()
  const routes = []
  for (const m of text.matchAll(ROUTE)) {
    if (m[4].includes('${')) continue // interpolated paths can't be listed statically
    const route = { method: m[2].toUpperCase(), path: (prefixes[m[1]] ?? '') + m[4] }
    const key = `${route.method} ${route.path}`
    if (!seen.has(key)) { seen.add(key); routes.push(route) }
  }
  return routes
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** True when the test text contains a string literal for the route's path (:params match a value or ${...}). */
export function isReferenced(routePath, testText) {
  const body = routePath
    .split('/')
    .map(seg => (seg.startsWith(':') ? '(?:\\$\\{[^}]*\\}|[^/\'"`?#\\s$]+)' : seg === '*' ? '[^\'"`\\s]*' : esc(seg)))
    .join('/')
  return new RegExp("(?<=['\"`}])" + body + "(?=['\"`?#\\s]|$)").test(testText)
}

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(p)) : [p]
  })
}

/** Compare per-service routes and test text against the allowlist; returns the problems found. */
export function check({ routesByService, testTextByService, allowlist }) {
  const problems = []
  for (const [svc, routes] of Object.entries(routesByService)) {
    const allowed = new Set(allowlist[svc] ?? [])
    const live = new Set()
    for (const r of routes) {
      const key = `${r.method} ${r.path}`
      live.add(key)
      const covered = isReferenced(r.path, testTextByService[svc] ?? '')
      if (!covered && !allowed.has(key)) problems.push(`${svc}: no test references ${key}`)
      if (covered && allowed.has(key)) problems.push(`${svc}: ${key} now has a test; remove it from the allowlist`)
    }
    for (const key of allowed) if (!live.has(key)) problems.push(`${svc}: allowlisted ${key} no longer exists; remove it`)
  }
  for (const svc of Object.keys(allowlist)) if (!routesByService[svc]) problems.push(`allowlist names unknown service ${svc}`)
  return problems
}

function main() {
  const allowlist = JSON.parse(fs.readFileSync(path.join(root, 'scripts/service-routes-allowlist.json'), 'utf8'))
  const routesByService = {}
  const testTextByService = {}
  for (const [svc, cfg] of Object.entries(SERVICES)) {
    routesByService[svc] = cfg.sources.flatMap(s => extractRoutes(fs.readFileSync(path.join(root, cfg.dir, s), 'utf8'), cfg.prefixes))
    testTextByService[svc] = walk(path.join(root, cfg.dir, 'test'))
      .filter(f => /\.test\.tsx?$/.test(f))
      .map(f => fs.readFileSync(f, 'utf8'))
      .join('\n')
  }
  const problems = check({ routesByService, testTextByService, allowlist })
  if (problems.length) {
    console.error('Fastify service route coverage:')
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }
  const total = Object.values(routesByService).reduce((n, r) => n + r.length, 0)
  console.log(`All ${total} Fastify service routes are referenced by a test (or allowlisted).`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
