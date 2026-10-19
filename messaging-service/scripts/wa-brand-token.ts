#!/usr/bin/env tsx
// Current WhatsApp versions → the {{brand_name}} form the editors show. Dry run by default; --apply writes.
// - "— from {{N}} team" (N = last slot) becomes "— from {{brand_name}} team" in place: what Meta sees is
//   unchanged (planSlots numbers the token back to N), so approved and pending SIDs stay valid.
// - A body that spells the brand out ("Jeffi Stores: …", the original seed) or opens with it as {{1}}
//   (Phase 0) is reshaped to the same sign-off. That changes what Meta sees, so a version that was
//   submitted gets a NEW version (sends keep the approved one until resubmit-wa-templates + wa:sync
//   promote the new SID); an unsubmitted one is rewritten in place.
// Platform + every active tenant in the main DB. Tenants with their own store DB only with --tenant-dbs
// (run in-cluster; never from a laptop against live RDS). AUTHENTICATION bodies are left alone.
import type pg from 'pg'
import { metaSamples, placeholders, validateForMeta, withBrandToken, type WaBlocks } from '@jeffi/api-contracts'
import { db } from '../src/db.js'
import { poolsForTenant } from '../src/pools.js'
import { PLATFORM_TENANT_ID, upsertTemplate } from '../src/templates-v2.js'

const APPLY = process.argv.includes('--apply')
const TENANT_DBS = process.argv.includes('--tenant-dbs')
const LEAD = /^\{\{\s*1\s*\}\}\s*:\s*/
const PH = /\{\{\s*(\d+)\s*\}\}/g
const LITERAL = 'Jeffi Stores'
const TAIL = '\n— from {{brand_name}} team'

type Row = {
  id: string; slug: string; name: string; category: string | null; locale: string; subject: string | null
  body: string; blocks: WaBlocks | null; blocks_format: string | null; provider_ref: string | null
  meta_category: string | null; media_type: string | null
}
type Next = { body: string; blocks: WaBlocks }

// Meta rejects a body that starts with a variable; give the few that would a lead-in.
function leadIn(body: string): string {
  if (!/^\{\{\s*\d+\s*\}\}/.test(body)) return body
  return /^\{\{\s*\d+\s*\}\}\s+wishes/.test(body) ? `Warm ${body}` : `Hi ${body}`
}

/** "{{1}}: Hi {{2}} …" → "Hi {{1}} …" + sign-off; null when it isn't that shape. */
export function fromPhase0(body: string, blocks: WaBlocks | null): Next | null {
  if (!LEAD.test(body)) return null
  const rest = body.replace(LEAD, '')
  if (placeholders(rest).includes('1')) return null
  const next = leadIn(rest.replace(PH, (_m, n: string) => `{{${+n - 1}}}`).trimEnd()) + TAIL
  const vars: Record<string, string> = {}
  for (const [k, v] of Object.entries(blocks?.variables ?? {})) if (/^\d+$/.test(k) && +k > 1) vars[String(+k - 1)] = v
  return { body: next, blocks: withTextBody({ ...(blocks ?? {}), variables: vars }, next) }
}

/** "Jeffi Stores: …" / "Jeffi Stores support: …" / "… Jeffi Stores …" → the token; null when the brand isn't spelled out. */
export function fromLiteral(body: string, blocks: WaBlocks | null): Next | null {
  if (!body.includes(LITERAL)) return null
  let next: string
  if (body.startsWith(`${LITERAL} support:`)) next = leadIn(body.slice(LITERAL.length + 1).replace(/^support:\s*/, 'Support: ').trimEnd()) + TAIL
  else if (body.startsWith(`${LITERAL}:`)) next = leadIn(body.slice(LITERAL.length + 1).trimStart().trimEnd()) + TAIL
  else next = body.split(LITERAL).join('{{brand_name}}')
  return { body: next, blocks: withTextBody(blocks ?? {}, next) }
}

// Seeded rows keep a copy of the body under types['twilio/text']; keep it in step.
function withTextBody(blocks: WaBlocks, body: string): WaBlocks {
  const text = blocks.types?.['twilio/text']
  return text ? { ...blocks, types: { ...blocks.types, 'twilio/text': { ...text, body } } } : blocks
}

async function rowsFor(pool: pg.Pool, tenantId: string) {
  return (await pool.query<Row>(
    `SELECT ver.id, f.slug, f.name, f.category, v.locale, ver.subject, ver.body, ver.blocks, ver.blocks_format,
            ver.provider_ref, v.meta_category, v.media_type
       FROM template t
       JOIN template_family f ON f.id = t.family_id
       JOIN template_variant v ON v.template_id = t.id
       JOIN template_version ver ON ver.id = v.current_version_id
      WHERE t.tenant_id = $1 AND t.channel = 'whatsapp' AND t.status <> 'archived'
      ORDER BY f.slug`, [tenantId])).rows
}

if (process.argv[1] && /wa-brand-token\.ts$/.test(process.argv[1])) {
  const tenants = (await db.query<{ id: string; slug: string }>(
    `SELECT id, slug FROM tenants WHERE status = 'active' OR id = $1 ORDER BY id = $1 DESC, slug`, [PLATFORM_TENANT_ID])).rows
  const totals = { tokenized: 0, reshaped: 0, newVersion: 0, invalid: 0, tenants: 0 }
  for (const t of tenants) {
    let pool: pg.Pool
    try { pool = (await poolsForTenant(t.id)).pool } catch (e: any) { console.warn(`${t.slug}: no pool (${e?.message})`); continue }
    if (pool !== db && !TENANT_DBS) { console.log(`${t.slug}: own DB — skipped (pass --tenant-dbs in-cluster)`); continue }
    let rows: Row[]
    try { rows = await rowsFor(pool, t.id) } catch (e: any) { if (e?.code !== '42P01') console.warn(`${t.slug}: ${e?.message}`); continue }
    totals.tenants++
    for (const r of rows) {
      if ((r.meta_category ?? '').toUpperCase() === 'AUTHENTICATION') continue
      let next: Next | null
      let kind: 'tokenized' | 'reshaped'
      const shaped = fromPhase0(r.body, r.blocks) ?? fromLiteral(r.body, r.blocks)
      if (shaped) { next = shaped; kind = 'reshaped' }
      else {
        const body = withBrandToken(r.body)
        if (body === r.body) continue
        next = { body, blocks: withTextBody(r.blocks ?? {}, body) }
        kind = 'tokenized'
      }
      const errs = validateForMeta(next.body, next.blocks, metaSamples(next.body, next.blocks))
      if (errs.length) { console.warn(`${t.slug} ${r.slug}: skipped — ${errs.join(' | ')}`); totals.invalid++; continue }
      // Only a reshape of a submitted version changes Meta's view: that becomes a new version.
      const asNew = kind === 'reshaped' && !!r.provider_ref
      console.log(`${APPLY ? '' : 'WOULD '}${kind}${asNew ? ' (new version)' : ''} ${t.slug} ${r.slug}`)
      if (APPLY) {
        if (asNew) await upsertTemplate(pool, t.id, {
          slug: r.slug, channel: 'whatsapp', name: r.name, category: r.category ?? undefined, locale: r.locale,
          subject: r.subject ?? undefined, body: next.body, blocks: next.blocks, blocks_format: (r.blocks_format ?? 'wa-content') as any,
          meta_category: (r.meta_category ?? undefined) as any, media_type: (r.media_type ?? undefined) as any,
          note: 'wa-brand-token: {{brand_name}} sign-off', publish: true,
        })
        else await pool.query(`UPDATE template_version SET body=$2, blocks=$3 WHERE id=$1`, [r.id, next.body, next.blocks])
      }
      totals[kind]++
      if (asNew) totals.newVersion++
    }
  }
  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', ...totals }))
  await db.end()
  process.exit(0) // tenant pools stay open otherwise
}
