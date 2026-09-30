import fs from 'fs'
import path from 'path'

// Shared desired-state schema builder — used by BOTH the migration fan-out
// (tenant-migrations.ts) and the AWS provisioning provider's loadSchema.
// Ordering matters: extensions → tables → constraints → indexes → functions → triggers.

const APPLY_ORDER = [
  'extensions.sql',
  'auth.sql',
  'users.sql',
  'catalog.sql',
  'inventory.sql',
  'orders.sql',
  'payments.sql',
  'invoices.sql',
  'quotations.sql',
  'crm.sql',
  'marketing.sql',
  'reviews.sql',
  'support.sql',
  'logs.sql',
  'settings.sql',
  'ai.sql',
  'amazon.sql',
  'constraints.sql',
  'indexes.sql',
  'functions.sql',
  'triggers.sql',
]

export function buildTenantSchemaSql(): string {
  const dir = path.join(process.cwd(), 'database')
  const parts: string[] = []
  for (const file of APPLY_ORDER) {
    const p = path.join(dir, file)
    if (fs.existsSync(p)) {
      parts.push(`-- ==== ${file} ====\n${stripPsqlMetaCommands(fs.readFileSync(p, 'utf8'))}`)
    }
  }
  const raw = stripExtensionComments(parts.join('\n\n'))
  return guardNonFkConstraints(makeCreatesIdempotent(hoistForeignKeys(syncTableColumns(raw))))
}

export interface DesiredColumn {
  name: string
  type: string
}
export interface DesiredTable {
  table: string
  columns: DesiredColumn[]
}

const CREATE_TABLE_RE = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?((?:[A-Za-z0-9_]+\.)?[A-Za-z0-9_]+)\s*\(([\s\S]*?)\n\);/gi
const CONSTRAINT_LEADERS = /^(CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|EXCLUDE|LIKE)\b/i

/**
 * Every `CREATE TABLE public.<name> (...)` in the schema files with the columns it declares.
 * `--` comment lines inside a body (the hand-written catalog.sql groups columns under them) are
 * stripped first: an item that started with a comment used to fail the name match and the column
 * after it silently dropped out of the reconciliation. NOT NULL is removed from the type (adding a
 * NOT NULL column with no default to a populated table errors); a DEFAULT is kept so it backfills.
 */
export function parseCreateTables(sql: string): DesiredTable[] {
  const out: DesiredTable[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(CREATE_TABLE_RE.source, CREATE_TABLE_RE.flags)
  while ((m = re.exec(sql)) !== null) {
    const columns: DesiredColumn[] = []
    const body = m[2].replace(/--[^\n]*/g, '')
    for (const item of splitTopLevel(body)) {
      const line = item.trim()
      if (!line || CONSTRAINT_LEADERS.test(line)) continue
      const nameMatch = line.match(/^("?[A-Za-z0-9_]+"?)\s+(.*)$/s)
      if (!nameMatch) continue
      const type = nameMatch[2]
        .replace(/\bNOT\s+NULL\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!type) continue
      columns.push({ name: nameMatch[1], type })
    }
    out.push({ table: m[1], columns })
  }
  return out
}

/** table name (without the schema prefix, unquoted) → column names, as the schema files declare them. */
export function desiredTableColumns(): Map<string, string[]> {
  const dir = path.join(process.cwd(), 'database')
  const map = new Map<string, string[]>()
  for (const file of APPLY_ORDER) {
    const p = path.join(dir, file)
    if (!fs.existsSync(p)) continue
    for (const t of parseCreateTables(fs.readFileSync(p, 'utf8'))) {
      const bare = t.table.split('.').pop()!.replace(/"/g, '')
      map.set(
        bare,
        t.columns.map(c => c.name.replace(/"/g, ''))
      )
    }
  }
  return map
}

/**
 * Close the fan-out's column-drift hole.
 *
 * makeCreatesIdempotent() rewrites CREATE TABLE → CREATE TABLE IF NOT EXISTS, which is a no-op
 * for a table that already exists on a tenant. So a column ADDED to an existing table's
 * definition after that tenant was first provisioned never lands (confirmed live: product
 * sub-variant physicals absent on an existing tenant). There is no ALTER ... ADD COLUMN anywhere
 * in the files.
 *
 * This pass emits `ALTER TABLE <name> ADD COLUMN IF NOT EXISTS <col> <type>` for each declared
 * column DIRECTLY AFTER its CREATE TABLE. It used to append them all at the end of the script,
 * after constraints.sql and indexes.sql — so a CHECK or partial index on a new column ran before
 * the column existed and aborted the whole batch ("column source does not exist", live on
 * 2026-09-24). Postgres's ADD COLUMN IF NOT EXISTS is natively idempotent, so this is safe on
 * fresh and existing tables alike.
 */
function syncTableColumns(sql: string): string {
  return sql.replace(CREATE_TABLE_RE, stmt => {
    const [parsed] = parseCreateTables(stmt)
    if (!parsed || parsed.columns.length === 0) return stmt
    const alters = parsed.columns.map(c => `ALTER TABLE ${parsed.table} ADD COLUMN IF NOT EXISTS ${c.name} ${c.type};`)
    return `${stmt}\n-- reconcile columns on a pre-existing ${parsed.table}\n${alters.join('\n')}`
  })
}

/**
 * Split a CREATE TABLE body into its top-level comma-separated items, ignoring commas nested
 * inside parentheses (e.g. numeric(6,2), CHECK (x IN ('a','b'))). A naive split on ',' would
 * cut those in half.
 */
function splitTopLevel(body: string): string[] {
  const items: string[] = []
  let depth = 0
  let current = ''
  for (const ch of body) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      items.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) items.push(current)
  return items
}

/**
 * Drop `COMMENT ON EXTENSION ...` statements. On a tenant RDS the extensions are installed by
 * rds_superuser at provisioning, so the app role that runs the fan-out is not their owner —
 * and COMMENT ON EXTENSION requires ownership, failing with "must be owner of extension". Since
 * the whole schema is applied as one batch that aborts on first error, that one cosmetic line
 * (pg_dump artifact, no functional value) fails the entire migration for the tenant. Stripped
 * here rather than in database/extensions.sql so the migra platform diff still sees plain
 * pg_dump output. CREATE EXTENSION IF NOT EXISTS stays — the app role may create, just not own.
 */
function stripExtensionComments(sql: string): string {
  return sql.replace(/^\s*COMMENT ON EXTENSION\b[^;]*;\s*$/gim, '')
}

/**
 * Strip psql meta-command lines (those starting with a backslash, e.g. `\restrict`,
 * `\unrestrict`, `\connect`, `\.`). These are pg_dump/psql artifacts that only the psql
 * CLI understands — the `pg` driver (used by loadSchema over a raw connection) errors on
 * them ("syntax error at or near \"). We apply the schema via a driver, not psql, so they
 * must be removed. Only whole meta-command lines are dropped; SQL is untouched.
 */
function stripPsqlMetaCommands(sql: string): string {
  return sql
    .split('\n')
    .filter(line => !/^\s*\\/.test(line))
    .join('\n')
}

/**
 * Move every `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ...;` statement to the END of
 * the combined script. Some topic files (e.g. orders.sql) declare trailing FK ALTERs that
 * reference tables whose PK/UNIQUE is added later in constraints.sql; applied top-to-bottom
 * as one script that fails ("no unique constraint matching given keys for referenced table").
 * pg_dump restores solve this by adding all FKs last — we do the same, so table/PK order
 * within the files no longer matters. Applied to the whole schema, this fixes live too.
 *
 * We also drop any standalone `ALTER TABLE ... DROP CONSTRAINT IF EXISTS <fk>` lines (their
 * paired ADD is hoisted, so the in-place drop would be orphaned) and dedupe hoisted FKs by
 * constraint name — keeping the LAST definition — because constraints.sql sometimes redefines
 * a FK (drop-if-exists + re-add); after hoisting, emitting both copies would error "already
 * exists". Each hoisted FK is prefixed with its own DROP IF EXISTS to stay re-runnable.
 */
function hoistForeignKeys(sql: string): string {
  const fkAddRe = /ALTER TABLE[^;]*?ADD CONSTRAINT\s+([A-Za-z0-9_]+)[^;]*?FOREIGN KEY[^;]*?;/gis
  // Collect FK adds, keyed by constraint name (last one wins → matches file's final intent).
  const byName = new Map<string, string>()
  let body = sql.replace(fkAddRe, (m, name) => {
    byName.set(name, m.trim())
    return ''
  })
  if (byName.size === 0) return sql
  // Remove now-orphaned `DROP CONSTRAINT IF EXISTS <hoisted-fk>` lines from the body.
  body = body.replace(/ALTER TABLE[^;]*?DROP CONSTRAINT IF EXISTS\s+([A-Za-z0-9_]+)\s*;/gis, (m, name) =>
    byName.has(name) ? '' : m
  )
  // Emit each FK once, self-guarded with a DROP IF EXISTS so re-runs are safe.
  const emitted = [...byName.entries()].map(([name, add]) => {
    const tableMatch = add.match(/ALTER TABLE\s+(?:ONLY\s+)?([A-Za-z0-9_.]+)/i)
    const table = tableMatch?.[1] ?? ''
    return `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name};\n${add}`
  })
  return `${body}\n\n-- ==== deferred foreign keys (hoisted so referenced PK/UNIQUE exist first) ====\n${emitted.join('\n\n')}\n`
}

/**
 * Make every non-foreign-key `ADD CONSTRAINT` re-runnable.
 *
 * The schema files are pg_dump style, so constraints arrive as bare `ALTER TABLE ... ADD
 * CONSTRAINT`, which errors if the constraint is already there. That is invisible while every
 * tenant database is created fresh, but the fan-out re-applies the whole schema on each new
 * git SHA, and it sends it as ONE multi-statement query that Postgres aborts on first error.
 * The first of the 161 non-FK constraints that already exists therefore fails the entire
 * migration for that tenant — every existing tenant, on the next deploy.
 *
 * Guarded by existence rather than the DROP-then-ADD used for foreign keys: dropping a PRIMARY
 * KEY or UNIQUE that live foreign keys reference fails outright ("cannot drop ... because other
 * objects depend on it"). Foreign keys stay on DROP IF EXISTS — dropping one of those is safe,
 * and it lets a redefinition actually take effect.
 *
 * to_regclass() keeps the guard from throwing when a table is genuinely absent, so a missing
 * table surfaces where it is created rather than here.
 *
 * CHECK constraints are the exception: a check carries no data and nothing depends on it, so
 * it is dropped and re-added every run. With the existence guard a changed rule never landed
 * (the same drift the platform schema-diff self-heals with DROP IF EXISTS + ADD).
 */
function guardNonFkConstraints(sql: string): string {
  const addRe = /ALTER TABLE\s+(?:ONLY\s+)?([A-Za-z0-9_.]+)\s+ADD CONSTRAINT\s+([A-Za-z0-9_]+)\b([^;]*);/gis
  return sql.replace(addRe, (stmt, table, name, rest) => {
    if (/FOREIGN KEY/i.test(rest)) return stmt // hoisted, already self-guarded
    if (/\bCHECK\b/i.test(rest)) {
      return [
        'DO $$ BEGIN',
        `  IF to_regclass('${table}') IS NOT NULL THEN`,
        `    ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name};`,
        `    ${stmt.trim()}`,
        '  END IF;',
        'END $$;',
      ].join('\n')
    }
    return [
      'DO $$ BEGIN',
      `  IF to_regclass('${table}') IS NOT NULL AND NOT EXISTS (`,
      `    SELECT 1 FROM pg_constraint WHERE conname = '${name}' AND conrelid = '${table}'::regclass`,
      '  ) THEN',
      `    ${stmt.trim()}`,
      '  END IF;',
      'END $$;',
    ].join('\n')
  })
}

/**
 * Rewrite the pg_dump-style CREATE statements into forms that survive a second apply.
 *
 * The fan-out re-applies the whole desired-state schema on every new git SHA, as a single
 * multi-statement query that Postgres aborts on first error — so one "already exists" fails the
 * migration for that tenant entirely. The files were only ever exercised against fresh
 * databases, so nothing had a guard: 121 CREATE TABLE, 237 CREATE INDEX, 3 CREATE SEQUENCE,
 * 41 CREATE TRIGGER and 13 CREATE FUNCTION were all bare.
 *
 * Rewritten here rather than in database/*.sql because those files are also the desired-state
 * input to migra in the schema-diff pipeline, which compares them against a live database and
 * expects plain pg_dump output.
 *
 * Triggers get DROP-then-CREATE: there is no CREATE TRIGGER IF NOT EXISTS, and re-creating one
 * is harmless. Functions become CREATE OR REPLACE so a changed body actually lands — an
 * existence guard would silently keep the old definition forever.
 */
function makeCreatesIdempotent(sql: string): string {
  let out = sql
  out = out.replace(/CREATE TABLE\s+(?!IF NOT EXISTS)/gi, 'CREATE TABLE IF NOT EXISTS ')
  out = out.replace(
    /CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF NOT EXISTS)/gi,
    (_m, uniq) => `CREATE ${uniq ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS `
  )
  out = out.replace(/CREATE SEQUENCE\s+(?!IF NOT EXISTS)/gi, 'CREATE SEQUENCE IF NOT EXISTS ')
  out = out.replace(/CREATE FUNCTION\s+/gi, 'CREATE OR REPLACE FUNCTION ')
  out = out.replace(
    /CREATE TRIGGER\s+([A-Za-z0-9_]+)([^;]*?\sON\s+([A-Za-z0-9_.]+)[^;]*);/gis,
    (stmt, name, _rest, table) => `DROP TRIGGER IF EXISTS ${name} ON ${table};\n${stmt.trim()}`
  )
  return out
}
