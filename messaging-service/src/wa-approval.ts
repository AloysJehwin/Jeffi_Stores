import type pg from 'pg'
import type { ServiceScope } from '@jeffi/tenancy'
import { db } from './db.js'
import { poolsForTenant } from './pools.js'
import * as tpl from './templates-v2.js'
import * as twContent from './providers/twilio-content.js'
import { metaSamples, planSlots, validateForMeta, type WaBlocks as Blocks, type WaButton as Button } from '@jeffi/api-contracts'

export { extraSlots, samplesFor, validateForMeta } from '@jeffi/api-contracts'

/**
 * Meta requires image/button variables to continue the body's numbering, and {{brand_name}} is the
 * slot right after the body's own. The stored template keeps the editor's numbering; only the
 * submission payload is renumbered (see planSlots).
 */
export function renumberForSubmit(body: string, blocks: Blocks | null | undefined, samples: Record<string, string>)
  : { body: string; blocks: Blocks; samples: Record<string, string> } {
  const p = planSlots(body, blocks, samples)
  return { body: p.body, blocks: p.blocks, samples: p.samples }
}

// WhatsApp template → Twilio Content → Meta approval.
// The variant's provider_ref is always the LIVE (approved) SID that sends use. A submission puts its
// new SID on the submitted version only; sync promotes it to the variant once Meta approves, so a
// pending or rejected edit never breaks sending.

function actions(buttons: Button[] | undefined) {
  return (buttons ?? []).filter(b => b.label?.trim()).map(b =>
    b.type === 'quick_reply' ? { type: 'QUICK_REPLY', title: b.label.trim(), id: b.label.trim().toLowerCase().replace(/\W+/g, '_') }
    : b.type === 'url' ? { type: 'URL', title: b.label.trim(), url: b.value ?? '' }
    : { type: 'PHONE_NUMBER', title: b.label.trim(), phone: b.value ?? '' })
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
  const samples = metaSamples(t.version.body, blocks)
  const outbound = renumberForSubmit(t.version.body, blocks, samples)
  const errors = validateForMeta(t.version.body, blocks, samples)
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status: 422, errors })
  const category = (opts.category ?? t.variant.meta_category ?? 'UTILITY') as 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  const name = opts.name || metaName(opts.space === 'api' ? `${tenantSlug ?? 'jeffi'}_api` : tenantSlug, t.family.slug, t.version.version)
  const content = await twContent.createContent({
    friendly_name: name, language: t.variant.locale, types: composeTypes(outbound.body, outbound.blocks), variables: outbound.samples,
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
