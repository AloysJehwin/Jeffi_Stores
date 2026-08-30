import fs from 'fs'
import path from 'path'

// Shared desired-state schema builder — used by BOTH the migration fan-out
// (tenant-migrations.ts) and the AWS provisioning provider's loadSchema.
// Ordering matters: extensions → tables → constraints → indexes → functions → triggers.

const APPLY_ORDER = [
  'extensions.sql',
  'auth.sql', 'users.sql', 'catalog.sql', 'inventory.sql', 'orders.sql',
  'payments.sql', 'invoices.sql', 'quotations.sql', 'crm.sql', 'marketing.sql',
  'reviews.sql', 'support.sql', 'logs.sql', 'settings.sql', 'ai.sql', 'amazon.sql',
  'constraints.sql', 'indexes.sql', 'functions.sql', 'triggers.sql',
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
  return guardNonFkConstraints(makeCreatesIdempotent(hoistForeignKeys(parts.join('\n\n'))))
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
    .filter((line) => !/^\s*\\/.test(line))
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
  let body = sql.replace(fkAddRe, (m, name) => { byName.set(name, m.trim()); return '' })
  if (byName.size === 0) return sql
  // Remove now-orphaned `DROP CONSTRAINT IF EXISTS <hoisted-fk>` lines from the body.
  body = body.replace(
    /ALTER TABLE[^;]*?DROP CONSTRAINT IF EXISTS\s+([A-Za-z0-9_]+)\s*;/gis,
    (m, name) => (byName.has(name) ? '' : m),
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
 */
function guardNonFkConstraints(sql: string): string {
  const addRe = /ALTER TABLE\s+(?:ONLY\s+)?([A-Za-z0-9_.]+)\s+ADD CONSTRAINT\s+([A-Za-z0-9_]+)\b([^;]*);/gis
  return sql.replace(addRe, (stmt, table, name, rest) => {
    if (/FOREIGN KEY/i.test(rest)) return stmt   // hoisted, already self-guarded
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
  out = out.replace(/CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF NOT EXISTS)/gi,
    (_m, uniq) => `CREATE ${uniq ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS `)
  out = out.replace(/CREATE SEQUENCE\s+(?!IF NOT EXISTS)/gi, 'CREATE SEQUENCE IF NOT EXISTS ')
  out = out.replace(/CREATE FUNCTION\s+/gi, 'CREATE OR REPLACE FUNCTION ')
  out = out.replace(
    /CREATE TRIGGER\s+([A-Za-z0-9_]+)([^;]*?\sON\s+([A-Za-z0-9_.]+)[^;]*);/gis,
    (stmt, name, _rest, table) => `DROP TRIGGER IF EXISTS ${name} ON ${table};\n${stmt.trim()}`,
  )
  return out
}
