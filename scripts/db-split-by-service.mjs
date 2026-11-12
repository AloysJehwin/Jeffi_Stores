#!/usr/bin/env node
// One-off: split the old root database/ folder into <service>/database/ by owning service. Kept for the record.
//   git archive HEAD database | tar -x -C <tmp>
//   node scripts/db-split-by-service.mjs --src <tmp>/database [--dry]
// Statements are routed by the table they target and keep their source order inside each destination file.
// Ownership rules are in decideOwners(); docs/DATABASE_OWNERSHIP.md is written from the same data.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = n => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1] }
const SRC = path.resolve(arg('--src') || 'database')
const DRY = process.argv.includes('--dry')
const TAIL = ['constraints.sql', 'indexes.sql', 'functions.sql', 'triggers.sql']
const FALLBACK = 'admin-service'
// The user's call, not the write counts: these topic files belong to the service named for them.
const DECREED = { 'messaging.sql': 'messaging-service', 'documents.sql': 'document-service', 'drive.sql': 'document-service' }

// ── SQL → chunks (leading comments + one statement) ──────────────────────────
function chunks(sql) {
  const out = []
  let start = 0, i = 0, state = 'n', tag = '', sawCode = false
  const push = end => { out.push(sql.slice(start, end)); start = end; sawCode = false }
  while (i < sql.length) {
    const c = sql[i]
    if (state === 'n') {
      if (c === '-' && sql[i + 1] === '-') { const e = sql.indexOf('\n', i); i = e === -1 ? sql.length : e; continue }
      if (c === '\\' && !sawCode && (i === 0 || sql[i - 1] === '\n')) { // psql meta-command line: dropped
        const e = sql.indexOf('\n', i); const end = e === -1 ? sql.length : e + 1
        sql = sql.slice(0, i) + sql.slice(end); continue
      }
      if (c === "'") { state = 'q'; sawCode = true; i++; continue }
      if (c === '$') { const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 64)); if (m) { state = 'd'; tag = m[0]; sawCode = true; i += tag.length; continue } }
      if (c === ';') { const e = sql.indexOf('\n', i); push(e === -1 ? sql.length : e + 1); i = start; continue }
      if (!/\s/.test(c)) sawCode = true
      i++
    } else if (state === 'q') {
      if (c === "'") { if (sql[i + 1] === "'") i += 2; else { state = 'n'; i++ } } else i++
    } else {
      if (sql.startsWith(tag, i)) { state = 'n'; i += tag.length } else i++
    }
  }
  if (start < sql.length && sql.slice(start).trim()) out.push(sql.slice(start)) // trailing comments
  return out
}
const code = chunk => chunk.replace(/^\s*--[^\n]*\n?/gm, '').trim()
const N = '(?:public\\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?'

// ── What a statement targets ─────────────────────────────────────────────────
function describe(chunk) {
  const s = code(chunk)
  let m
  if (!s) return { kind: 'comment' }
  if ((m = new RegExp(`^CREATE TABLE (?:IF NOT EXISTS )?${N}`, 'i').exec(s))) return { kind: 'table', table: m[1] }
  if ((m = new RegExp(`^CREATE SEQUENCE (?:IF NOT EXISTS )?${N}`, 'i').exec(s))) return { kind: 'sequence', sequence: m[1] }
  if ((m = new RegExp(`^ALTER SEQUENCE ${N}\\s+OWNED BY ${N}\\.`, 'i').exec(s))) return { kind: 'seq-owner', sequence: m[1], table: m[2] }
  if ((m = new RegExp(`^ALTER SEQUENCE ${N}`, 'i').exec(s))) return { kind: 'seq-alter', sequence: m[1] }
  if ((m = new RegExp(`^ALTER TABLE (?:IF EXISTS )?(?:ONLY )?${N}`, 'i').exec(s))) {
    const con = /\b(ADD|DROP) CONSTRAINT (?:IF EXISTS )?"?([A-Za-z0-9_]+)"?/i.exec(s)
    return { kind: 'alter', table: m[1], fk: /\bADD CONSTRAINT\b[\s\S]*\bFOREIGN KEY\b/i.test(s), constraint: con?.[2], drop: con?.[1].toUpperCase() === 'DROP', addColumn: /\bADD COLUMN\b|\bALTER COLUMN\b/i.test(s) && !con }
  }
  if ((m = new RegExp(`^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF NOT EXISTS\\s+)?"?([A-Za-z0-9_]+)"?\\s+ON\\s+(?:ONLY\\s+)?${N}`, 'i').exec(s))) return { kind: 'index', index: m[1], table: m[2] }
  if ((m = new RegExp(`^CREATE (?:OR REPLACE )?(?:CONSTRAINT )?TRIGGER \\S+[\\s\\S]*? ON ${N}[\\s\\S]*?EXECUTE (?:FUNCTION|PROCEDURE) ${N}`, 'i').exec(s))) return { kind: 'trigger', table: m[1], fn: m[2] }
  if ((m = new RegExp(`^CREATE (?:OR REPLACE )?FUNCTION ${N}`, 'i').exec(s))) return { kind: 'function', fn: m[1] }
  if ((m = new RegExp(`^COMMENT ON (?:TABLE|COLUMN) ${N}`, 'i').exec(s))) return { kind: 'comment-on', table: m[1] }
  if ((m = new RegExp(`^COMMENT ON (?:CONSTRAINT|TRIGGER) \\S+ ON ${N}`, 'i').exec(s))) return { kind: 'comment-on', table: m[1] }
  if ((m = new RegExp(`^COMMENT ON INDEX ${N}`, 'i').exec(s))) return { kind: 'comment-on', index: m[1] }
  if ((m = new RegExp(`^COMMENT ON SEQUENCE ${N}`, 'i').exec(s))) return { kind: 'comment-on', sequence: m[1] }
  if ((m = new RegExp(`^COMMENT ON FUNCTION ${N}`, 'i').exec(s))) return { kind: 'comment-on', fn: m[1] }
  if ((m = new RegExp(`^(?:UPDATE|INSERT INTO|DELETE FROM) ${N}`, 'i').exec(s))) return { kind: 'dml', table: m[1] }
  if (/^DO\b/i.test(s) && (m = new RegExp(`ALTER TABLE (?:IF EXISTS )?(?:ONLY )?${N}`, 'i').exec(s))) return { kind: 'do', table: m[1] }
  if (/^SET\b/i.test(s)) return { kind: 'set' }
  if (/^CREATE EXTENSION\b|^COMMENT ON EXTENSION\b/i.test(s)) return { kind: 'extension' }
  return { kind: 'unknown' }
}

// ── Read the old tree ────────────────────────────────────────────────────────
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8')
const topicFiles = fs.readdirSync(SRC).filter(f => f.endsWith('.sql') && f !== 'extensions.sql' && !TAIL.includes(f)).sort()
const platform = [...topicFiles, ...TAIL].map(file => ({ file, items: chunks(read(file)).map(text => ({ text, d: describe(text) })) }))
const controlPlane = [{ file: 'control-plane/schema.sql', items: chunks(read('control-plane/schema.sql')).map(text => ({ text, d: describe(text) })) }]

const topicOf = new Map(), cpTables = new Set()
for (const { file, items } of platform) for (const { d } of items) if (d.kind === 'table') topicOf.set(d.table, file)
for (const { items } of controlPlane) for (const { d } of items) if (d.kind === 'table') cpTables.add(d.table)
for (const t of cpTables) if (topicOf.has(t)) throw new Error(`${t} is in both the platform and the control-plane set`)

// ── Ownership ────────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'db-split-'))
fs.writeFileSync(path.join(tmp, 'tables.txt'), [...topicOf.keys(), ...cpTables].join('\n'))
const evidence = JSON.parse(execFileSync('node', [path.join(ROOT, 'scripts', 'db-ownership-evidence.mjs'), path.join(tmp, 'tables.txt')], { maxBuffer: 1 << 28 }).toString())
const fmt = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s.replace('-service', '')} ${n}`).join(', ')

function decideOwners() {
  const owner = new Map(), why = new Map(), undecided = []
  for (const t of cpTables) { owner.set(t, 'controller-service'); why.set(t, 'control-plane set') }
  for (const [t, topic] of topicOf) {
    const ev = evidence[t]
    const tally = fmt(ev.total) || 'no writes found'
    if (DECREED[topic]) { owner.set(t, DECREED[topic]); why.set(t, `${topic} belongs to ${DECREED[topic]} (writes: ${tally})`); continue }
    // The controller only seeds or mirrors store tables; it counts when nothing else writes the table (and more than once).
    let ranked = Object.entries(ev.total).sort((a, b) => b[1] - a[1] || (ev.direct[b[0]] || 0) - (ev.direct[a[0]] || 0))
    const stores = ranked.filter(([s]) => s !== 'controller-service')
    ranked = stores.length ? stores : ranked.filter(([, n]) => n > 1)
    if (!ranked.length) { undecided.push({ t, topic, leaders: null, tally }); continue }
    const [top, second] = ranked
    const close = second && (top[1] - second[1] <= 1 || second[1] >= top[1] * 0.8)
    if (close) { undecided.push({ t, topic, leaders: ranked.filter(([, n]) => top[1] - n <= 1 || n >= top[1] * 0.8).map(([s]) => s), tally }); continue }
    owner.set(t, top[0]); why.set(t, `writes: ${tally}`)
  }
  // Close calls and tables nobody writes follow the service that owns most of their topic file.
  const majority = topic => {
    const n = {}
    for (const [t, o] of owner) if (topicOf.get(t) === topic) n[o] = (n[o] || 0) + 1
    return Object.entries(n).sort((a, b) => b[1] - a[1]).map(([s]) => s)
  }
  for (const { t, topic, leaders, tally } of undecided) {
    const order = majority(topic)
    const pick = leaders ? order.find(s => leaders.includes(s)) || leaders[0] : order[0] || FALLBACK
    owner.set(t, pick)
    why.set(t, leaders ? `close call (${tally}); ${topic} is mostly ${pick}` : `${tally}; follows ${topic}`)
  }
  return { owner, why }
}
const { owner, why } = decideOwners()

// ── Lookups for statements that do not name a table ──────────────────────────
const seqTable = new Map(), indexTable = new Map(), fnTables = new Map(), fkNames = new Set()
for (const { items } of [...platform, ...controlPlane]) {
  let lastTable = null
  for (const { text, d } of items) {
    if (d.kind === 'table') { lastTable = d.table; for (const m of text.matchAll(/nextval\('(?:public\.)?([A-Za-z0-9_]+)'/g)) if (!seqTable.has(m[1])) seqTable.set(m[1], d.table) }
    if (d.kind === 'seq-owner') seqTable.set(d.sequence, d.table)
    if (d.kind === 'sequence' && !seqTable.has(d.sequence)) seqTable.set(d.sequence, `~${lastTable}`) // provisional: the table before it
    if (d.kind === 'alter') for (const m of text.matchAll(/nextval\('(?:public\.)?([A-Za-z0-9_]+)'/g)) seqTable.set(m[1], d.table)
    if (d.kind === 'index') indexTable.set(d.index, d.table)
    if (d.kind === 'trigger') fnTables.set(d.fn, (fnTables.get(d.fn) || new Set()).add(d.table))
    if (d.kind === 'alter' && d.fk) fkNames.add(d.constraint)
  }
}
const ownerOfTable = t => owner.get(t) || null
function ownerOf(d, text) {
  if (d.kind === 'dml') { // data statements go where every table they name already exists: the owner loaded last
    const owners = [...text.matchAll(/\bpublic\.([A-Za-z0-9_]+)/g)].map(m => ownerOfTable(m[1])).filter(Boolean).sort()
    if (owners.length) return owners[owners.length - 1]
  }
  if (d.table) return ownerOfTable(d.table)
  if (d.sequence) return ownerOfTable((seqTable.get(d.sequence) || '').replace(/^~/, ''))
  if (d.index) return ownerOfTable(indexTable.get(d.index))
  if (d.fn) { const owners = new Set([...(fnTables.get(d.fn) || [])].map(ownerOfTable)); return owners.size === 1 ? [...owners][0] : FALLBACK }
  return null
}

// ── Route ────────────────────────────────────────────────────────────────────
const outFiles = new Map() // relative path -> chunk[]
const notes = []
const emit = (rel, text) => { if (!outFiles.has(rel)) outFiles.set(rel, []); outFiles.get(rel).push(text) }
const isFkStatement = d => d.kind === 'alter' && (d.fk || (d.drop && fkNames.has(d.constraint)))

function route(sets, base, destFor) {
  for (const { file, items } of sets) {
    let last = null
    for (const { text, d } of items) {
      let o = d.kind === 'comment' ? last?.o : ownerOf(d, text)
      if (!o) { o = base.fixedOwner || FALLBACK; if (!['set', 'comment', 'extension'].includes(d.kind)) notes.push(`no owner found, sent to ${o}: ${file}: ${code(text).split('\n')[0].slice(0, 100)}`) }
      const rel = d.kind === 'comment' && last ? last.rel : path.join(o, 'database', base.sub, destFor(file, d))
      emit(rel, text)
      last = { o, rel }
    }
  }
}
route(platform, { sub: '' }, (file, d) => (isFkStatement(d) ? 'foreign-keys.sql' : TAIL.includes(file) ? file : path.join('tables', file)))
route(controlPlane, { sub: 'control-plane', fixedOwner: 'controller-service' }, (_file, d) =>
  isFkStatement(d) ? 'foreign-keys.sql' : d.kind === 'index' ? 'indexes.sql' : d.kind === 'alter' && d.constraint ? 'constraints.sql' : d.kind === 'function' ? 'functions.sql' : d.kind === 'trigger' ? 'triggers.sql' : path.join('tables', 'control-plane.sql'))

// Migrations go to the owner of most of the tables they name; basenames are kept (schema_migrations records them).
// Only these four moved: the other 17 were applied everywhere and their end state is in the schema files, so they
// were deleted in the same change. These leave indexes the schema files do not declare.
const KEPT_MIGRATIONS = ['draft-system-phase1.sql', 'pending-payment-intents.sql', 'product-drafts-jsonb.sql', 'product-supplier.sql']
const copies = []
for (const f of KEPT_MIGRATIONS) {
  const sql = read(path.join('migrations', f)).replace(/--[^\n]*/g, '')
  const n = {}
  for (const m of sql.matchAll(new RegExp(`(?:ALTER TABLE (?:IF EXISTS )?(?:ONLY )?|CREATE TABLE (?:IF NOT EXISTS )?|UPDATE |INSERT INTO |DELETE FROM |DROP TABLE (?:IF EXISTS )?| ON )${N}`, 'gi'))) {
    const o = owner.get(m[1]); if (o) n[o] = (n[o] || 0) + 1
  }
  const o = Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || FALLBACK
  copies.push([path.join('migrations', f), path.join(o, 'database', 'migrations', f)])
}
copies.push([path.join('control-plane', 'seed-plans.sql'), path.join('controller-service', 'database', 'seeds', 'seed-plans.sql')])
// The retired per-service databases' schema: nothing loads these (the manifest ignores legacy/).
copies.push([path.join('messaging', 'schema.sql'), path.join('messaging-service', 'database', 'legacy', 'schema.sql')])
copies.push([path.join('messaging', 'seed-system-templates.sql'), path.join('messaging-service', 'database', 'legacy', 'seed-system-templates.sql')])
copies.push([path.join('documents', 'schema.sql'), path.join('document-service', 'database', 'legacy', 'schema.sql')])

// ── Report + write ───────────────────────────────────────────────────────────
const byOwner = {}
for (const [t, o] of owner) { byOwner[o] ??= { platform: 0, controlPlane: 0 }; byOwner[o][cpTables.has(t) ? 'controlPlane' : 'platform']++ }
console.log('tables per owner:', JSON.stringify(byOwner, null, 1))
for (const n of notes) console.log('note:', n)
if (DRY) process.exit(0)

const header = rel => {
  const kind = rel.includes(`${path.sep}tables${path.sep}`) ? 'tables' : path.basename(rel, '.sql')
  return `-- ${rel.split(path.sep)[0]}: ${kind}${rel.includes('control-plane') ? ' (control-plane set)' : ''}. Load order comes from scripts/db-files.mjs.\n\n`
}
for (const [rel, parts] of outFiles) {
  const body = parts.join('').replace(/^\n+/, '').replace(/\s*$/, '\n')
  fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true })
  fs.writeFileSync(path.join(ROOT, rel), header(rel) + body)
}
for (const [from, to] of copies) {
  fs.mkdirSync(path.dirname(path.join(ROOT, to)), { recursive: true })
  fs.copyFileSync(path.join(SRC, from), path.join(ROOT, to))
}

const services = [...new Set(owner.values())].sort()
const doc = [
  '# Database ownership', '',
  'Every table lives in the `database/` folder of the service that owns it; `scripts/db-files.mjs` assembles them in load',
  'order for the release pipeline. One database still holds them all (see `MICROSERVICES.md`).', '',
  'How the owner was picked (`scripts/db-split-by-service.mjs`, evidence from `scripts/db-ownership-evidence.mjs`):', '',
  '1. Control-plane tables (the old `database/control-plane/schema.sql`) belong to `controller-service`.',
  '2. `messaging.sql` belongs to `messaging-service`; `documents.sql` and `drive.sql` to `document-service`.',
  '3. Otherwise the service whose code writes the table most: `INSERT`/`UPDATE`/`DELETE` statements in its own `src`, plus',
  '   those in `packages/*` credited to the service whose routes import that file most closely. The B2B portal\'s API',
  '   routes (`storefront-service/src/app/api/(public)/business`) count for `business-service`. The controller counts',
  '   for a store table only when no store service writes it.',
  '4. A close call (top two within one statement or 20%) or a table nobody writes follows the owner of most of its topic file.', '',
  '| Owner | Store tables | Control-plane tables |', '| --- | ---: | ---: |',
  ...services.map(s => `| ${s} | ${byOwner[s].platform} | ${byOwner[s].controlPlane} |`), '',
  ...services.flatMap(s => [
    `## ${s}`, '', '| Table | File | Evidence |', '| --- | --- | --- |',
    ...[...owner].filter(([, o]) => o === s).sort((a, b) => a[0].localeCompare(b[0])).map(([t]) =>
      `| \`${t}\` | \`${cpTables.has(t) ? 'control-plane/tables/control-plane.sql' : `tables/${topicOf.get(t)}`}\` | ${why.get(t)} |`), '',
  ]),
].join('\n')
fs.writeFileSync(path.join(ROOT, 'docs', 'DATABASE_OWNERSHIP.md'), doc)
console.log(`wrote ${outFiles.size} schema files, ${copies.length} copied files, docs/DATABASE_OWNERSHIP.md`)
