import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { APPLY_ORDER, buildTenantSchemaSql } from '@controller/lib/tenant-migrations-schema'

describe('tenant schema file list', () => {
  it('includes every database/*.sql topic file, so new tables reach tenant DBs', () => {
    const files = fs.readdirSync(path.join(process.cwd(), 'database')).filter(f => f.endsWith('.sql'))
    expect(files.filter(f => !APPLY_ORDER.includes(f))).toEqual([])
  })
  it('creates the Google Ads tables before their constraints', () => {
    const sql = buildTenantSchemaSql()
    const create = sql.search(/CREATE TABLE (IF NOT EXISTS )?public\.ads_account\b/)
    expect(create).toBeGreaterThan(-1)
    expect(create).toBeLessThan(sql.indexOf('ads_account_pkey'))
  })
})
