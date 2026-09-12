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
import { buildTenantSchemaSql } from '@/lib/tenant-migrations-schema'

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
  const marker = sql.indexOf('reconcile columns on pre-existing tables')
  const reconcileTail = marker > 0 ? sql.slice(marker) : ''

  it('emits a reconcile section with ADD COLUMN IF NOT EXISTS', () => {
    expect(marker).toBeGreaterThan(0)
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
