import type pg from 'pg'
import type { ServiceScope } from '@jeffi/tenancy'
import { db } from './db.js'
import { poolsForTenant } from './pools.js'
import * as tpl from './templates-v2.js'
import * as twContent from './providers/twilio-content.js'

// WhatsApp template → Twilio Content → Meta approval.
// The variant's provider_ref is always the LIVE (approved) SID that sends use. A submission puts its
// new SID on the submitted version only; sync promotes it to the variant once Meta approves, so a
// pending or rejected edit never breaks sending.

type Button = { type: 'quick_reply' | 'url' | 'phone'; label: string; value?: string }
type Card = { title?: string; body?: string; media_url?: string; buttons?: Button[] }
type Blocks = { types?: Record<string, any>; variables?: Record<string, string>; buttons?: Button[]; carousel?: { cards?: Card[] } }

const PH = /\{\{\s*(\d+)\s*\}\}/g
const placeholders = (s: string) => [...new Set([...(s || '').matchAll(PH)].map(m => m[1]))].sort((a, b) => +a - +b)

function actions(buttons: Button[] | undefined) {
  return (buttons ?? []).filter(b => b.label?.trim()).map(b =>
    b.type === 'quick_reply' ? { type: 'QUICK_REPLY', title: b.label.trim(), id: b.label.trim().toLowerCase().replace(/\W+/g, '_') }
    : b.type === 'url' ? { type: 'URL', title: b.label.trim(), url: b.value ?? '' }
    : { type: 'PHONE_NUMBER', title: b.label.trim(), phone: b.value ?? '' })
}

/** {{n}} used outside the body: header media URL and URL-button suffixes (per-send image / link). */
export function extraSlots(blocks: Blocks | null | undefined): string[] {
  const b = blocks ?? {}
  return placeholders([b.types?.['twilio/media']?.media?.[0] ?? '', ...(b.buttons ?? []).map(x => x.value ?? '')].join(' '))
}

/** One Twilio Content type built from what the editor stores. Body always comes from the saved body. */
export function composeTypes(body: string, blocks: Blocks | null | undefined): Record<string, any> {
  const b = blocks ?? {}
  const cards = b.carousel?.cards?.filter(c => c.body || c.title || c.media_url) ?? []
  const media: string | undefined = b.types?.['twilio/media']?.media?.[0]
  const acts = actions(b.buttons)
  if (cards.length) {
    return { 'twilio/carousel': { body, cards: cards.map(c => ({
      title: c.title ?? '', body: c.body ?? '', media: c.media_url ?? '', actions: actions(c.buttons) })) } }
  }
  if (media && acts.length) return { 'twilio/card': { title: body, media: [media], actions: acts } }
  if (media) return { 'twilio/media': { body, media: [media] } }
  if (acts.length && acts.every(a => a.type === 'QUICK_REPLY')) return { 'twilio/quick-reply': { body, actions: acts } }
  if (acts.length) return { 'twilio/call-to-action': { body, actions: acts.filter(a => a.type !== 'QUICK_REPLY') } }
  return { 'twilio/text': { body } }
}

/** Meta's rejection rules we can check before spending a submission. Empty array = OK. */
export function validateForMeta(body: string, blocks: Blocks | null | undefined, samples: Record<string, string>): string[] {
  const errs: string[] = []
  const text = (body || '').trim()
  if (!text) errs.push('Body is empty.')
  if (text.length > 1024) errs.push(`Body is ${text.length} characters; Meta allows 1024.`)
  if (/^\{\{\s*\d+\s*\}\}/.test(text)) errs.push('Body cannot start with a variable — add text before {{1}}.')
  if (/\{\{\s*\d+\s*\}\}[\s.!?]*$/.test(text)) errs.push('Body cannot end with a variable — add text after the last {{n}}.')
  const vars = placeholders(text)
  vars.forEach((v, i) => { if (+v !== i + 1) errs.push(`Variables must be numbered {{1}}, {{2}}, … in order (found {{${v}}}).`) })
  const words = text.replace(PH, '').split(/\s+/).filter(Boolean).length
  if (vars.length && words < vars.length * 3) errs.push('Too many variables for the message length — add more text around them.')
  for (const v of vars) if (!samples[v]?.trim()) errs.push(`Add a sample value for {{${v}}}.`)
  const extra = extraSlots(blocks)
  extra.forEach((v, i) => { if (+v !== vars.length + i + 1) errs.push(`Image/button variables must continue the numbering after the body (expected {{${vars.length + i + 1}}}).`) })
  for (const v of extra) if (!samples[v]?.trim()) errs.push(`Add a sample value for {{${v}}} (image path or link code).`)
  const all = [...(blocks?.buttons ?? []), ...(blocks?.carousel?.cards ?? []).flatMap(c => c.buttons ?? [])]
  if ((blocks?.buttons?.length ?? 0) > 3) errs.push('At most 3 buttons.')
  for (const btn of all) {
    if (!btn.label?.trim()) errs.push('Every button needs a label.')
    else if (btn.label.length > 25) errs.push(`Button "${btn.label}" is over 25 characters.`)
    if (btn.type === 'url' && !/^https:\/\//.test(btn.value ?? '')) errs.push(`Button "${btn.label}" needs an https:// URL.`)
    if (btn.type === 'phone' && !/^\+\d{8,15}$/.test(btn.value ?? '')) errs.push(`Button "${btn.label}" needs a phone like +919876543210.`)
  }
  return [...new Set(errs)]
}

const SAMPLE_BY_CONTEXT: Array<[RegExp, string]> = [
  [/(https?:|link|here|track|view|download|review|open)\W*$/i, 'https://jeffistores.in/account/orders'],
  [/(order|invoice|quotation|request|ticket)\s*#?\s*$/i, 'JS-10234'],
  [/(₹|rs\.?|total|amount|refund of)\s*$/i, '₹2,499'],
  [/code\s*$/i, 'WELCOME20'],
  [/(hi|hello|dear)\s*,?\s*$/i, 'Priya'],
]
/** Samples Meta reviews with. Keeps what the editor set; fills the rest from the text around {{n}}. */
export function samplesFor(body: string, given?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const v of placeholders(body)) {
    if (given?.[v]?.trim()) { out[v] = given[v]; continue }
    const before = body.slice(0, body.search(new RegExp(`\\{\\{\\s*${v}\\s*\\}\\}`)))
    out[v] = SAMPLE_BY_CONTEXT.find(([re]) => re.test(before))?.[1] ?? 'Sample text'
  }
  return out
}

/** Meta template names are unique per WhatsApp account, so include tenant + version. */
export function metaName(tenantSlug: string | undefined, slug: string, version: number) {
  const prefix = !tenantSlug || tenantSlug === 'platform' ? 'jeffi' : tenantSlug
  return `${prefix}_${slug}_v${version}`.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').slice(0, 512)
}

export async function submit(pool: pg.Pool, tenantId: string, tenantSlug: string | undefined, templateId: string,
  opts: { category?: string; name?: string; space?: tpl.Space } = {}) {
  const t = await tpl.findById(pool, tenantId, templateId, opts.space)
  if (!t?.variant || !t.version) throw Object.assign(new Error('Template not found — save it first.'), { status: 404 })
  if (t.template.channel !== 'whatsapp') throw Object.assign(new Error('Only WhatsApp templates need Meta approval.'), { status: 400 })
  if (t.version.provider_ref && ['pending', 'received', 'approved'].includes(t.variant.approval_status))
    throw Object.assign(new Error('This version is already submitted. Edit and save to submit a new version.'), { status: 409 })
  const blocks = (t.version.blocks ?? {}) as Blocks
  const samples = { ...samplesFor(t.version.body, blocks.variables), ...Object.fromEntries(extraSlots(blocks).map(n => [n, blocks.variables?.[n] ?? ''])) }
  const errors = validateForMeta(t.version.body, blocks, samples)
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status: 422, errors })
  const category = (opts.category ?? t.variant.meta_category ?? 'UTILITY') as 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  const name = opts.name || metaName(opts.space === 'api' ? `${tenantSlug ?? 'jeffi'}_api` : tenantSlug, t.family.slug, t.version.version)
  const content = await twContent.createContent({
    friendly_name: name, language: t.variant.locale, types: composeTypes(t.version.body, blocks), variables: samples,
  })
  let approval: twContent.ApprovalResource
  try {
    approval = await twContent.submitForApproval(content.sid, { name, category, allow_category_change: true })
  } catch (e) {
    await twContent.deleteContent(content.sid).catch(() => {})
    throw Object.assign(new Error(`Meta submission failed: ${(e as Error).message}`), { status: 502 })
  }
  const status = twContent.mapApprovalStatus(approval.status)
  await pool.query(`UPDATE template_version SET provider_ref=$2 WHERE id=$1`, [t.version.id, content.sid])
  await pool.query(
    `UPDATE template_variant SET meta_category=$2, approval_status=$3, approval_raw_status=$4, approval_reason=NULL,
       approval_submitted_at=now(), approval_checked_at=now(), updated_at=now() WHERE id=$1`,
    [t.variant.id, category, status, approval.status])
  return { sid: content.sid, name, status }
}

/** Checks every in-flight submission of one tenant; promotes approved SIDs to live. */
export async function syncTenant(pool: pg.Pool, tenantId: string) {
  const rows = (await pool.query<{ id: string; sid: string }>(
    `SELECT v.id, ver.provider_ref AS sid FROM template_variant v
       JOIN LATERAL (SELECT provider_ref FROM template_version
                      WHERE variant_id=v.id AND provider_ref IS NOT NULL ORDER BY version DESC LIMIT 1) ver ON true
      WHERE v.tenant_id=$1 AND v.approval_status IN ('received','pending','paused')`, [tenantId])).rows
  let checked = 0, changed = 0
  for (const r of rows) {
    try {
      const res = await twContent.getApprovalStatus(r.sid)
      const next = twContent.mapApprovalStatus(res.whatsapp?.status)
      await tpl.setApprovalStatus(pool, r.id, {
        status: next, raw: res.whatsapp?.status ?? null, reason: res.whatsapp?.rejection_reason ?? null,
        approvedAt: next === 'approved' ? new Date() : null,
      })
      if (next === 'approved') await pool.query(`UPDATE template_variant SET provider_ref=$2 WHERE id=$1`, [r.id, r.sid])
      checked++
      if (next === 'approved' || next === 'rejected') changed++
    } catch { /* one bad SID must not stop the rest */ }
  }
  return { checked, changed }
}

/** Platform + every active tenant. Tenant DBs without the template tables are skipped. */
export async function syncAll(log: (m: string) => void = () => {}, scope: ServiceScope = { tenantId: null, skipStoreTenants: false }) {
  const tenants = scope.tenantId
    ? [{ id: scope.tenantId }]
    : (await db.query<{ id: string }>(
        `SELECT id FROM tenants WHERE (status='active' AND NOT ($2 AND 'store' = ANY(service_types))) OR id=$1`,
        [tpl.PLATFORM_TENANT_ID, scope.skipStoreTenants])).rows
  let checked = 0, changed = 0
  for (const { id } of tenants) {
    try {
      const { pool } = await poolsForTenant(id)
      const r = await syncTenant(pool, id)
      checked += r.checked; changed += r.changed
    } catch (e: any) { if (e?.code !== '42P01') log(`wa sync ${id}: ${e?.message}`) }
  }
  return { checked, changed }
}

export function startApprovalSync(log: (m: string) => void, scope: ServiceScope) {
  const every = Number(process.env.WA_APPROVAL_SYNC_MS || 10 * 60_000)
  if (!every || !process.env.TWILIO_ACCOUNT_SID) return
  const run = () => syncAll(log, scope).then(r => r.checked && log(`wa approval sync: checked=${r.checked} changed=${r.changed}`)).catch(e => log(`wa approval sync failed: ${e?.message}`))
  setTimeout(run, 15_000)
  setInterval(run, every).unref()
}
