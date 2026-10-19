#!/usr/bin/env tsx
// Current WhatsApp versions → the {{brand_name}} form the editors show (history is left as written). Dry run by default; --apply writes.
// - "— from {{N}} team" (N = last slot) becomes "— from {{brand_name}} team" in place. What Meta sees
//   is unchanged (planSlots numbers the token back to N), so approved and pending SIDs stay valid.
// - Unsubmitted Phase-0 forks ("{{1}}: …", brand first) are reshaped to the same sign-off and checked
//   against Meta's rules; anything already submitted in that shape is reported, not touched.
// Platform + every active tenant in the main DB. Tenants with their own store DB only with --tenant-dbs
// (run in-cluster; never from a laptop against live RDS). AUTHENTICATION bodies are left alone.
import type pg from 'pg'
import { metaSamples, placeholders, validateForMeta, withBrandToken, type WaBlocks } from '@jeffi/api-contracts'
import { db } from '../src/db.js'
import { poolsForTenant } from '../src/pools.js'
import { PLATFORM_TENANT_ID } from '../src/templates-v2.js'

const APPLY = process.argv.includes('--apply')
const TENANT_DBS = process.argv.includes('--tenant-dbs')
const LEAD = /^\{\{\s*1\s*\}\}\s*:\s*/
const PH = /\{\{\s*(\d+)\s*\}\}/g

type Row = { id: string; slug: string; body: string; blocks: WaBlocks | null; provider_ref: string | null; meta_category: string | null }

/** "{{1}}: Hi {{2}} …" → "Hi {{1}} …\n— from {{brand_name}} team"; null when it isn't that shape. */
function fromPhase0(body: string, blocks: WaBlocks | null): { body: string; blocks: WaBlocks } | null {
  if (!LEAD.test(body)) return null
  const rest = body.replace(LEAD, '')
  if (placeholders(rest).includes('1')) return null
  let next = rest.replace(PH, (_m, n: string) => `{{${+n - 1}}}`).trimEnd()
  if (/^\{\{\s*\d+\s*\}\}/.test(next)) next = `Hi ${next}`
  next += '\n— from {{brand_name}} team'
  const vars: Record<string, string> = {}
  for (const [k, v] of Object.entries(blocks?.variables ?? {})) if (/^\d+$/.test(k) && +k > 1) vars[String(+k - 1)] = v
  return { body: next, blocks: withTextBody({ ...(blocks ?? {}), variables: vars }, next) }
}

// Seeded rows keep a copy of the body under types['twilio/text']; keep it in step.
function withTextBody(blocks: WaBlocks, body: string): WaBlocks {
  const text = blocks.types?.['twilio/text']
  return text ? { ...blocks, types: { ...blocks.types, 'twilio/text': { ...text, body } } } : blocks
}

async function rowsFor(pool: pg.Pool, tenantId: string) {
  return (await pool.query<Row>(
    `SELECT ver.id, f.slug, ver.body, ver.blocks, ver.provider_ref, v.meta_category
       FROM template t
       JOIN template_family f ON f.id = t.family_id
       JOIN template_variant v ON v.template_id = t.id
       JOIN template_version ver ON ver.id = v.current_version_id
      WHERE t.tenant_id = $1 AND t.channel = 'whatsapp' AND t.status <> 'archived'
      ORDER BY f.slug`, [tenantId])).rows
}

const tenants = (await db.query<{ id: string; slug: string }>(
  `SELECT id, slug FROM tenants WHERE status = 'active' OR id = $1 ORDER BY id = $1 DESC, slug`, [PLATFORM_TENANT_ID])).rows
const totals = { tokenized: 0, reshaped: 0, submittedPhase0: 0, invalid: 0, tenants: 0 }
for (const t of tenants) {
  let pool: pg.Pool
  try { pool = (await poolsForTenant(t.id)).pool } catch (e: any) { console.warn(`${t.slug}: no pool (${e?.message})`); continue }
  if (pool !== db && !TENANT_DBS) { console.log(`${t.slug}: own DB — skipped (pass --tenant-dbs in-cluster)`); continue }
  let rows: Row[]
  try { rows = await rowsFor(pool, t.id) } catch (e: any) { if (e?.code !== '42P01') console.warn(`${t.slug}: ${e?.message}`); continue }
  totals.tenants++
  for (const r of rows) {
    if ((r.meta_category ?? '').toUpperCase() === 'AUTHENTICATION') continue
    let next: { body: string; blocks: WaBlocks } | null = null
    let kind: 'tokenized' | 'reshaped'
    const shaped = fromPhase0(r.body, r.blocks)
    if (shaped) {
      if (r.provider_ref) { console.warn(`${t.slug} ${r.slug}: Phase-0 body already submitted (${r.provider_ref}) — left as is`); totals.submittedPhase0++; continue }
      next = shaped
      kind = 'reshaped'
    } else {
      const body = withBrandToken(r.body)
      if (body === r.body) continue
      next = { body, blocks: withTextBody(r.blocks ?? {}, body) }
      kind = 'tokenized'
    }
    const errs = validateForMeta(next.body, next.blocks, metaSamples(next.body, next.blocks))
    if (errs.length) { console.warn(`${t.slug} ${r.slug}: skipped — ${errs.join(' | ')}`); totals.invalid++; continue }
    console.log(`${APPLY ? '' : 'WOULD '}${kind} ${t.slug} ${r.slug}`)
    if (APPLY) await pool.query(`UPDATE template_version SET body=$2, blocks=$3 WHERE id=$1`, [r.id, next.body, next.blocks])
    totals[kind]++
  }
}
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', ...totals }))
await db.end()
process.exit(0) // tenant pools stay open otherwise
