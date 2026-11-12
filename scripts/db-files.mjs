#!/usr/bin/env node
// The SQL file manifest: every `database/` folder (repo root, each service, each package) in load order.
// No dependencies; controller-service/src/lib/db-files.ts mirrors it for the image (a test keeps them equal).
//
//   node scripts/db-files.mjs [platform]         extensions, tables/*, functions, triggers, indexes, constraints, foreign-keys
//   node scripts/db-files.mjs control-plane      the same, from each <owner>/database/control-plane/
//   node scripts/db-files.mjs migrations         every migrations/*.sql, sorted by basename (duplicates fail)
//   node scripts/db-files.mjs seeds [owner]      every seeds/*.sql, or one owner's
// --abs prints absolute paths.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Files that reference tables, loaded after every tables/ file. Foreign keys last, once every key they point at exists.
export const TAIL = ['functions.sql', 'triggers.sql', 'indexes.sql', 'constraints.sql', 'foreign-keys.sql']
const SKIP = new Set(['node_modules', 'graphify-out', 'database'])

const isDir = p => fs.existsSync(p) && fs.statSync(p).isDirectory()
const sqlIn = dir => (isDir(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => path.join(dir, f)) : [])

/** Owner folders that have a database/: the repo root first, then services and packages by name. */
export function databaseDirs(root = ROOT) {
  const subdirs = dir => (isDir(dir) ? fs.readdirSync(dir).filter(n => !n.startsWith('.') && !SKIP.has(n)).sort().map(n => path.join(dir, n)) : [])
  return [root, ...subdirs(root), ...subdirs(path.join(root, 'packages'))].map(o => path.join(o, 'database')).filter(isDir)
}

export function schemaFiles(set = 'platform', root = ROOT) {
  const dirs = databaseDirs(root).map(d => (set === 'control-plane' ? path.join(d, 'control-plane') : d)).filter(isDir)
  const out = set === 'platform' ? [path.join(root, 'database', 'extensions.sql')].filter(f => fs.existsSync(f)) : []
  for (const d of dirs) out.push(...sqlIn(path.join(d, 'tables')))
  for (const tail of TAIL) for (const d of dirs) if (fs.existsSync(path.join(d, tail))) out.push(path.join(d, tail))
  return out
}

export function migrationFiles(root = ROOT) {
  const files = databaseDirs(root).flatMap(d => sqlIn(path.join(d, 'migrations')))
  const seen = new Map()
  for (const f of files) {
    const b = path.basename(f)
    if (seen.has(b)) throw new Error(`duplicate migration basename ${b}: ${seen.get(b)} and ${f} (schema_migrations records the basename)`)
    seen.set(b, f)
  }
  return files.sort((a, b) => (path.basename(a) < path.basename(b) ? -1 : 1))
}

export function seedFiles(owner, root = ROOT) {
  return databaseDirs(root).filter(d => !owner || path.basename(path.dirname(d)) === owner).flatMap(d => sqlIn(path.join(d, 'seeds')))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
  const mode = args[0] || 'platform'
  try {
    let files
    if (mode === 'platform' || mode === 'control-plane') files = schemaFiles(mode)
    else if (mode === 'migrations') files = migrationFiles()
    else if (mode === 'seeds') files = seedFiles(args[1])
    else throw new Error(`unknown mode ${mode} (platform | control-plane | migrations | seeds [owner])`)
    const abs = process.argv.includes('--abs')
    for (const f of files) console.log(abs ? f : path.relative(ROOT, f))
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
