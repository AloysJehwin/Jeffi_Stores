import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { buildTenantSchemaSql, tenantSchemaFiles } from '@controller/lib/tenant-migrations-schema'
import { databaseDirs, migrationFiles, schemaFiles } from '@controller/lib/db-files'

const root = process.cwd()
const manifest = (...args: string[]) =>
  execFileSync('node', [path.join(root, 'scripts', 'db-files.mjs'), ...args, '--abs'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)

describe('schema file manifest', () => {
  it('lists the same files, in the same order, as scripts/db-files.mjs (what the release scripts load)', () => {
    expect(schemaFiles('platform')).toEqual(manifest('platform'))
    expect(schemaFiles('control-plane')).toEqual(manifest('control-plane'))
    expect(migrationFiles()).toEqual(manifest('migrations'))
  })
  it('gives tenant DBs every platform schema file, so new tables reach them', () => {
    const tenant = tenantSchemaFiles()
    expect([...tenant].sort()).toEqual(schemaFiles('platform').sort())
    const tables = databaseDirs().flatMap(d => {
      const dir = path.join(d, 'tables')
      return fs.existsSync(dir) ? fs.readdirSync(dir).map(f => path.join(dir, f)) : []
    })
    expect(tables.length).toBeGreaterThan(0)
    expect(tables.filter(f => !tenant.includes(f))).toEqual([])
  })
  it('keeps the root database/ folder to extensions.sql: a table file there would never be loaded', () => {
    expect(fs.readdirSync(path.join(root, 'database')).filter(f => f.endsWith('.sql'))).toEqual(['extensions.sql'])
  })
  it('creates the Google Ads tables before their constraints', () => {
    const sql = buildTenantSchemaSql()
    const create = sql.search(/CREATE TABLE (IF NOT EXISTS )?public\.ads_account\b/)
    expect(create).toBeGreaterThan(-1)
    expect(create).toBeLessThan(sql.indexOf('ads_account_pkey'))
  })
  it('has no migrations to run when no folder holds one', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'db-files-'))
    fs.mkdirSync(path.join(empty, 'admin-service', 'database', 'migrations'), { recursive: true })
    fs.writeFileSync(path.join(empty, 'admin-service', 'database', 'migrations', 'README.md'), '')
    expect(migrationFiles(empty)).toEqual([])
    fs.rmSync(empty, { recursive: true })
  })
})
