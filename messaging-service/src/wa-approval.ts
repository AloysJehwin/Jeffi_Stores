import type pg from 'pg'
import type { ServiceScope } from '@jeffi/tenancy'
import { db } from './db.js'
import { poolsForTenant } from './pools.js'
import * as tpl from './templates-v2.js'
import * as twContent from './providers/twilio-content.js'
import * as aws from './providers/aws.js'
import { messagingProvider } from './providers/policy.js'
import { MEDIA_CDN_URL } from '@jeffi/tenancy'
import type { TemplateSummary } from '@aws-sdk/client-socialmessaging'
import {
  formatAwsTemplateRef, isAwsTemplateRef, metaSamples, parseAwsTemplateRef, placeholders, planSlots, validateForMeta,
  type AwsTemplateRef, type WaBlocks as Blocks, type WaButton as Button, type WaSlotPlan,
} from '@jeffi/api-contracts'

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

// WhatsApp template → Twilio Content (or AWS End User Messaging, per the tenant's provider) → Meta approval.
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
  // A tenant on AWS resubmits versions approved on Twilio; only an AWS submission counts there.
  const onAws = (await messagingProvider(tenantId, 'whatsapp')) === 'aws'
  if (t.version.provider_ref && (!onAws || isAwsTemplateRef(t.version.provider_ref)) && ['pending', 'received', 'approved'].includes(t.variant.approval_status))
    throw Object.assign(new Error('This version is already submitted. Edit and save to submit a new version.'), { status: 409 })
  const blocks = (t.version.blocks ?? {}) as Blocks
  const samples = metaSamples(t.version.body, blocks)
  const outbound = renumberForSubmit(t.version.body, blocks, samples)
  const errors = validateForMeta(t.version.body, blocks, samples)
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status: 422, errors })
  const category = (opts.category ?? t.variant.meta_category ?? 'UTILITY') as 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  const name = opts.name || metaName(opts.space === 'api' ? `${tenantSlug ?? 'jeffi'}_api` : tenantSlug, t.family.slug, t.version.version)
  if (onAws) return submitAws(pool, t, name, category, planSlots(t.version.body, blocks, samples))
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

// AWS End User Messaging: the template goes straight to Meta through Social Messaging. The ref
// `aws:<name>:<lang>` (+ header/button slots) takes the place of the Twilio content SID.

const PH1 = /\{\{\s*\d+\s*\}\}/
const headerKind = (url: string): 'image' | 'video' | 'document' =>
  /\.mp4(\?|$)/i.test(url) ? 'video' : /\.pdf(\?|$)/i.test(url) ? 'document' : 'image'

/** The header media URL with its sample filled in (what Meta reviews), if the template has one. */
export function headerSample(plan: WaSlotPlan): string | null {
  const media: string | undefined = plan.blocks.types?.['twilio/media']?.media?.[0]
  if (!media) return null
  return plan.media ? media.replace(PH1, plan.samples[plan.media.to] ?? '') : media
}

// template_variant/version.provider_ref is varchar(80): a long name is cut, keeping its _v<n>.
const MAX_REF = 80
function fitName(name: string, len: number) {
  const tail = name.match(/_v\d+$/)?.[0] ?? ''
  return name.slice(0, Math.max(1, len - tail.length)).replace(/_+$/, '') + tail
}

/** Meta's template definition (what CreateWhatsAppMessageTemplate takes) and the ref sends use. */
export function awsTemplate(rawName: string, locale: string, category: string, plan: WaSlotPlan, headerHandle?: string) {
  const b = plan.blocks
  const lang = locale.replace(/-/g, '_')
  let name = rawName.toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 512)
  if (b.carousel?.cards?.some(c => c.body || c.title || c.media_url))
    throw Object.assign(new Error('Carousel templates are not supported on AWS yet.'), { status: 422 })
  const components: any[] = []
  let header: AwsTemplateRef['header']
  const sample = headerSample(plan)
  if (sample) {
    const kind = headerKind(sample)
    components.push({ type: 'HEADER', format: kind.toUpperCase(), ...(headerHandle ? { example: { header_handle: [headerHandle] } } : {}) })
    // A fixed header still needs its link on every send: give it the slot after all the others.
    const top = Math.max(0, ...placeholders(plan.body).map(Number), ...plan.links.map(l => Number(l?.to ?? 0)))
    header = { slot: plan.media?.to ?? String(top + 1), kind }
  }
  const bodySlots = placeholders(plan.body)
  components.push({ type: 'BODY', text: plan.body, ...(bodySlots.length ? { example: { body_text: [bodySlots.map(s => plan.samples[s] ?? '')] } } : {}) })
  const buttons: AwsTemplateRef['buttons'] = []
  const btns = (b.buttons ?? []).map((btn, i) => ({ btn, link: plan.links[i] })).filter(x => x.btn.label?.trim())
  if (btns.length) components.push({ type: 'BUTTONS', buttons: btns.map(({ btn, link }, index) => {
    const text = btn.label.trim()
    if (btn.type === 'quick_reply') return { type: 'QUICK_REPLY', text }
    if (btn.type === 'phone') return { type: 'PHONE_NUMBER', text, phone_number: btn.value ?? '' }
    const url = btn.value ?? ''
    if (!link || !PH1.test(url)) return { type: 'URL', text, url }
    // Meta numbers a button's own variable {{1}}; sends fill it from the plan's slot.
    buttons.push({ slot: link.to, index })
    return { type: 'URL', text, url: url.replace(PH1, '{{1}}'), example: [url.replace(PH1, plan.samples[link.to] ?? '')] }
  }) })
  let ref = formatAwsTemplateRef({ name, lang, header, buttons })
  if (ref.length > MAX_REF) {
    name = fitName(name, name.length - (ref.length - MAX_REF))
    ref = formatAwsTemplateRef({ name, lang, header, buttons })
  }
  return { name, ref, definition: { name, language: lang, category, components } }
}

// Header samples are reviewed from S3: the media CDN fronts the default bucket.
function cdnObject(url: string) {
  const u = new URL(url)
  if (u.origin !== new URL(MEDIA_CDN_URL).origin)
    throw Object.assign(new Error(`The header sample must be on our media CDN (${MEDIA_CDN_URL}) for AWS review.`), { status: 422 })
  return { bucket: process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket', key: decodeURIComponent(u.pathname.replace(/^\//, '')) }
}

async function submitAws(pool: pg.Pool, t: NonNullable<Awaited<ReturnType<typeof tpl.findById>>>, rawName: string, category: string, plan: WaSlotPlan) {
  if (!aws.awsTemplatesConfigured()) throw Object.assign(new Error('AWS messaging is not configured (AWS_WHATSAPP_WABA_ID)'), { status: 503 })
  const sample = headerSample(plan)
  const object = sample ? cdnObject(sample) : null
  let res: Awaited<ReturnType<typeof aws.createTemplate>>
  let ref: string, name: string
  try {
    const handle = object ? await aws.templateMediaHandle(object.bucket, object.key) : undefined
    const built = awsTemplate(rawName, t.variant!.locale, category, plan, handle)
    ref = built.ref
    name = built.name
    res = await aws.createTemplate(built.definition)
  } catch (e: any) {
    if (e?.status) throw e
    throw Object.assign(new Error(`Meta submission failed: ${(e as Error).message}`), { status: 502 })
  }
  const status = twContent.mapApprovalStatus(res.status)
  await pool.query(`UPDATE template_version SET provider_ref=$2 WHERE id=$1`, [t.version!.id, ref])
  await pool.query(
    `UPDATE template_variant SET meta_category=$2, approval_status=$3, approval_raw_status=$4, approval_reason=NULL,
       approval_submitted_at=now(), approval_checked_at=now(), updated_at=now() WHERE id=$1`,
    [t.variant!.id, category, status, res.status ?? null])
  // Utility templates can come back approved at once; sync only looks at in-flight ones.
  if (status === 'approved')
    await pool.query(`UPDATE template_variant SET provider_ref=$2, approval_approved_at=now() WHERE id=$1`, [t.variant!.id, ref])
  return { sid: ref, name, status }
}

/** One listing of the WABA's templates per sync run, keyed name:lang (and name). */
export function awsTemplateIndex() {
  let p: Promise<Map<string, TemplateSummary>> | null = null
  return () => (p ??= aws.listTemplates().then(list => {
    const m = new Map<string, TemplateSummary>()
    for (const x of list) {
      if (!x.templateName) continue
      m.set(`${x.templateName}:${x.templateLanguage ?? ''}`, x)
      if (!m.has(x.templateName)) m.set(x.templateName, x)
    }
    return m
  }))
}

/** Checks every in-flight submission of one tenant; promotes approved SIDs to live. */
export async function syncTenant(pool: pg.Pool, tenantId: string, awsIndex = awsTemplateIndex()) {
  const rows = (await pool.query<{ id: string; sid: string }>(
    `SELECT v.id, ver.provider_ref AS sid FROM template_variant v
       JOIN LATERAL (SELECT provider_ref FROM template_version
                      WHERE variant_id=v.id AND provider_ref IS NOT NULL ORDER BY version DESC LIMIT 1) ver ON true
      WHERE v.tenant_id=$1 AND v.approval_status IN ('received','pending','paused')`, [tenantId])).rows
  let checked = 0, changed = 0
  for (const r of rows) {
    try {
      if (isAwsTemplateRef(r.sid)) {
        const ref = parseAwsTemplateRef(r.sid)
        const index = await awsIndex()
        const found = index.get(`${ref.name}:${ref.lang}`) ?? index.get(ref.name)
        if (!found) continue
        const next = twContent.mapApprovalStatus(found.templateStatus)
        await tpl.setApprovalStatus(pool, r.id, { status: next, raw: found.templateStatus ?? null, approvedAt: next === 'approved' ? new Date() : null })
        if (next === 'approved') await pool.query(`UPDATE template_variant SET provider_ref=$2 WHERE id=$1`, [r.id, r.sid])
        checked++
        if (next === 'approved' || next === 'rejected') changed++
        continue
      }
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
  const awsIndex = awsTemplateIndex()
  for (const { id } of tenants) {
    try {
      const { pool } = await poolsForTenant(id)
      const r = await syncTenant(pool, id, awsIndex)
      checked += r.checked; changed += r.changed
    } catch (e: any) { if (e?.code !== '42P01') log(`wa sync ${id}: ${e?.message}`) }
  }
  return { checked, changed }
}

export function startApprovalSync(log: (m: string) => void, scope: ServiceScope) {
  const every = Number(process.env.WA_APPROVAL_SYNC_MS || 10 * 60_000)
  if (!every || (!process.env.TWILIO_ACCOUNT_SID && !aws.awsTemplatesConfigured())) return
  const run = () => syncAll(log, scope).then(r => r.checked && log(`wa approval sync: checked=${r.checked} changed=${r.changed}`)).catch(e => log(`wa approval sync failed: ${e?.message}`))
  setTimeout(run, 15_000)
  setInterval(run, every).unref()
}
