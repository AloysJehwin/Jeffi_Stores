#!/usr/bin/env tsx
// Brings stored email templates up to the current catalog. Dry run by default; --apply writes.
// - Platform defaults: a new published version when the subject, preview text, body or tags differ.
// - A store's copy is upgraded only while it still matches the old default (seed/email-catalog-v1.json);
//   a copy the store has edited is left alone and reported.
// Platform + every active tenant in the main DB. Tenants with their own store DB only with --tenant-dbs
// (run in-cluster; never from a laptop against live RDS).
import type pg from 'pg'
import { db } from '../src/db.js'
import { poolsForTenant } from '../src/pools.js'
import { PLATFORM_TENANT_ID, upsertTemplate } from '../src/templates-v2.js'
import { CATALOG, type TemplateSeed } from '../seed/catalog.js'
import before from '../seed/email-catalog-v1.json' with { type: 'json' }

const APPLY = process.argv.includes('--apply')
const TENANT_DBS = process.argv.includes('--tenant-dbs')

type Row = { slug: string; subject: string | null; preheader: string | null; body: string; tags: string[] }

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const seeds = new Map(CATALOG.filter(s => s.channel === 'email').map(s => [s.slug, s]))
const old = new Map(before.map(t => [t.slug, t]))

const sameContent = (r: Row, s: TemplateSeed) =>
  norm(r.subject) === norm(s.subject) && norm(r.preheader) === norm(s.preheader) && norm(r.body) === norm(s.body)
// A store's copy reads its tags from the default when it has none (listTemplatesWithDefaults).
const current = (r: Row, s: TemplateSeed) => sameContent(r, s) && [...(r.tags ?? [])].sort().join() === [...(s.tags ?? [])].sort().join()
const untouched = (r: Row) => {
  const o = old.get(r.slug)
  return !!o && norm(r.subject) === norm(o.subject) && norm(r.body) === norm(o.body)
}

async function rowsFor(pool: pg.Pool, tenantId: string) {
  return (await pool.query<Row>(
    `SELECT f.slug, ver.subject, ver.preheader, ver.body, f.tags
       FROM template t
       JOIN template_family f ON f.id = t.family_id AND f.space = 'store'
       JOIN template_variant v ON v.id = t.current_variant_id
       JOIN template_version ver ON ver.id = v.current_version_id
      WHERE t.tenant_id = $1 AND t.channel = 'email' AND t.status <> 'archived'`, [tenantId])).rows
}

const write = (pool: pg.Pool, tenantId: string, s: TemplateSeed) =>
  upsertTemplate(pool, tenantId, { ...s, note: 'refresh-email-catalog: updated standard content', publish: true })

if (process.argv[1] && /refresh-email-catalog\.ts$/.test(process.argv[1])) {
  const tenants = (await db.query<{ id: string; slug: string }>(
    `SELECT id, slug FROM tenants WHERE status = 'active' OR id = $1 ORDER BY id = $1 DESC, slug`, [PLATFORM_TENANT_ID])).rows
  if (!tenants.some(t => t.id === PLATFORM_TENANT_ID)) tenants.unshift({ id: PLATFORM_TENANT_ID, slug: 'platform' })
  const totals = { platform: 0, upgraded: 0, kept: 0, tenants: 0 }
  for (const t of tenants) {
    const platform = t.id === PLATFORM_TENANT_ID
    let pool: pg.Pool
    try { pool = platform ? db : (await poolsForTenant(t.id)).pool } catch (e: any) { console.warn(`${t.slug}: no pool (${e?.message})`); continue }
    if (pool !== db && !TENANT_DBS) { console.log(`${t.slug}: own DB — skipped (pass --tenant-dbs in-cluster)`); continue }
    let rows: Row[]
    try { rows = await rowsFor(pool, t.id) } catch (e: any) { if (e?.code !== '42P01') console.warn(`${t.slug}: ${e?.message}`); continue }
    totals.tenants++
    const have = new Map(rows.map(r => [r.slug, r]))
    for (const s of seeds.values()) {
      const r = have.get(s.slug)
      if (platform) {
        if (r && current(r, s)) continue
        console.log(`${APPLY ? '' : 'WOULD '}${r ? 'update' : 'add'} platform ${s.slug}`)
        if (APPLY) await write(pool, t.id, s)
        totals.platform++
      } else if (r && !sameContent(r, s)) {
        if (!untouched(r)) { console.log(`kept (edited by the store) ${t.slug} ${s.slug}`); totals.kept++; continue }
        console.log(`${APPLY ? '' : 'WOULD '}upgrade ${t.slug} ${s.slug}`)
        if (APPLY) await write(pool, t.id, s)
        totals.upgraded++
      }
    }
  }
  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', ...totals }))
  await db.end()
  process.exit(0) // tenant pools stay open otherwise
}
