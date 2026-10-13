/* eslint-disable no-console */
// Pull every template that lives inside campaigns / the mailer into the messaging-templates library.
//
//   npx tsx scripts/import-campaign-templates.ts --generate   # standards → messaging-service/seed/campaign-catalog.json
//   (then: cd messaging-service && npm run seed:catalog)       # seeds them for the platform tenant
//   npx tsx scripts/import-campaign-templates.ts --tenants    # each tenant's edited campaigns → its own copies
//
// Standards: every built-in campaign kind's email (code default, else the flagship's stored row) and SMS
// line → campaign/<kind>; layout starter bodies → starter/<layout>; mailer templates → messaging/<key>.
// A tenant's campaign whose content differs from the standard becomes that tenant's copy of the same
// slug, so linking campaign → campaign/<kind> resolves to their version. Idempotent. LOCAL by default.
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { writeFileSync } from 'node:fs'
import pg from 'pg'
import { BUILTIN_TEMPLATES } from '@/lib/campaigns/default-templates'
import { EMAIL_LAYOUT_OPTIONS } from '@/lib/templates/email-layouts'
import { serviceToken } from '@/lib/messaging/library'

const OUT = 'messaging-service/seed/campaign-catalog.json'
const MESSAGING_URL = (process.env.MESSAGING_URL || 'http://localhost:3101').replace(/\/$/, '')
const PLATFORM = '00000000-0000-0000-0000-000000000000'
// review_request mails a hard-coded AMP email (ignores its stored body), so only its SMS is imported.
const EMAIL_SKIP = new Set(['review_request'])

type Seed = { slug: string; channel: 'email' | 'sms'; name: string; category: string; subject?: string; body: string; blocks_format: string; blocks?: unknown }

// Token versions of the hard-coded campaign SMS lines (src/lib/campaigns/whatsapp-dispatch.ts campaignSmsBody).
const SMS: Record<string, string> = {}
const sms = (kinds: string[], body: string) => kinds.forEach(k => (SMS[k] = body))
sms(['abandoned_cart', 'abandoned_checkout', 'high_value_cart'], "You left {items} in your cart. Complete your order before it's gone.")
sms(['viewed_product', 'viewed_category', 'wishlist_reminder'], "Still thinking about {items}? Take another look before it's gone.")
sms(['cart_price_drop'], 'Good news — {items} in your cart just dropped in price.')
sms(['replenishment', 'subscription_renewal'], 'Running low on {items}? Reorder in a tap.')
sms(['restock', 'back_in_stock_wishlist'], '{productName} is back in stock. Grab it before it sells out.')
sms(['review_photo_followup'], 'Add a photo to your {productName} review and help other shoppers.')
sms(['winback_90', 'winback_180', 'price_drop', 'first_purchase_nudge', 'second_purchase_nudge', 'signup_anniversary',
  'loyalty_tier_upgrade', 'loyalty_points_reminder', 'referral_invite', 'birthday'],
  '{headline}{#if couponCode} — use code {couponCode}{/if}.')
sms(['review_request', 'review_reminder', 'post_purchase'], 'How was order {orderNumber}? Share a quick review: {ctaUrl}')

// Mailer's hard-coded templates (src/lib/shared/email-campaigns.ts) as library content; the layout is applied at send.
const greet = '<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p>'
const h2 = (t: string) => `<h2 style="font-size:24px;color:#1a3a4a;margin:0 0 16px;">${t}</h2>`
const para = (t: string) => `<p style="color:#555;line-height:1.6;margin:0 0 20px;">${t}</p>`
const btn = (label: string, href: string) => `<p style="margin:20px 0 0;"><a href="${href}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">${label}</a></p>`
const MAILER: Seed[] = [
  { slug: 'messaging/promotion', name: 'Promotion', subject: '{headline}', body: greet + h2('{headline}') + para('{body}') + `{#if ctaUrl}${btn('{ctaText}', '{ctaUrl}')}{/if}` },
  { slug: 'messaging/announcement', name: 'Announcement', subject: '{headline}', body: greet + h2('{headline}') + para('{body}') + btn('Visit our store', '{store_web}') },
  { slug: 'messaging/event', name: 'Event invitation', subject: "You're invited: {eventName}", body: greet + h2('{eventName}') + '{#if eventDate}<p style="color:#e07b3f;font-weight:600;margin:0 0 16px;">{eventDate}</p>{/if}' + para('{eventDetails}') + `{#if ctaUrl}${btn('Learn more', '{ctaUrl}')}{/if}` },
  { slug: 'messaging/review-form-share', name: 'Review form share', subject: 'Share your experience — get a reward!', body: greet + h2('{formTitle}') + para("We'd love to hear what you think! Leave us a review and we'll send you a special discount as a thank-you.") + btn('Leave a review & claim reward', '{formUrl}') },
].map(s => ({ ...s, channel: 'email' as const, category: 'messaging', blocks_format: 'tiptap-html' }))

const db = () => new pg.Pool({ connectionString: process.env.DATABASE_URL })

async function standards(): Promise<Seed[]> {
  const pool = db()
  // The 26 built-in scenario kinds (src/lib/campaigns/scenarios/_registry.ts). Custom campaigns are not standards.
  const kinds = ['abandoned_cart', 'abandoned_checkout', 'post_purchase', 'review_reminder', 'review_request', 'winback_90',
    'winback_180', 'restock', 'price_drop', 'viewed_product', 'viewed_category', 'high_value_cart', 'cart_price_drop',
    'wishlist_reminder', 'review_photo_followup', 'back_in_stock_wishlist', 'first_purchase_nudge', 'second_purchase_nudge',
    'signup_anniversary', 'replenishment', 'subscription_renewal', 'loyalty_tier_upgrade', 'loyalty_points_reminder',
    'referral_invite', 'birthday', 'birthday_collect']
  const rows = new Map((await pool.query(`SELECT kind, name, subject_template, body_template FROM campaigns WHERE kind = ANY($1)`, [kinds])).rows.map(r => [r.kind, r]))
  await pool.end()
  const out: Seed[] = []
  for (const kind of kinds) {
    const row = rows.get(kind)
    const name = row?.name || kind.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
    const def = BUILTIN_TEMPLATES[kind] ?? (row ? { subject: row.subject_template, body: row.body_template } : null)
    if (def && !EMAIL_SKIP.has(kind)) out.push({ slug: `campaign/${kind}`, channel: 'email', name, category: 'campaign', subject: def.subject, body: def.body, blocks_format: 'tiptap-html' })
    if (SMS[kind]) out.push({ slug: `campaign/${kind}`, channel: 'sms', name, category: 'campaign', body: SMS[kind], blocks_format: 'sms-text' })
  }
  for (const l of EMAIL_LAYOUT_OPTIONS) if (l.starterBody)
    out.push({ slug: `starter/${l.key}`, channel: 'email', name: `${l.label} starter`, category: 'starter', subject: '{store_name}', body: l.starterBody, blocks_format: 'tiptap-html' })
  return [...out, ...MAILER]
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

async function upsert(tenantId: string, tenantSlug: string, slug: string, t: Omit<Seed, 'slug'>) {
  const r = await fetch(`${MESSAGING_URL}/v2/templates`, {
    method: 'POST',
    headers: { authorization: `Bearer ${serviceToken(tenantId, tenantSlug)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...t, slug, publish: true }),
  })
  if (!r.ok) throw new Error(`${slug}: HTTP ${r.status} ${await r.text()}`)
}

async function tenants() {
  const std = new Map((await standards()).map(s => [`${s.channel}|${s.slug}`, s]))
  const { lookupTenantContextById, tenantPool } = await import('@jeffi/tenancy')
  const cp = db()
  const ids = (await cp.query(`SELECT id FROM tenants WHERE status='active' AND id <> $1`, [PLATFORM])).rows.map(r => r.id)
  await cp.end()
  for (const id of ids) {
    const ctx = await lookupTenantContextById(id)
    if (!ctx?.infra?.rdsEndpoint) { console.log(`skip ${id}: no tenant DB`); continue }
    const rows = (await tenantPool(ctx).query(`SELECT kind, name, subject_template, body_template, template_mode, blocks, sms_template FROM campaigns`)).rows
    let n = 0
    for (const r of rows) {
      const slug = `campaign/${r.kind}`
      const e = std.get(`email|${slug}`)
      const isBlocks = r.template_mode === 'blocks' && Array.isArray(r.blocks) && r.blocks.length
      // Rows still holding the seed placeholder (ensure-builtin-campaigns fallback) aren't customisations.
      const placeholder = / — a note for \{firstName\}$/.test(r.subject_template ?? '')
      const custom = !placeholder && (!e || isBlocks || norm(e.subject) !== norm(r.subject_template) || norm(e.body) !== norm(r.body_template))
      if (custom && !EMAIL_SKIP.has(r.kind) && (r.body_template || isBlocks)) {
        const { renderBlocks } = await import('@/lib/templates/blocks')
        await upsert(id, ctx.slug, slug, isBlocks
          ? { channel: 'email', name: r.name, category: 'campaign', subject: r.subject_template, body: renderBlocks(r.blocks), blocks_format: 'email-blocks', blocks: { blocks: r.blocks } }
          : { channel: 'email', name: r.name, category: 'campaign', subject: r.subject_template, body: r.body_template, blocks_format: 'tiptap-html' })
        n++
      }
      if (norm(r.sms_template) && norm(r.sms_template) !== norm(std.get(`sms|${slug}`)?.body)) {
        await upsert(id, ctx.slug, slug, { channel: 'sms', name: r.name, category: 'campaign', body: r.sms_template, blocks_format: 'sms-text' }); n++
      }
    }
    console.log(`${ctx.slug}: ${n} customised template(s) imported`)
  }
}

async function main() {
  const mode = process.argv[2]
  if (mode === '--generate') {
    const s = await standards()
    writeFileSync(OUT, JSON.stringify(s, null, 2) + '\n')
    console.log(`wrote ${s.length} standard templates → ${OUT}`)
  } else if (mode === '--tenants') {
    await tenants()
  } else {
    console.log('usage: --generate | --tenants')
  }
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1) })
