// Shared by check-component-tests.mjs and check-route-tests.mjs.
// Finds which source files are imported by a test, resolving real import specifiers (never path tails):
//   relative paths, `@/` (-> packages/store-core/src) and `@<app>/` (-> <app>-service/src).
// Index files that only re-export are followed, so a test importing a barrel counts its members.
import fs from 'node:fs'
import path from 'node:path'

export const APP_NAMES = ['storefront', 'admin', 'business', 'controller', 'showcase']
export const APPS = APP_NAMES.map((n) => `${n}-service`)
export const STORE_CORE = 'packages/store-core'
const EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs']
const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage', '.git'])

export function walk(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP_DIRS.has(e.name)) return []
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })
}

const rel = (root, f) => path.relative(root, f).split(path.sep).join('/')

// Every *.test / *.spec file under a tests/, integration-tests/ or ui-tests/ dir of the root, store-core,
// the apps and the other packages.
export function testFiles(root) {
  const owners = ['.', STORE_CORE, ...APPS]
  const pkgsDir = path.join(root, 'packages')
  if (fs.existsSync(pkgsDir)) {
    for (const p of fs.readdirSync(pkgsDir)) if (`packages/${p}` !== STORE_CORE) owners.push(`packages/${p}`)
  }
  const dirs = owners.flatMap((o) => ['tests', 'integration-tests', 'ui-tests'].map((d) => path.join(root, o, d)))
  return dirs.flatMap(walk).filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f))
}

function aliasTargets(root) {
  return [
    ...APP_NAMES.map((n) => [`@${n}`, path.join(root, `${n}-service/src`)]),
    ['@', path.join(root, STORE_CORE, 'src')],
  ]
}

function resolveSpecifier(root, aliases, spec, fromDir) {
  let base = null
  if (spec.startsWith('.')) base = path.resolve(fromDir, spec)
  else {
    for (const [key, target] of aliases) {
      if (spec === key || spec.startsWith(`${key}/`)) {
        base = path.join(target, spec.slice(key.length))
        break
      }
    }
  }
  if (!base) return null
  const isFile = (f) => fs.existsSync(f) && fs.statSync(f).isFile()
  if (isFile(base)) return base
  for (const e of EXTS) if (isFile(base + e)) return base + e
  for (const e of EXTS) if (isFile(path.join(base, `index${e}`))) return path.join(base, `index${e}`)
  return null
}

const SPEC_RE = /(?:\bfrom|\bimport|\brequire|\bmock|\bdoMock|\bimportActual|\bimportMock)\s*\(?\s*(['"`])([^'"`\n]+)\1/g
const REEXPORT_RE = /export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*(['"])([^'"]+)\1/g

export function specifiers(src) {
  return [...src.matchAll(SPEC_RE)].map((m) => m[2])
}

// Repo-relative (posix) paths of every file a test imports, directly or through re-export barrels.
export function importedFiles(root) {
  const aliases = aliasTargets(root)
  const found = new Set()
  const followed = new Set()
  const add = (file) => {
    found.add(rel(root, file))
    if (!/^index\./.test(path.basename(file)) || followed.has(file)) return
    followed.add(file)
    const src = fs.readFileSync(file, 'utf8')
    for (const m of src.matchAll(REEXPORT_RE)) {
      const target = resolveSpecifier(root, aliases, m[2], path.dirname(file))
      if (target) add(target)
    }
  }
  for (const t of testFiles(root)) {
    const src = fs.readFileSync(t, 'utf8')
    for (const spec of specifiers(src)) {
      const target = resolveSpecifier(root, aliases, spec, path.dirname(t))
      if (target) add(target)
    }
  }
  return found
}

export function ownerOf(file) {
  if (file.startsWith(`${STORE_CORE}/`)) return 'store-core'
  return file.split('/')[0]
}

export function parseArgs(argv) {
  const opts = { root: null, init: false, prune: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') opts.root = path.resolve(argv[++i])
    else if (argv[i] === '--init') opts.init = true
    else if (argv[i] === '--prune') opts.prune = true
  }
  return opts
}

// Shrink-only allowlist. `items` is every file that must be tested, `tested` the set of imported files.
// Exit 1 on: an untested item not allowlisted, an allowlisted item that is now tested, or one that is gone.
// --init writes the allowlist from the current tree (only when none exists); --prune drops fixed entries.
export function runRatchet({ root, argv, items, tested, allowlistRel, label, plural }) {
  const opts = parseArgs(argv)
  root = opts.root ?? root
  const file = path.join(root, allowlistRel)
  const list = items(root)
  const exists = new Set(list)
  const importedSet = tested(root)
  const untested = list.filter((f) => !importedSet.has(f))

  const groups = (files) => {
    const out = {}
    for (const f of [...files].sort()) (out[ownerOf(f)] ??= []).push(f)
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
  }
  const write = (files) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify({ owners: groups(files) }, null, 2)}\n`)
  }

  if (opts.init) {
    if (fs.existsSync(file)) {
      console.error(`${allowlistRel} already exists; the allowlist only shrinks (use --prune to drop fixed entries).`)
      process.exit(1)
    }
    write(untested)
    console.log(`Wrote ${allowlistRel} with ${untested.length} untested ${plural}.`)
    return
  }

  if (!fs.existsSync(file)) {
    console.error(`${allowlistRel} is missing. Generate it once with --init.`)
    process.exit(1)
  }
  const allowed = new Set(Object.values(JSON.parse(fs.readFileSync(file, 'utf8')).owners ?? {}).flat())

  const added = untested.filter((f) => !allowed.has(f))
  const fixed = [...allowed].filter((f) => exists.has(f) && importedSet.has(f))
  const gone = [...allowed].filter((f) => !exists.has(f))

  if (opts.prune) {
    const keep = [...allowed].filter((f) => exists.has(f) && !importedSet.has(f))
    write(keep)
    console.log(`Pruned ${allowed.size - keep.length} entries; ${keep.length} ${plural} remain allowlisted.`)
    if (added.length) {
      console.error(`${added.length} untested ${plural} are not allowlisted (add a test):`)
      for (const f of added) console.error(`  ${f}`)
      process.exit(1)
    }
    return
  }

  const problems = []
  if (added.length) {
    problems.push(`Untested ${plural} that are not in ${allowlistRel} (add a test, do not add to the allowlist):`, ...added.map((f) => `  ${f}`))
  }
  if (fixed.length) {
    problems.push(`Allowlisted ${plural} that now have a test: remove them from ${allowlistRel} (or run with --prune):`, ...fixed.map((f) => `  ${f}`))
  }
  if (gone.length) {
    problems.push(`Allowlisted ${plural} that no longer exist: remove them from ${allowlistRel}:`, ...gone.map((f) => `  ${f}`))
  }
  if (problems.length) {
    console.error(problems.join('\n'))
    process.exit(1)
  }
  console.log(`Every ${label} has a test or is on the shrink-only allowlist (${allowed.size} allowlisted, ${list.length - untested.length}/${list.length} tested).`)
}
