#!/usr/bin/env tsx
// Shift _action WA template bodies in-place for the platform tenant.
//
// Context: the Phase 0 codemod shifted every wa() entry in seed/catalog.ts so
// {{1}} = brand (store_name) and the "Jeffi Stores: " prefix is gone. The 25
// _action variants (image/button siblings seeded manually via
// /system-templates/install, NOT in catalog.ts) still carry the old numbered
// placeholders and the "Jeffi Stores: " prefix in DB. This script applies the
// same shift to those rows in-place: strip the prefix, prepend "{{1}}: ",
// shift every {{N}} -> {{N+1}} inside the body and inside blocks (variables,
// types.*.body/title/media/actions, buttons[].value, carousel cards).
//
// Writes a new template_version via upsertTemplate so the family's version
// chain stays consistent; media_type / provider_ref are preserved (COALESCE
// in upsertTemplate). Idempotent: a body already starting with "{{1}}" is
// reported and skipped. AUTHENTICATION templates are skipped as belt-and-braces
// (none should match "_action" anyway).
//
// Dry-run by default; pass --apply to write.
//   cd messaging-service
//   npx tsx scripts/shift-wa-action-bodies.ts            # dry run
//   npx tsx scripts/shift-wa-action-bodies.ts --apply    # write

import { db } from '../src/db.js'
import * as tpl from '../src/templates-v2.js'

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'
const BRAND_FALLBACK = 'Jeffi Stores'
const PREFIXES = ['Jeffi Stores support: ', 'Jeffi Stores — ', 'Jeffi Stores: ']

const APPLY = process.argv.includes('--apply')
const DRY = !APPLY

type Row = {
  template_id: string
  family_id: string
  slug: string
  name: string
  category: string | null
  variant_id: string
  version_id: string
  body: string
  subject: string | null
  blocks: any
  blocks_format: string | null
  meta_category: string | null
  media_type: string | null
  provider_ref: string | null
  locale: string
}

const WA_PLACEHOLDER = /\{\{\s*(\d+)\s*\}\}/g

/** Shift every {{N}} -> {{N+1}}, descending to avoid cascades. */
function shiftPlaceholders(text: string): string {
  if (!text) return text
  const nums = [...text.matchAll(WA_PLACEHOLDER)].map(m => +m[1])
  if (!nums.length) return text
  const max = Math.max(...nums)
  let out = text
  for (let n = max; n >= 1; n--) {
    out = out.replace(new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`, 'g'), `{{${n + 1}}}`)
  }
  return out
}

type ShiftResult =
  | { kind: 'shifted'; body: string; prefix: string }
  | { kind: 'already-shifted' }
  | { kind: 'no-match' }

/** Strip the "Jeffi Stores*" prefix, prepend "{{1}}: ", shift the rest. */
function shiftBody(body: string): ShiftResult {
  if (/^\{\{\s*1\s*\}\}/.test(body)) return { kind: 'already-shifted' }
  for (const p of PREFIXES) {
    if (body.startsWith(p)) {
      return { kind: 'shifted', body: '{{1}}: ' + shiftPlaceholders(body.slice(p.length)), prefix: p }
    }
  }
  return { kind: 'no-match' }
}

/** Shift any {{N}} inside a placeholder-bearing field (URL, phone, media URL). */
function shiftField(v: unknown): unknown {
  return typeof v === 'string' ? shiftPlaceholders(v) : v
}

/** Rebuild blocks so sample variables + nested placeholders align with the new body. */
function shiftBlocks(blocks: any, newBody: string): any {
  if (!blocks || typeof blocks !== 'object') return blocks
  const out: any = JSON.parse(JSON.stringify(blocks))

  if (out.types && typeof out.types === 'object') {
    for (const k of Object.keys(out.types)) {
      const t = out.types[k]
      if (!t || typeof t !== 'object') continue
      // Body/title mirrors the saved body (composeTypes convention).
      if (typeof t.body === 'string') t.body = newBody
      if (typeof t.title === 'string') t.title = newBody
      // Media URLs may embed {{N}} for per-send images.
      if (Array.isArray(t.media)) t.media = t.media.map(shiftField)
      // Action URLs/phones may embed {{N}} suffixes.
      if (Array.isArray(t.actions)) {
        t.actions = t.actions.map((a: any) => {
          if (!a || typeof a !== 'object') return a
          const c = { ...a }
          if (typeof c.url === 'string') c.url = shiftPlaceholders(c.url)
          if (typeof c.phone === 'string') c.phone = shiftPlaceholders(c.phone)
          return c
        })
      }
    }
  }

  if (Array.isArray(out.buttons)) {
    out.buttons = out.buttons.map((b: any) => (b && typeof b === 'object'
      ? { ...b, value: typeof b.value === 'string' ? shiftPlaceholders(b.value) : b.value }
      : b))
  }

  if (out.carousel && Array.isArray(out.carousel.cards)) {
    out.carousel.cards = out.carousel.cards.map((c: any) => {
      if (!c || typeof c !== 'object') return c
      const copy = { ...c }
      if (typeof copy.body === 'string') copy.body = shiftPlaceholders(copy.body)
      if (typeof copy.title === 'string') copy.title = shiftPlaceholders(copy.title)
      if (typeof copy.media_url === 'string') copy.media_url = shiftPlaceholders(copy.media_url)
      if (Array.isArray(copy.buttons)) {
        copy.buttons = copy.buttons.map((b: any) => (b && typeof b === 'object'
          ? { ...b, value: typeof b.value === 'string' ? shiftPlaceholders(b.value) : b.value }
          : b))
      }
      return copy
    })
  }

  // Shift sample-variable keys: "N" -> "N+1", seed "1" with the brand.
  if (out.variables && typeof out.variables === 'object') {
    const next: Record<string, string> = {}
    for (const [k, v] of Object.entries(out.variables)) {
      const n = /^\d+$/.test(k) ? +k : NaN
      if (Number.isInteger(n) && n >= 1) next[String(n + 1)] = v as string
      else next[k] = v as string
    }
    next['1'] = BRAND_FALLBACK
    out.variables = next
  }

  return out
}

async function main() {
  const { rows } = await db.query<Row>(
    `SELECT t.id              AS template_id,
            f.id              AS family_id,
            f.slug,
            f.name,
            f.category,
            v.id              AS variant_id,
            v.locale,
            v.meta_category,
            v.media_type,
            v.provider_ref,
            ver.id            AS version_id,
            ver.body,
            ver.subject,
            ver.blocks,
            ver.blocks_format
       FROM template t
       JOIN template_family f ON f.id = t.family_id
       JOIN template_variant v ON v.id = t.current_variant_id
       JOIN template_version ver ON ver.id = v.current_version_id
      WHERE t.tenant_id = $1
        AND t.channel = 'whatsapp'
        AND t.status <> 'archived'
        AND f.slug LIKE $2
      ORDER BY f.slug`,
    [PLATFORM_TENANT_ID, '%\\_action']
  )

  let shifted = 0, skippedAuth = 0, skippedAlready = 0, skippedNoMatch = 0, failed = 0
  for (const r of rows) {
    if ((r.meta_category ?? '').toUpperCase() === 'AUTHENTICATION') {
      console.log(`${r.slug}: skipped (AUTHENTICATION)`)
      skippedAuth++; continue
    }
    const res = shiftBody(r.body)
    if (res.kind === 'already-shifted') {
      console.log(`${r.slug}: skipped (already starts with {{1}})`)
      skippedAlready++; continue
    }
    if (res.kind === 'no-match') {
      console.warn(`${r.slug}: skipped (no "Jeffi Stores*" prefix on body)`)
      skippedNoMatch++; continue
    }
    const newBody = res.body
    const newBlocks = shiftBlocks(r.blocks, newBody)
    const action = DRY ? 'WOULD shift' : 'shifted'
    console.log(`${action} ${r.slug}: ${JSON.stringify(res.prefix)} -> {{1}}: ...`)
    if (DRY) { shifted++; continue }
    try {
      await tpl.upsertTemplate(db, PLATFORM_TENANT_ID, {
        slug: r.slug,
        channel: 'whatsapp',
        name: r.name,
        category: r.category ?? undefined,
        locale: r.locale,
        subject: r.subject ?? undefined,
        body: newBody,
        blocks: newBlocks,
        blocks_format: (r.blocks_format ?? 'wa-content') as any,
        meta_category: (r.meta_category ?? undefined) as any,
        media_type: (r.media_type ?? undefined) as any,
        // provider_ref intentionally omitted: the shifted body needs a fresh Meta
        // submission (run resubmit-wa-templates after this). upsertTemplate's
        // COALESCE preserves the variant's current provider_ref on the live SID.
        note: 'shift-wa-action-bodies: Phase 0 brand-prefix normalisation',
        publish: true,
      })
      shifted++
    } catch (e: any) {
      console.error(`${r.slug}: FAILED - ${e?.message ?? e}`)
      failed++
    }
  }

  console.log(JSON.stringify({
    mode: DRY ? 'dry-run' : 'apply',
    total: rows.length,
    shifted,
    skipped_authentication: skippedAuth,
    skipped_already_shifted: skippedAlready,
    skipped_no_match: skippedNoMatch,
    failed,
  }))
  await db.end()
}

main().catch(async e => {
  console.error(e)
  await db.end().catch(() => {})
  process.exit(1)
})
