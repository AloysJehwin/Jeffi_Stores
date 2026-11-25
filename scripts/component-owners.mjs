#!/usr/bin/env node
// Which Next apps reach each packages/store-core/src file (static imports plus import()/require(), the walk
// packages/store-core/tests/lib/app-import-boundaries.test.ts does for specifiers). Writes
// scripts/component-owners.json; scripts/affected.mjs maps a store-core change to the apps that reach it.
//   node scripts/component-owners.mjs          regenerate the JSON
//   node scripts/component-owners.mjs --check  exit 1 when the committed JSON is stale
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const NEXT_APPS = ['controller', 'storefront', 'admin', 'business', 'showcase']
const CODE_RE = /\.(ts|tsx|js|jsx|mjs)$/
const SPEC_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"`])([^'"`\n]+)\1/g
const TRY = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js', '/index.mjs']
const CORE = 'packages/store-core/src'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const isCode = (f) => CODE_RE.test(f) && !f.endsWith('.d.ts')

export function computeOwners(root = rootDir) {
  const rel = (f) => path.relative(root, f).split(path.sep).join('/')
  const alias = { '@/': path.join(root, CORE) }
  for (const a of NEXT_APPS) alias[`@${a}/`] = path.join(root, `${a}-service/src`)

  const edges = new Map() // code file -> files it imports
  const touched = new Set() // every file some import resolves to (code or asset)
  const resolve = (from, spec) => {
    let base
    if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec)
    else {
      const k = Object.keys(alias).find((p) => spec.startsWith(p))
      if (!k) return null
      base = path.join(alias[k], spec.slice(k.length))
    }
    for (const t of TRY) {
      const c = base + t
      try {
        if (fs.statSync(c).isFile()) return c
      } catch {
        /* next candidate */
      }
    }
    return null
  }
  const load = (f) => {
    if (edges.has(f)) return edges.get(f)
    const deps = []
    edges.set(f, deps)
    if (!isCode(f)) return deps
    const src = fs.readFileSync(f, 'utf8')
    for (const m of src.matchAll(SPEC_RE)) {
      const r = resolve(f, m[2])
      if (r) deps.push(r)
    }
    return deps
  }

  const reach = {}
  for (const app of NEXT_APPS) {
    const seen = new Set()
    const stack = walk(path.join(root, `${app}-service/src`)).filter(isCode)
    while (stack.length) {
      const f = stack.pop()
      if (seen.has(f)) continue
      seen.add(f)
      for (const d of load(f)) {
        touched.add(d)
        if (!seen.has(d)) stack.push(d)
      }
    }
    reach[app] = seen
  }

  // The manifest lists store-core code files, plus any asset an import reaches. A file missing from it is "unknown".
  const universe = new Set(walk(path.join(root, CORE)).filter(isCode))
  for (const f of touched) if (f.startsWith(path.join(root, CORE) + path.sep)) universe.add(f)
  const files = {}
  for (const f of [...universe].sort((a, b) => (rel(a) < rel(b) ? -1 : 1))) {
    files[rel(f)] = NEXT_APPS.filter((a) => reach[a].has(f))
  }
  return { apps: NEXT_APPS, files }
}

// One line per file keeps the diff readable.
export const serialize = (owners) =>
  `{\n "apps": ${JSON.stringify(owners.apps)},\n "files": {\n` +
  Object.entries(owners.files)
    .map(([f, a]) => `  ${JSON.stringify(f)}: ${JSON.stringify(a)}`)
    .join(',\n') +
  '\n }\n}\n'

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.join(rootDir, 'scripts/component-owners.json')
  const fresh = serialize(computeOwners())
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : ''
    if (cur !== fresh) {
      console.error('scripts/component-owners.json is stale: run `node scripts/component-owners.mjs` and commit it.')
      process.exit(1)
    }
    console.log('component-owners.json is up to date')
  } else {
    fs.writeFileSync(out, fresh)
    console.log(`wrote scripts/component-owners.json (${Object.keys(JSON.parse(fresh).files).length} files)`)
  }
}
