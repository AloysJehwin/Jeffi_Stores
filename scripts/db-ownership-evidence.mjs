#!/usr/bin/env node
// Counts which service writes each table (INSERT/UPDATE/DELETE statements in SQL strings). A write inside
// packages/* is credited to the one service whose entry files (routes, pages, actions; any src file for the
// non-Next services) import that file most closely.
// Usage: node scripts/db-ownership-evidence.mjs <tables.txt> > evidence.json
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const SERVICES = ['admin-service', 'storefront-service', 'business-service', 'controller-service', 'messaging-service', 'document-service', 'public-api-service', 'mobile-service']
const ALIAS = { '@/': 'packages/store-core/src/', '@controller/': 'controller-service/src/', '@storefront/': 'storefront-service/src/', '@admin/': 'admin-service/src/', '@business/': 'business-service/src/' }
const tables = new Set(fs.readFileSync(process.argv[2], 'utf8').split('\n').map(s => s.trim()).filter(Boolean))

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', 'client', 'tests', 'test', 'integration-tests', '__tests__'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) out.push(p)
  }
  return out
}

const files = [
  ...SERVICES.flatMap(s => ['src', 'scripts', 'seed'].flatMap(d => walk(path.join(ROOT, s, d)))),
  ...fs.readdirSync(path.join(ROOT, 'packages')).flatMap(p => walk(path.join(ROOT, 'packages', p, 'src'))),
]
const known = new Set(files)
const tryFile = base => {
  for (const c of [base, base + '.ts', base + '.tsx', base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), path.join(base, 'index.ts'), path.join(base, 'index.tsx')])
    if (known.has(c)) return c
  return null
}
function resolve(from, spec) {
  if (spec.startsWith('.')) return tryFile(path.resolve(path.dirname(from), spec))
  for (const [a, to] of Object.entries(ALIAS)) if (spec.startsWith(a)) return tryFile(path.join(ROOT, to, spec.slice(a.length)))
  const m = spec.match(/^@jeffi\/([a-z-]+)(?:\/(.*))?$/)
  if (m) return tryFile(path.join(ROOT, 'packages', m[1], 'src', m[2] || 'index'))
  return null
}

const WRITE_RE = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?(?:public\.)?"?([a-z_][a-z_0-9]*)"?/gi
const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g
const imports = new Map()
const writes = new Map() // file -> Map(table -> n)
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const deps = []
  for (const m of src.matchAll(IMPORT_RE)) { const r = resolve(f, m[1]); if (r) deps.push(r) }
  imports.set(f, deps)
  const w = new Map()
  for (const m of src.matchAll(WRITE_RE)) { const t = m[1].toLowerCase(); if (tables.has(t)) w.set(t, (w.get(t) || 0) + 1) }
  if (w.size) writes.set(f, w)
}

// The B2B portal's API routes are hosted by the storefront (every store /api lives there) but belong to the business app.
const B2B_API = path.join('storefront-service', 'src', 'app', 'api', '(public)', 'business') + path.sep
const svcOf = f => { const rel = path.relative(ROOT, f); return rel.startsWith(B2B_API) ? 'business-service' : rel.split(path.sep)[0] }
const isEntry = (svc, f) => /-service$/.test(svc) && (['admin-service', 'storefront-service', 'business-service', 'controller-service'].includes(svc) ? /\/src\/app\/.*\/(route|page|actions|layout)\.tsx?$/.test(f) || /\/src\/(lib|middleware|instrumentation)/.test(f) : true)

// Per package file with writes: entry files per service reaching it within 2 import hops (near), and the share of
// each service's entry files reaching it at any depth (far). A package write goes to the service with the most near
// importers, else the largest far share.
const near = new Map(), far = new Map(), entryCount = {}
const bump = (m, f, svc) => { if (!m.has(f)) m.set(f, {}); m.get(f)[svc] = (m.get(f)[svc] || 0) + 1 }
for (const f of files) {
  const svc = svcOf(f)
  if (svc === 'packages' || !isEntry(svc, f)) continue
  entryCount[svc] = (entryCount[svc] || 0) + 1
  const depth = new Map([[f, 0]])
  const queue = [f]
  while (queue.length) { const c = queue.shift(); for (const d of imports.get(c) || []) if (!depth.has(d)) { depth.set(d, depth.get(c) + 1); queue.push(d) } }
  for (const [d, n] of depth) {
    if (!writes.has(d) || svcOf(d) !== 'packages') continue
    bump(far, d, svc)
    if (n <= 2) bump(near, d, svc)
  }
}
const top = o => Object.entries(o || {}).sort((x, y) => y[1] - x[1])[0]?.[0]
function packageOwner(f) {
  const n = top(near.get(f))
  if (n) return n
  const shares = Object.fromEntries(Object.entries(far.get(f) || {}).map(([s, c]) => [s, c / entryCount[s]]))
  return top(shares) || null
}

const out = {}
for (const t of [...tables].sort()) out[t] = { direct: {}, viaPackages: {}, total: {}, packageFiles: [] }
for (const [f, w] of writes) {
  const svc = svcOf(f)
  const owner = svc === 'packages' ? packageOwner(f) : svc
  for (const [t, n] of w) {
    if (svc === 'packages') out[t].packageFiles.push(`${path.relative(ROOT, f)} -> ${owner || 'unreached'}`)
    if (!owner) continue
    const bucket = svc === 'packages' ? out[t].viaPackages : out[t].direct
    bucket[owner] = (bucket[owner] || 0) + n
    out[t].total[owner] = (out[t].total[owner] || 0) + n
  }
}
console.log(JSON.stringify(out, null, 1))
