#!/usr/bin/env tsx
// Resubmit every platform WA template after the Phase-0 body shift ({{1}}=store_name).
// Idempotent: skips templates whose live Twilio Content body already matches the current platform
// body — safe to re-run. OTP/verify slugs are untouched (Meta pins AUTHENTICATION bodies).
// A per-template failure is logged and the loop continues; prior submissions are not rolled back.
// Run after `npm run seed:catalog`. Meta soak is 24-72h; `npm run wa:sync` promotes approvals to live.
import { db } from '../src/db.js'
import { PLATFORM_TENANT_ID, findById } from '../src/templates-v2.js'
import * as twContent from '../src/providers/twilio-content.js'
import { renumberForSubmit, submit } from '../src/wa-approval.js'
import { metaSamples } from '@jeffi/api-contracts'

type Row = { template_id: string; slug: string }
const rows = (await db.query<Row>(
  `SELECT t.id AS template_id, f.slug
     FROM template t
     JOIN template_family f ON f.id=t.family_id
    WHERE t.tenant_id=$1 AND t.channel='whatsapp' AND t.status <> 'archived'
    ORDER BY f.slug`,
  [PLATFORM_TENANT_ID])).rows

// Body lives under different type keys depending on content shape; scan them all.
function liveBodyOf(types: Record<string, any> | undefined): string | undefined {
  if (!types) return undefined
  return types['twilio/text']?.body
      ?? types['twilio/media']?.body
      ?? types['twilio/call-to-action']?.body
      ?? types['twilio/quick-reply']?.body
      ?? types['twilio/carousel']?.body
      ?? types['twilio/card']?.title
}

let submitted = 0, skipped = 0, failed = 0
for (const r of rows) {
  const full = await findById(db, PLATFORM_TENANT_ID, r.template_id)
  if (!full?.variant || !full.version) { console.warn(`${r.slug}: skipped (no version)`); skipped++; continue }
  if (full.variant.meta_category === 'AUTHENTICATION') { console.log(`${r.slug}: skipped (authentication)`); skipped++; continue }
  const oldSid = full.variant.provider_ref
  if (oldSid) {
    try {
      const live = await twContent.getContent(oldSid)
      // Compare what would be submitted ({{brand_name}} numbered), not the stored text.
      const blocks = (full.version.blocks ?? {}) as any
      if (liveBodyOf(live.types) === renumberForSubmit(full.version.body, blocks, metaSamples(full.version.body, blocks)).body) {
        console.log(`${r.slug}: no change needed`); skipped++; continue
      }
    } catch { /* dangling or inaccessible SID — fall through to submit */ }
  }
  try {
    const res = await submit(db, PLATFORM_TENANT_ID, 'platform', r.template_id)
    if (oldSid) await db.query(`UPDATE template_variant SET deprecated_provider_ref=$2 WHERE id=$1`, [full.variant.id, oldSid])
    console.log(`${r.slug}: submitted ${res.sid} (old ${oldSid ?? '-'} -> deprecated)`)
    submitted++
  } catch (e: any) {
    if (e?.status === 409) { console.log(`${r.slug}: already pending/approved`); skipped++; continue }
    console.warn(`${r.slug}: FAILED - ${e?.message ?? e}`)
    failed++
  }
}
console.log(JSON.stringify({ submitted, skipped, failed, total: rows.length }))
await db.end()
