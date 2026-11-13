import fs from 'fs'
import path from 'path'
import { repoRoot } from '@/lib/shared/paths'

// The SQL files of every database/ folder (repo root, each service, each package). The same discovery as
// scripts/db-files.mjs, which the release scripts use; tests/lib/db-files.test.ts keeps the two equal.
// platform = the flagship DB (adds each owner's platform-only/), tenant = a store's own DB, control-plane = flagship only.

export type SchemaSet = 'platform' | 'tenant' | 'control-plane'

/** Files that reference tables, in the manifest's load order (foreign keys once every key they point at exists). */
export const MANIFEST_TAIL = ['functions.sql', 'triggers.sql', 'indexes.sql', 'constraints.sql', 'foreign-keys.sql']

/** Tables only the platform uses (flagship DB only); same shape as <owner>/database/. */
export const PLATFORM_ONLY = 'platform-only'

const SKIP = new Set(['node_modules', 'graphify-out', 'database'])
const isDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory()
const sqlIn = (dir: string) =>
  isDir(dir)
    ? fs
        .readdirSync(dir)
        .filter(f => f.endsWith('.sql'))
        .sort()
        .map(f => path.join(dir, f))
    : []

/** Owner folders that have a database/: the repo root first, then services and packages by name. */
export function databaseDirs(root = repoRoot()): string[] {
  const subdirs = (dir: string) =>
    isDir(dir)
      ? fs
          .readdirSync(dir)
          .filter(n => !n.startsWith('.') && !SKIP.has(n))
          .sort()
          .map(n => path.join(dir, n))
      : []
  return [root, ...subdirs(root), ...subdirs(path.join(root, 'packages'))].map(o => path.join(o, 'database')).filter(isDir)
}

/** The folders a set loads from, in order: each owner's database/, then (platform) each owner's platform-only/. */
export function setDirs(set: SchemaSet = 'platform', root = repoRoot()): string[] {
  const owners = databaseDirs(root)
  if (set === 'control-plane') return owners.map(d => path.join(d, 'control-plane')).filter(isDir)
  return set === 'tenant' ? owners : [...owners, ...owners.map(d => path.join(d, PLATFORM_ONLY)).filter(isDir)]
}

/** extensions.sql, every tables/*.sql, then each `tail` file across the set's folders, in that order. */
export function schemaFiles(set: SchemaSet = 'platform', tail: string[] = MANIFEST_TAIL, root = repoRoot()): string[] {
  const dirs = setDirs(set, root)
  const out = set === 'control-plane' ? [] : [path.join(root, 'database', 'extensions.sql')].filter(f => fs.existsSync(f))
  for (const d of dirs) out.push(...sqlIn(path.join(d, 'tables')))
  for (const t of tail) for (const d of dirs) if (fs.existsSync(path.join(d, t))) out.push(path.join(d, t))
  return out
}

/** migrations/*.sql of a set sorted by basename; a tenant never runs platform-only/migrations. Basenames are unique across both. */
export function migrationFiles(set: 'platform' | 'tenant' = 'platform', root = repoRoot()): string[] {
  const all = setDirs('platform', root).flatMap(d => sqlIn(path.join(d, 'migrations')))
  const seen = new Map<string, string>()
  for (const f of all) {
    const b = path.basename(f)
    if (seen.has(b)) throw new Error(`duplicate migration basename ${b}: ${seen.get(b)} and ${f}`)
    seen.set(b, f)
  }
  const files = set === 'platform' ? all : setDirs(set, root).flatMap(d => sqlIn(path.join(d, 'migrations')))
  return files.sort((a, b) => (path.basename(a) < path.basename(b) ? -1 : 1))
}
