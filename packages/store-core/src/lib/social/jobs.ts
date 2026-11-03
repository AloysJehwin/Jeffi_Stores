import crypto from 'crypto'
import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { enqueueSocialPost, type SocialPlatform } from '@/lib/tenant-registry'
import { getCurrentTenantId } from '@/lib/tenancy/tenant-context'
import { queryMany } from '@/lib/shared/db'
import { authFor, listAccounts } from './accounts'
import { networkOf, providerFor } from './providers'
import type { Network } from './providers/types'

// Per-store social jobs (the cron fan-out runs them in each store's context): post metrics every
// 6 hours for 30 days after posting, comments and reviews into the inbox every 15 minutes, and
// auto-post rules every 15 minutes.

const INSIGHT_DAYS = 30
const AUTOPOST_PER_RULE = 5

const tenantFilter = (tenantId: string | null, col = 'tenant_id', idx = 1) =>
  tenantId ? { sql: `${col} = $${idx}`, args: [tenantId] } : { sql: `${col} IS NULL`, args: [] as string[] }

interface PostedRow {
  id: string
  platform: string
  posted_id: string
}

async function postedByNetwork(tenantId: string | null): Promise<Map<Network, PostedRow[]>> {
  const t = tenantFilter(tenantId)
  const r = await controlPlanePool().query(
    `SELECT id, platform, posted_id FROM scheduled_social_posts
     WHERE ${t.sql} AND status = 'posted' AND posted_id IS NOT NULL AND scheduled_at > now() - interval '${INSIGHT_DAYS} days'`,
    t.args
  )
  const out = new Map<Network, PostedRow[]>()
  for (const row of r.rows as PostedRow[]) {
    const n = networkOf(row.platform)
    out.set(n, [...(out.get(n) ?? []), row])
  }
  return out
}

export async function hasSocialAccounts(tenantId = getCurrentTenantId()): Promise<boolean> {
  if (!tenantId) return !!process.env.META_JEFFI_PAGE_TOKEN || (await listAccounts(null)).length > 0
  return (await listAccounts(tenantId)).length > 0
}

export interface JobSummary {
  networks: Record<string, number | string>
}

export async function refreshSocialInsights(tenantId = getCurrentTenantId()): Promise<JobSummary> {
  const summary: JobSummary = { networks: {} }
  for (const [network, posts] of await postedByNetwork(tenantId)) {
    const p = providerFor(network)
    if (!p.metrics) continue
    try {
      const auth = await authFor(tenantId, network)
      if (!auth) continue
      const byExternal = new Map(posts.map(x => [x.posted_id, x.id]))
      const metrics = await p.metrics(auth, [...byExternal.keys()])
      let n = 0
      for (const [ext, m] of Object.entries(metrics)) {
        const postId = byExternal.get(ext)
        if (!postId) continue
        await controlPlanePool().query(
          `INSERT INTO social_post_insights (post_id, impressions, reach, likes, comments, shares, saves, clicks, video_views, fetched_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
           ON CONFLICT (post_id) DO UPDATE SET impressions = EXCLUDED.impressions, reach = EXCLUDED.reach, likes = EXCLUDED.likes,
             comments = EXCLUDED.comments, shares = EXCLUDED.shares, saves = EXCLUDED.saves, clicks = EXCLUDED.clicks,
             video_views = EXCLUDED.video_views, fetched_at = now()`,
          [postId, m.impressions ?? null, m.reach ?? null, m.likes ?? null, m.comments ?? null, m.shares ?? null, m.saves ?? null, m.clicks ?? null, m.videoViews ?? null]
        )
        n++
      }
      summary.networks[network] = n
    } catch (e: any) {
      summary.networks[network] = `error: ${String(e?.message ?? e).slice(0, 160)}`
    }
  }
  return summary
}

export async function syncSocialInbox(tenantId = getCurrentTenantId()): Promise<JobSummary> {
  const summary: JobSummary = { networks: {} }
  const posted = await postedByNetwork(tenantId)
  // Reviews (Business Profile) are not tied to a post, so that network is checked even with no posts.
  const networks = new Set<Network>([...posted.keys()])
  if ((await listAccounts(tenantId)).some(a => a.provider === 'gbp' && a.status === 'connected')) networks.add('gbp')
  for (const network of networks) {
    const p = providerFor(network)
    if (!p.inbox) continue
    try {
      const auth = await authFor(tenantId, network)
      if (!auth) continue
      const rows = posted.get(network) ?? []
      const postIdOf = new Map(rows.map(x => [x.posted_id, x.id]))
      const items = await p.inbox(auth, rows.map(x => x.posted_id))
      for (const it of items) {
        await controlPlanePool().query(
          `INSERT INTO social_inbox (tenant_id, network, kind, external_id, post_id, author, text, rating, created_at, replied_at, reply_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $10 THEN now() END, CASE WHEN $10 THEN 'on ${p.label}' END)
           ON CONFLICT (network, external_id) DO UPDATE SET text = EXCLUDED.text, rating = EXCLUDED.rating, fetched_at = now(),
             replied_at = COALESCE(social_inbox.replied_at, EXCLUDED.replied_at), reply_by = COALESCE(social_inbox.reply_by, EXCLUDED.reply_by)`,
          [tenantId, network, it.kind, it.externalId, it.postExternalId ? (postIdOf.get(it.postExternalId) ?? null) : null, it.author, it.text, it.rating ?? null, it.createdAt, !!it.replied]
        )
      }
      summary.networks[network] = items.length
    } catch (e: any) {
      summary.networks[network] = `error: ${String(e?.message ?? e).slice(0, 160)}`
    }
  }
  return summary
}

export async function replyToInboxItem(tenantId: string | null, id: string, text: string, by: string | null): Promise<void> {
  const t = tenantFilter(tenantId, 'tenant_id', 2)
  const r = await controlPlanePool().query(`SELECT network, kind, external_id FROM social_inbox WHERE id = $1 AND ${t.sql}`, [id, ...t.args])
  const item = r.rows[0]
  if (!item) throw Object.assign(new Error('Not found'), { status: 404 })
  const p = providerFor(item.network)
  if (!p.reply) throw Object.assign(new Error(`${p.label} replies are not supported`), { status: 400 })
  const auth = await authFor(tenantId, item.network)
  if (!auth) throw Object.assign(new Error(`${p.label} is not connected`), { status: 409 })
  await p.reply(auth, { externalId: item.external_id, kind: item.kind }, text)
  await controlPlanePool().query(`UPDATE social_inbox SET replied_at = now(), reply_text = $2, reply_by = $3, is_read = true WHERE id = $1`, [id, text, by])
}

// ── Auto-post rules ──

interface ProductState {
  id: string
  name: string
  slug: string
  price: number
  in_stock: boolean
  created_at: string
  image_url: string | null
}

interface Seen {
  in_stock: boolean | null
  price: number | null
}

export type Trigger = 'new_product' | 'back_in_stock' | 'price_drop'

/** Which rules a product's change fires, against what we saw last run. A product never seen
 * before only counts as new when it was created in the last day (so a first run posts nothing). */
export function triggersFor(p: ProductState, seen: Seen | undefined, minDropPct: number, now = Date.now()): Trigger[] {
  const out: Trigger[] = []
  if (!seen) {
    if (now - new Date(p.created_at).getTime() < 86_400_000) out.push('new_product')
    return out
  }
  if (seen.in_stock === false && p.in_stock) out.push('back_in_stock')
  if (seen.price != null && p.price > 0 && p.price <= seen.price * (1 - minDropPct / 100)) out.push('price_drop')
  return out
}

export function fillTemplate(tpl: string, p: { name: string; price: number; url: string; oldPrice?: number | null }): string {
  return tpl
    .replace(/\{name\}/g, p.name)
    .replace(/\{price\}/g, `Rs ${Math.round(p.price).toLocaleString('en-IN')}`)
    .replace(/\{old_price\}/g, p.oldPrice ? `Rs ${Math.round(p.oldPrice).toLocaleString('en-IN')}` : '')
    .replace(/\{url\}/g, p.url)
}

export async function runAutopost(tenantId = getCurrentTenantId()): Promise<{ posted: number; rules: number; firstRun?: boolean }> {
  const pool = controlPlanePool()
  const t = tenantFilter(tenantId)
  const rules = (await pool.query(`SELECT * FROM social_autopost_rules WHERE ${t.sql} AND enabled`, t.args)).rows
  if (!rules.length) return { posted: 0, rules: 0 }
  const key = tenantId ?? '00000000-0000-0000-0000-000000000000'

  const products = await queryMany<ProductState>(
    `SELECT p.id, p.name, p.slug, p.base_price::float AS price, (p.stock_status IS DISTINCT FROM 'Out of Stock') AS in_stock, p.created_at,
       (SELECT i.image_url FROM product_images i WHERE i.product_id = p.id ORDER BY i.is_primary DESC NULLS LAST, i.created_at LIMIT 1) AS image_url
     FROM products p WHERE p.is_active`
  )
  const seenRows = (await pool.query(`SELECT product_id, in_stock, price::float AS price FROM social_autopost_seen WHERE tenant_id = $1`, [key])).rows
  const seen = new Map<string, Seen>(seenRows.map((r: any) => [r.product_id, { in_stock: r.in_stock, price: r.price }]))
  const firstRun = seen.size === 0

  let posted = 0
  if (!firstRun) {
    const { productUrl } = await import('./product-url')
    const { storeBaseUrlAsync } = await import('@/lib/catalog/brand')
    const base = tenantId ? await storeBaseUrlAsync() : undefined
    const templates = new Map<string, any>(
      (await pool.query(`SELECT id, caption, hashtags FROM social_templates WHERE ${t.sql}`, t.args)).rows.map((x: any) => [x.id, x])
    )
    for (const rule of rules) {
      let n = 0
      for (const p of products) {
        if (n >= AUTOPOST_PER_RULE) break
        const prev = seen.get(p.id)
        if (!triggersFor(p, prev, Number(rule.min_drop_pct), Date.now()).includes(rule.trigger)) continue
        if (!p.image_url) continue
        const url = productUrl(p.slug, base)
        const tpl = rule.template_id ? templates.get(rule.template_id) : null
        const groupId = crypto.randomUUID()
        for (const platform of rule.platforms as SocialPlatform[]) {
          if (platform === 'ig_reel' || platform === 'youtube') continue
          await enqueueSocialPost({
            tenantId,
            productId: p.id,
            platform,
            caption: tpl ? fillTemplate(tpl.caption, { name: p.name, price: p.price, url, oldPrice: prev?.price }) : null,
            hashtags: tpl?.hashtags ?? null,
            imageUrl: p.image_url,
            groupId,
            title: p.name,
            approvalStatus: rule.require_approval ? 'pending' : 'none',
            source: 'autopost',
            autopostRuleId: rule.id,
          })
        }
        n++
        posted++
      }
    }
  }

  if (products.length) {
    await pool.query(
      `INSERT INTO social_autopost_seen (tenant_id, product_id, in_stock, price, seen_at)
       SELECT $1, u.id, u.in_stock, u.price, now() FROM unnest($2::uuid[], $3::boolean[], $4::numeric[]) AS u(id, in_stock, price)
       ON CONFLICT (tenant_id, product_id) DO UPDATE SET in_stock = EXCLUDED.in_stock, price = EXCLUDED.price, seen_at = now()`,
      [key, products.map(p => p.id), products.map(p => p.in_stock), products.map(p => p.price)]
    )
  }
  return { posted, rules: rules.length, ...(firstRun ? { firstRun: true } : {}) }
}
