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
  return hoistForeignKeys(parts.join('\n\n'))
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
