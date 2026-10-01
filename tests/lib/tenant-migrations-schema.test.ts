/**
 * The desired-state schema is re-applied to every tenant on each new git SHA, as a single
 * multi-statement query that Postgres aborts on first error. One "already exists" therefore
 * fails the whole migration for that tenant — so every statement the builder emits has to
 * survive a second apply.
 *
 * These assert the shape of the generated SQL. The behavioural proof is applying it three
 * times to a real database, which was done by hand; this catches a regression in the builder
 * without needing a live Postgres in CI.
 */
import { describe, it, expect } from 'vitest'
import { buildTenantSchemaSql, parseCreateTables, desiredTableColumns } from '@/lib/tenant-migrations-schema'

const sql = buildTenantSchemaSql()

/** Statements inside a guard are indented by the builder; bare ones start the line. */
const bareAtLineStart = (re: RegExp) => (sql.match(re) ?? []).length

describe('buildTenantSchemaSql — re-apply safety', () => {
  it('emits a non-trivial schema', () => {
    expect(sql.length).toBeGreaterThan(100_000)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\./)
  })

  it('leaves no CREATE TABLE without IF NOT EXISTS', () => {
    expect(bareAtLineStart(/^\s*CREATE TABLE (?!IF NOT EXISTS)/gim)).toBe(0)
  })

  it('leaves no CREATE INDEX without IF NOT EXISTS', () => {
    expect(bareAtLineStart(/^\s*CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/gim)).toBe(0)
  })

  it('leaves no CREATE SEQUENCE without IF NOT EXISTS', () => {
    expect(bareAtLineStart(/^\s*CREATE SEQUENCE (?!IF NOT EXISTS)/gim)).toBe(0)
  })

  // No CREATE TRIGGER IF NOT EXISTS exists in Postgres, so each is preceded by a DROP.
  it('precedes every trigger with DROP TRIGGER IF EXISTS', () => {
    const creates = (sql.match(/CREATE TRIGGER/gi) ?? []).length
    const drops = (sql.match(/DROP TRIGGER IF EXISTS/gi) ?? []).length
    expect(creates).toBeGreaterThan(0)
    expect(drops).toBe(creates)
  })

  // An existence guard would keep a stale body forever; OR REPLACE lets a change land.
  it('declares functions with CREATE OR REPLACE', () => {
    expect(bareAtLineStart(/^\s*CREATE FUNCTION /gim)).toBe(0)
  })

  // Guarded rather than dropped: dropping a PK or UNIQUE that live FKs reference fails.
  it('guards every non-foreign-key constraint on existence', () => {
    const guards = (sql.match(/DO \$\$ BEGIN[\s\S]*?FROM pg_constraint WHERE conname/g) ?? []).length
    expect(guards).toBeGreaterThan(100)
    expect(sql).toMatch(/IF to_regclass\('public\.[a-z_]+'\) IS NOT NULL AND NOT EXISTS/)
  })

  // Foreign keys keep DROP-then-ADD so a redefinition actually takes effect, and are emitted
  // last so the PK/UNIQUE they reference already exists.
  it('hoists foreign keys to the end, each with its own DROP IF EXISTS', () => {
    const marker = sql.indexOf('deferred foreign keys')
    expect(marker).toBeGreaterThan(0)
    const tail = sql.slice(marker)
    expect(tail).toMatch(/DROP CONSTRAINT IF EXISTS/)
    expect(tail).toMatch(/FOREIGN KEY/)
  })

  it('strips psql meta-commands the pg driver cannot parse', () => {
    expect(sql).not.toMatch(/^\s*\\(restrict|unrestrict|connect)/m)
  })

  // COMMENT ON EXTENSION requires owning the extension; on a tenant RDS rds_superuser owns it,
  // so the app role running the fan-out fails with "must be owner of extension". The comment is
  // a cosmetic pg_dump artifact — drop it, but keep CREATE EXTENSION (the role may create).
  it('strips COMMENT ON EXTENSION but keeps CREATE EXTENSION', () => {
    expect(sql).not.toMatch(/COMMENT ON EXTENSION/i)
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm/i)
  })
})

// CREATE TABLE IF NOT EXISTS is a no-op on a table a tenant already has, so a column added to
// an existing table's definition never lands without an explicit ADD COLUMN. This pass reconciles.
describe('buildTenantSchemaSql — column reconcile on existing tables', () => {
  // Reconciliation now follows each CREATE TABLE (see the ordering suite below), so the whole
  // script is the haystack rather than a trailing section.
  const reconcileTail = sql

  it('emits a reconcile block after each table with ADD COLUMN IF NOT EXISTS', () => {
    expect(sql.indexOf('-- reconcile columns on a pre-existing public.')).toBeGreaterThan(0)
    expect(reconcileTail).toMatch(/ALTER TABLE .* ADD COLUMN IF NOT EXISTS/)
  })

  it('reconciles the sub-variant shipping-physical columns (the confirmed drift case)', () => {
    for (const col of ['weight_grams', 'length_cm', 'breadth_cm', 'height_cm', 'package_type']) {
      expect(reconcileTail).toMatch(
        new RegExp(`ALTER TABLE public\\.product_sub_variants ADD COLUMN IF NOT EXISTS ${col}\\b`)
      )
    }
  })

  it('keeps a column type with a comma (numeric(6,2)) intact — no split mid-type', () => {
    expect(reconcileTail).toMatch(/ADD COLUMN IF NOT EXISTS length_cm numeric\(6,2\)/)
  })

  it('strips NOT NULL so the ADD COLUMN is safe on a populated table', () => {
    const addColumnLines = reconcileTail.split('\n').filter(l => l.includes('ADD COLUMN IF NOT EXISTS'))
    expect(addColumnLines.length).toBeGreaterThan(0)
    expect(addColumnLines.some(l => /NOT\s+NULL/i.test(l))).toBe(false)
  })

  it('does not emit ADD COLUMN for table-level constraints', () => {
    expect(reconcileTail).not.toMatch(/ADD COLUMN IF NOT EXISTS (CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK)\b/i)
  })
})

describe('buildTenantSchemaSql — column reconciliation ordering', () => {
  const firstIndex = (re: RegExp) => {
    const m = re.exec(sql)
    return m ? m.index : -1
  }

  it('adds every declared column right after its CREATE TABLE, before any constraint or index on it', () => {
    const tables = [
      ...new Set([...sql.matchAll(/ALTER TABLE (public\.[a-z0-9_]+) ADD COLUMN IF NOT EXISTS/g)].map(m => m[1])),
    ]
    expect(tables.length).toBeGreaterThan(50)
    for (const table of tables) {
      const bare = table.replace('public.', '')
      const addCol = firstIndex(new RegExp(`ALTER TABLE ${table.replace('.', '\\.')} ADD COLUMN IF NOT EXISTS`))
      const create = firstIndex(new RegExp(`CREATE TABLE IF NOT EXISTS ${table.replace('.', '\\.')}\\s*\\(`))
      expect(addCol, table).toBeGreaterThan(create)
      const firstConstraint = firstIndex(
        new RegExp(`ALTER TABLE (ONLY )?${table.replace('.', '\\.')}\\s+ADD CONSTRAINT`)
      )
      const firstIdx = firstIndex(
        new RegExp(`CREATE (UNIQUE )?INDEX IF NOT EXISTS [a-z0-9_]+ ON ${table.replace('.', '\\.')}`)
      )
      if (firstConstraint !== -1)
        expect(addCol, `${bare} constraint before column reconciliation`).toBeLessThan(firstConstraint)
      if (firstIdx !== -1) expect(addCol, `${bare} index before column reconciliation`).toBeLessThan(firstIdx)
    }
  })

  it('reconciles customer_notes.source before the CHECK that references it (the 2026-09-24 live failure)', () => {
    const addSource = sql.indexOf('ALTER TABLE public.customer_notes ADD COLUMN IF NOT EXISTS source ')
    const check = sql.indexOf('ADD CONSTRAINT customer_notes_source_check')
    const partialIdx = sql.indexOf('idx_customer_notes_shared')
    expect(addSource).toBeGreaterThan(-1)
    expect(check).toBeGreaterThan(addSource)
    expect(partialIdx).toBeGreaterThan(addSource)
  })

  it('does not leave a trailing end-of-script reconciliation block', () => {
    expect(sql).not.toContain('reconcile columns on pre-existing tables')
  })

  it('drops and re-adds CHECK constraints so a changed rule lands, while PRIMARY KEYs keep the existence guard', () => {
    const block = sql.slice(
      sql.indexOf('DROP CONSTRAINT IF EXISTS customer_notes_source_check'),
      sql.indexOf('ADD CONSTRAINT customer_notes_source_check')
    )
    expect(block.length).toBeGreaterThan(0)
    expect(block.length).toBeLessThan(200)
    expect(sql).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM pg_constraint WHERE conname = 'customer_notes_pkey'/)
    expect(sql).not.toMatch(/DROP CONSTRAINT IF EXISTS customer_notes_pkey/)
  })
})

describe('parseCreateTables', () => {
  it('keeps columns that follow an inline comment line and skips table-level constraints', () => {
    const [t] = parseCreateTables(`CREATE TABLE public.demo (
    id uuid NOT NULL,
    -- Physical attributes
    color character varying(100),
    weight numeric(10,2) DEFAULT 0, -- grams
    CONSTRAINT demo_check CHECK ((weight >= (0)::numeric)),
    CHECK (id IS NOT NULL)
);`)
    expect(t.table).toBe('public.demo')
    expect(t.columns.map(c => c.name)).toEqual(['id', 'color', 'weight'])
    expect(t.columns[0].type).toBe('uuid')
    expect(t.columns[2].type).toBe('numeric(10,2) DEFAULT 0')
  })

  it('the real catalog: products columns declared under comment headings are reconciled', () => {
    const cols = desiredTableColumns().get('products') ?? []
    expect(cols).toEqual(expect.arrayContaining(['sku', 'color', 'barcode', 'fragile', 'meta_title', 'is_draft']))
    expect(sql).toContain('ALTER TABLE public.products ADD COLUMN IF NOT EXISTS color character varying(100);')
  })
})
