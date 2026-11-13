import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { buildTenantSchemaSql, tenantSchemaFiles } from '@controller/lib/tenant-migrations-schema'
import { databaseDirs, migrationFiles, schemaFiles, PLATFORM_ONLY } from '@controller/lib/db-files'

const root = process.cwd()
const manifest = (...args: string[]) =>
  execFileSync('node', [path.join(root, 'scripts', 'db-files.mjs'), ...args, '--abs'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)

describe('schema file manifest', () => {
  it('lists the same files, in the same order, as scripts/db-files.mjs (what the release scripts load)', () => {
    expect(schemaFiles('platform')).toEqual(manifest('platform'))
    expect(schemaFiles('tenant')).toEqual(manifest('tenant'))
    expect(schemaFiles('control-plane')).toEqual(manifest('control-plane'))
    expect(migrationFiles()).toEqual(manifest('migrations'))
    expect(migrationFiles('tenant')).toEqual(manifest('migrations', 'tenant'))
  })
  it('gives tenant DBs every store schema file and no platform-only one', () => {
    const tenant = tenantSchemaFiles()
    const onlyPlatform = schemaFiles('platform').filter(f => f.includes(`${path.sep}${PLATFORM_ONLY}${path.sep}`))
    expect(onlyPlatform.length).toBeGreaterThan(0)
    expect([...tenant].sort()).toEqual(schemaFiles('platform').filter(f => !onlyPlatform.includes(f)).sort())
    const tables = databaseDirs().flatMap(d => {
      const dir = path.join(d, 'tables')
      return fs.existsSync(dir) ? fs.readdirSync(dir).map(f => path.join(dir, f)) : []
    })
    expect(tables.length).toBeGreaterThan(0)
    expect(tables.filter(f => !tenant.includes(f))).toEqual([])
  })
  it('has no tenant table pointing at a table a tenant DB lacks (platform-only or control-plane)', () => {
    const sql = tenantSchemaFiles().map(f => fs.readFileSync(f, 'utf8').replace(/--[^\n]*/g, '')).join('\n')
    const created = new Set([...sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?"?(\w+)/gi)].map(m => m[1]))
    const refs = [...sql.matchAll(/\bREFERENCES\s+(?:public\.)?"?(\w+)/gi)].map(m => m[1])
    expect(refs.length).toBeGreaterThan(0)
    expect([...new Set(refs.filter(r => !created.has(r)))]).toEqual([])
  })
  it('keeps tenant migrations off platform-only and control-plane tables', () => {
    const tenantTables = new Set(
      tenantSchemaFiles().flatMap(f => [...fs.readFileSync(f, 'utf8').matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?"?(\w+)/gi)].map(m => m[1]))
    )
    const flagshipOnly = [...schemaFiles('platform'), ...schemaFiles('control-plane')]
      .flatMap(f => [...fs.readFileSync(f, 'utf8').matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?"?(\w+)/gi)].map(m => m[1]))
      .filter(t => !tenantTables.has(t))
    expect(flagshipOnly.length).toBeGreaterThan(0)
    const touched = migrationFiles('tenant').flatMap(f => {
      const body = fs.readFileSync(f, 'utf8').replace(/--[^\n]*/g, '')
      return flagshipOnly.filter(t => new RegExp(`\\b(?:public\\.)?${t}\\b`, 'i').test(body)).map(t => `${path.basename(f)}: ${t}`)
    })
    expect(touched).toEqual([])
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
    expect(migrationFiles('platform', empty)).toEqual([])
    fs.rmSync(empty, { recursive: true })
  })
})
