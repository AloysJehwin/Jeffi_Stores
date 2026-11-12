import fs from 'fs'
import path from 'path'
import { repoRoot } from '@/lib/shared/paths'

// The SQL files of every database/ folder (repo root, each service, each package). The same discovery as
// scripts/db-files.mjs, which the release scripts use; tests/lib/db-files.test.ts keeps the two equal.

export type SchemaSet = 'platform' | 'control-plane'

/** Files that reference tables, in the manifest's load order (foreign keys once every key they point at exists). */
export const MANIFEST_TAIL = ['functions.sql', 'triggers.sql', 'indexes.sql', 'constraints.sql', 'foreign-keys.sql']

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

/** extensions.sql, every tables/*.sql, then each `tail` file across the owners, in that order. */
export function schemaFiles(set: SchemaSet = 'platform', tail: string[] = MANIFEST_TAIL, root = repoRoot()): string[] {
  const dirs = databaseDirs(root)
    .map(d => (set === 'control-plane' ? path.join(d, 'control-plane') : d))
    .filter(isDir)
  const out = set === 'platform' ? [path.join(root, 'database', 'extensions.sql')].filter(f => fs.existsSync(f)) : []
  for (const d of dirs) out.push(...sqlIn(path.join(d, 'tables')))
  for (const t of tail) for (const d of dirs) if (fs.existsSync(path.join(d, t))) out.push(path.join(d, t))
  return out
}

/** Every migrations/*.sql, all owners merged and sorted by basename. schema_migrations records the basename, so one may exist once. */
export function migrationFiles(root = repoRoot()): string[] {
  const files = databaseDirs(root).flatMap(d => sqlIn(path.join(d, 'migrations')))
  const seen = new Map<string, string>()
  for (const f of files) {
    const b = path.basename(f)
    if (seen.has(b)) throw new Error(`duplicate migration basename ${b}: ${seen.get(b)} and ${f}`)
    seen.set(b, f)
  }
  return files.sort((a, b) => (path.basename(a) < path.basename(b) ? -1 : 1))
}
