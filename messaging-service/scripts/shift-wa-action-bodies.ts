#!/usr/bin/env tsx
// Shift WA template bodies in-place for the platform tenant.
//
// Round 2 (tail = "— from {{N}} team"): Meta rejected the round-1 trailing
// "— {{N}}" shape as "Body cannot end with a variable" — our own validator
// agrees (whatsapp-rules.ts L24: a {{n}} followed only by [\s.!?]* is a
// trailing variable). So the new tail literal is "\n— from {{N}} team",
// which has real letters AFTER the placeholder.
//
// Also handles the stray bodies that STILL start with "{{N}}" after the
// Phase 0 head-strip (promo/festive_action, promo/offer_action,
// support/reply_action variants, and 5 legacy system/* families whose
// current body is literally "{{N}}: ..."): prepend "Hi " so the body no
// longer begins with a variable.
//
// Transforms per row (apply the first that matches):
//
//   1. Old Phase 0 shape — body starts with "{{1}}" + separator (": ",
//      " - ", " — ", etc.): strip the head, shift every remaining
//      placeholder DOWN by 1, append "\n— from {{N}} team" where N = new
//      highest index + 1 (or 1 if the stripped body has no placeholders).
//   2. Round-1 shape — body ends with "— {{N}}" (and NOT "— from {{N}}
//      team"): append " team" + rewrite the tail to "— from {{N}} team".
//   3. Starts with "{{N}}" after step 1 (or already) AND is not caught by
//      1/2: prepend "Hi " unless the body already opens with
//      Hi/Hey/Hello/Dear.
//   4. Already in the final "— from {{N}} team" shape: log and skip.
//   5. AUTHENTICATION-category families are skipped — Meta pins {{1}} =
//      code and the body intentionally opens with it.
//
// After the body transform, we re-validate with validateForMeta() against
// the composed samples. If it returns non-empty errors, the row is
// counted as "failed" and NOT written. provider_ref is omitted so
// resubmit-wa-templates picks the row up for a fresh Meta submission.
//
// SQL filter: platform-tenant WA families whose slug ends in "_action" OR
// whose body starts with "{{" (the second clause catches the 5 legacy
// system/* v2 rows — otp/verify, order/confirmed, promo/offer,
// cart/abandoned, order/shipped — that round 1 missed because they don't
// carry the _action suffix). AUTHENTICATION rows filter back out above.
//
// Dry-run by default; pass --apply to write. Idempotent on repeat runs:
// a second pass logs "already in team-tail shape — skipped" for every
// row that completed on the first pass.
//
//   cd messaging-service
//   npx tsx scripts/shift-wa-action-bodies.ts            # dry run
//   npx tsx scripts/shift-wa-action-bodies.ts --apply    # write

import { db } from '../src/db.js'
import * as tpl from '../src/templates-v2.js'
import { metaSamples, validateForMeta, type WaBlocks } from '@jeffi/api-contracts'
import { renumberForSubmit } from '../src/wa-approval.js'

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'
const BRAND_FALLBACK = 'Jeffi Stores'

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
// Phase 0 head: "{{1}}" followed by a REAL separator (":", "-", "—") then whitespace.
// Without the separator this would misfire on legit bodies that happen to open with
// "{{1}}" followed by punctuation ("{{1}}! Use code ..." in promo/offer_action), which
// are round-1 tail cases (step 2) that need bumpExtras + Hi-prefix instead.
const LEADING_BRAND = /^\{\{\s*1\s*\}\}\s*[:\-—]\s+/
const LEADING_ANY_VAR = /^\{\{\s*\d+\s*\}\}/
const TAIL_ROUND1 = /\n?[—\-]\s*\{\{\s*(\d+)\s*\}\}\s*$/
// {{brand_name}} is the current stored form (scripts/wa-brand-token.ts); {{N}} the round-2 one.
const TAIL_FINAL = /\n?[—\-]\s*from\s*\{\{\s*(\d+|brand_name)\s*\}\}\s*team\s*$/i
const LEADING_GREETING = /^(hi|hey|hello|dear)\b/i

/** Shift every {{N}} -> {{N-1}} (N>=2), ascending so we don't cascade. */
function shiftDown(text: string): string {
  if (!text) return text
  const nums = [...text.matchAll(WA_PLACEHOLDER)].map(m => +m[1])
  if (!nums.length) return text
  const max = Math.max(...nums)
  let out = text
  for (let n = 2; n <= max; n++) {
    out = out.replace(new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`, 'g'), `{{${n - 1}}}`)
  }
  return out
}

/** Highest {{N}} in a string, or 0 if none. */
function maxPlaceholder(text: string): number {
  const nums = [...text.matchAll(WA_PLACEHOLDER)].map(m => +m[1])
  return nums.length ? Math.max(...nums) : 0
}

type ShiftResult =
  | { kind: 'shifted'; body: string; newMax: number; reason: string; bumpExtras: boolean }
  | { kind: 'already-final' }
  | { kind: 'no-match' }

/**
 * Round-2 tail transform. The three paths that produce a changed body:
 *   - old Phase 0 shape → strip + shift + full team tail
 *   - round-1 "— {{N}}" shape → append " team"
 *   - still starts with a variable → prepend "Hi "
 * The paths compose: a body in Phase 0 shape with no trailing team on the
 * stripped text goes through step 1 then step 3 if needed.
 */
function shiftBody(body: string): ShiftResult {
  const original = body
  let out = body
  let reason = ''
  let changed = false
  // bumpExtras: whether image/button placeholders need to shift UP by 1
  // so they clear the body's variable range (round-1 shape reused the
  // trailing body slot for the media URL — now a collision after team tail).
  let bumpExtras = false

  if (TAIL_FINAL.test(out) && !LEADING_ANY_VAR.test(out)) {
    return { kind: 'already-final' }
  }

  // Step 1: Phase 0 head strip + full team tail.
  if (LEADING_BRAND.test(out)) {
    const stripped = out.replace(LEADING_BRAND, '').replace(/^\s+/, '')
    const shifted = shiftDown(stripped)
    const existingMax = maxPlaceholder(shifted)
    const newMax = existingMax >= 1 ? existingMax + 1 : 1
    const trimmedTail = shifted.replace(/\s+$/, '')
    out = `${trimmedTail}\n— from {{${newMax}}} team`
    reason = 'phase0-head-strip + team tail'
    changed = true
  } else {
    // Step 2: round-1 "— {{N}}" shape → " team" suffix (idempotent: skip if already final).
    const r1 = TAIL_ROUND1.exec(out)
    if (r1 && !TAIL_FINAL.test(out)) {
      const n = r1[1]
      const base = out.replace(TAIL_ROUND1, '').replace(/\s+$/, '')
      out = `${base}\n— from {{${n}}} team`
      reason = 'round1-tail → team tail'
      changed = true
      // Round-1 authored the media slot at the same {{N}} the body ends with
      // (brand duplicated across body + header). Validation now runs through
      // renumberForSubmit, which handles the collision at submit time — no
      // need to mutate stored extras numbering here.
    }
  }

  // Step 3: body still starts with a variable → prepend greeting.
  if (LEADING_ANY_VAR.test(out) && !LEADING_GREETING.test(out)) {
    out = `Hi ${out}`
    reason = reason ? `${reason} + Hi-prefix` : 'Hi-prefix'
    changed = true
  }

  if (!changed) {
    // Body didn't match any of our transforms. If it already ends with team
    // tail (handled above) or doesn't look like one of ours, skip quietly.
    return { kind: 'no-match' }
  }

  if (out === original) return { kind: 'no-match' }

  const newMax = maxPlaceholder(out)
  return { kind: 'shifted', body: out, newMax, reason, bumpExtras }
}

/** Shift every {{N}} -> {{N+1}} in a string (descending so we don't cascade). */
function shiftUp(text: string): string {
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

/** Rebuild blocks so sample variables + nested placeholders align with the new body. */
function shiftBlocks(blocks: any, oldBody: string, newBody: string, didHeadStrip: boolean, bumpExtras: boolean): any {
  if (!blocks || typeof blocks !== 'object') return blocks
  const out: any = JSON.parse(JSON.stringify(blocks))
  const newMax = maxPlaceholder(newBody)

  // Round-1 bump: shift media[0] and button.value placeholders UP by 1 so
  // extraSlots() returns body.length+1, +2, ... Must run BEFORE the general
  // types/body rewrite below so we edit the original placeholder numbers.
  if (bumpExtras) {
    if (out.types && typeof out.types === 'object') {
      const media = out.types['twilio/media']
      if (media && Array.isArray(media.media)) {
        media.media = media.media.map((v: unknown) => typeof v === 'string' ? shiftUp(v) : v)
      }
    }
    if (Array.isArray(out.buttons)) {
      out.buttons = out.buttons.map((b: any) => (b && typeof b === 'object' && typeof b.value === 'string'
        ? { ...b, value: shiftUp(b.value) }
        : b))
    }
    if (out.variables && typeof out.variables === 'object') {
      const next: Record<string, string> = {}
      // Keys that reference the body (<=newMax after bump) keep their number;
      // keys at numbers that now belong to extras (>newMax after shift) move up.
      // Simplest correct rule: any key equal to a slot now used by media/button
      // must shift up by 1. Compute by remapping ALL numeric keys from old→new.
      // The round-1 body kept the brand at its old max (unchanged). Extras were
      // at oldBrandSlot and oldBrandSlot+1; both move up by 1.
      // Rule: keys whose number is >= oldBrandSlot shift up by 1.
      // oldBrandSlot = newMax (body end is unchanged by the team-tail rewrite).
      const brandSlot = newMax
      for (const [k, v] of Object.entries(out.variables)) {
        const n = /^\d+$/.test(k) ? +k : NaN
        if (Number.isInteger(n) && n > brandSlot) {
          next[String(n + 1)] = v as string
        } else {
          next[k] = v as string
        }
      }
      out.variables = next
    }
  }

  if (out.types && typeof out.types === 'object') {
    for (const k of Object.keys(out.types)) {
      const t = out.types[k]
      if (!t || typeof t !== 'object') continue
      if (typeof t.body === 'string') t.body = newBody
      if (typeof t.title === 'string') t.title = newBody
      if (didHeadStrip) {
        if (Array.isArray(t.media)) t.media = t.media.map((v: unknown) =>
          typeof v === 'string' ? shiftDown(v) : v)
        if (Array.isArray(t.actions)) {
          t.actions = t.actions.map((a: any) => {
            if (!a || typeof a !== 'object') return a
            const c = { ...a }
            if (typeof c.url === 'string') c.url = shiftDown(c.url)
            if (typeof c.phone === 'string') c.phone = shiftDown(c.phone)
            return c
          })
        }
      }
    }
  }

  if (didHeadStrip && Array.isArray(out.buttons)) {
    out.buttons = out.buttons.map((b: any) => (b && typeof b === 'object'
      ? { ...b, value: typeof b.value === 'string' ? shiftDown(b.value) : b.value }
      : b))
  }

  if (didHeadStrip && out.carousel && Array.isArray(out.carousel.cards)) {
    out.carousel.cards = out.carousel.cards.map((c: any) => {
      if (!c || typeof c !== 'object') return c
      const copy = { ...c }
      if (typeof copy.body === 'string') copy.body = shiftDown(copy.body)
      if (typeof copy.title === 'string') copy.title = shiftDown(copy.title)
      if (typeof copy.media_url === 'string') copy.media_url = shiftDown(copy.media_url)
      if (Array.isArray(copy.buttons)) {
        copy.buttons = copy.buttons.map((b: any) => (b && typeof b === 'object'
          ? { ...b, value: typeof b.value === 'string' ? shiftDown(b.value) : b.value }
          : b))
      }
      return copy
    })
  }

  // Sample variables: drop old "1" if we head-stripped, shift the rest down,
  // seed newMax with the brand fallback. If we only prepended "Hi " / " team"
  // (no head strip), the numbering is unchanged — only seed the top slot.
  if (out.variables && typeof out.variables === 'object') {
    if (didHeadStrip) {
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(out.variables)) {
        const n = /^\d+$/.test(k) ? +k : NaN
        if (Number.isInteger(n) && n >= 2) next[String(n - 1)] = v as string
        else if (Number.isInteger(n) && n === 1) continue // old brand entry, drop
        else next[k] = v as string
      }
      out.variables = next
    }
    if (newMax > 0 && !out.variables[String(newMax)]?.trim()) {
      out.variables[String(newMax)] = BRAND_FALLBACK
    }
  } else if (newMax > 0) {
    out.variables = { [String(newMax)]: BRAND_FALLBACK }
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
        AND (f.slug LIKE $2 OR ver.body LIKE '{{%')
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
    if (res.kind === 'already-final') {
      console.log(`${r.slug}: already in team-tail shape — skipped`)
      skippedAlready++; continue
    }
    if (res.kind === 'no-match') {
      console.warn(`${r.slug}: skipped (no transform matched; body="${r.body.slice(0, 60).replace(/\n/g, '\\n')}")`)
      skippedNoMatch++; continue
    }

    const didHeadStrip = res.reason.includes('phase0-head-strip')
    const newBody = res.body
    const newBlocks = shiftBlocks(r.blocks, r.body, newBody, didHeadStrip, res.bumpExtras)

    // Validate against Meta's rules — same path submit() uses: renumberForSubmit
    // promotes stored extras to body.length+1,+2,... at submission time, so we
    // validate the renumbered payload (not the stored shape where extras may still
    // overlap the body's variable range).
    const storedSamples = metaSamples(newBody, newBlocks as WaBlocks)
    const outbound = renumberForSubmit(newBody, newBlocks as WaBlocks, storedSamples)
    const errors = validateForMeta(newBody, outbound.blocks, outbound.samples)
    if (errors.length) {
      console.error(`${r.slug}: FAILED validation — ${errors.join(' | ')}`)
      failed++
      continue
    }

    const action = DRY ? 'WOULD shift' : 'shifted'
    console.log(`${action} ${r.slug}: ${res.reason} -> ... — from {{${res.newMax}}} team`)
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
        // provider_ref intentionally omitted — resubmit-wa-templates picks
        // up the new version_id (provider_ref IS NULL) for a fresh Meta
        // submission. upsertTemplate's COALESCE keeps the live SID on the
        // variant until the new SID is approved.
        note: 'shift-wa-action-bodies v2: team-tail + Hi-prefix as needed',
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
    skipped_already_team_tail: skippedAlready,
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
