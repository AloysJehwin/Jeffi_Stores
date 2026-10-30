import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { queryMany } from '@/lib/shared/db'
import { oauthProviderInfo } from '@/lib/integrations/oauth'
import { connectionInfo, listAccounts } from './accounts'
import { NETWORK_LABEL, socialRedirectUri } from './oauth'
import { NETWORKS, networkOf, providerFor } from './providers'

// Read side of the social console: the post calendar with metrics, insights with orders and
// revenue from each post's UTM campaign, the inbox, templates, auto-post rules and connections.

const scope = (tenantId: string | null, col = 'tenant_id', idx = 1) =>
  tenantId ? { sql: `${col} = $${idx}`, args: [tenantId] as unknown[] } : { sql: `${col} IS NULL`, args: [] as unknown[] }

export const campaignKey = (p: { id: string; group_id?: string | null }) => `social_${p.group_id ?? p.id}`

/** Orders and revenue per social_<post or group> campaign, from the store's own orders. */
export async function revenueByCampaign(days: number): Promise<Map<string, { orders: number; revenue: number }>> {
  const rows = await queryMany<any>(
    `SELECT lower(utm_campaign) AS c, count(*) AS orders, COALESCE(SUM(total_amount), 0) AS revenue FROM orders
     WHERE utm_campaign ILIKE 'social\\_%' AND status <> 'cancelled' AND created_at > now() - make_interval(days => $1)
     GROUP BY 1`,
    [days]
  ).catch(() => [])
  return new Map(rows.map(r => [r.c, { orders: Number(r.orders), revenue: Number(r.revenue) }]))
}

export async function listPosts(tenantId: string | null, opts: { from?: string; to?: string; limit?: number } = {}) {
  const s = scope(tenantId, 'p.tenant_id')
  const args = [...s.args]
  const where = [s.sql]
  if (opts.from) {
    args.push(opts.from)
    where.push(`p.scheduled_at >= $${args.length}`)
  }
  if (opts.to) {
    args.push(opts.to)
    where.push(`p.scheduled_at < $${args.length}`)
  }
  args.push(opts.limit ?? 300)
  const r = await controlPlanePool().query(
    `SELECT p.*, i.impressions, i.reach, i.likes, i.comments, i.shares, i.saves, i.clicks, i.video_views, i.fetched_at AS insights_at
     FROM scheduled_social_posts p LEFT JOIN social_post_insights i ON i.post_id = p.id
     WHERE ${where.join(' AND ')} ORDER BY p.scheduled_at DESC LIMIT $${args.length}`,
    args
  )
  return r.rows
}

export async function loadInsights(tenantId: string | null, days: number) {
  const s = scope(tenantId, 'p.tenant_id')
  const r = await controlPlanePool().query(
    `SELECT p.id, p.group_id, p.platform, p.caption, p.title, p.permalink, p.scheduled_at,
       i.impressions, i.reach, i.likes, i.comments, i.shares, i.saves, i.clicks, i.video_views
     FROM scheduled_social_posts p LEFT JOIN social_post_insights i ON i.post_id = p.id
     WHERE ${s.sql} AND p.status = 'posted' AND p.scheduled_at > now() - make_interval(days => $${s.args.length + 1})
     ORDER BY p.scheduled_at DESC LIMIT 500`,
    [...s.args, days]
  )
  const revenue = await revenueByCampaign(days + 7)
  const n = (v: unknown) => Number(v ?? 0)
  const engagement = (p: any) => n(p.likes) + n(p.comments) + n(p.shares) + n(p.saves)
  const byNetwork = new Map<string, { posts: number; impressions: number; reach: number; engagement: number; clicks: number }>()
  for (const p of r.rows) {
    const net = providerFor(networkOf(p.platform)).label
    const b = byNetwork.get(net) ?? { posts: 0, impressions: 0, reach: 0, engagement: 0, clicks: 0 }
    b.posts++
    b.impressions += n(p.impressions)
    b.reach += n(p.reach)
    b.engagement += engagement(p)
    b.clicks += n(p.clicks)
    byNetwork.set(net, b)
  }
  // Revenue is attributed to the group (one compose sent to several networks), counted once.
  const seenCampaigns = new Set<string>()
  let orders = 0
  let rev = 0
  const posts = r.rows.map((p: any) => {
    const key = campaignKey(p).toLowerCase()
    const hit = revenue.get(key)
    if (hit && !seenCampaigns.has(key)) {
      seenCampaigns.add(key)
      orders += hit.orders
      rev += hit.revenue
    }
    return { ...p, engagement: engagement(p), orders: hit?.orders ?? 0, revenue: hit?.revenue ?? 0 }
  })
  const totals = [...byNetwork.values()].reduce(
    (a, b) => ({ posts: a.posts + b.posts, impressions: a.impressions + b.impressions, reach: a.reach + b.reach, engagement: a.engagement + b.engagement, clicks: a.clicks + b.clicks }),
    { posts: 0, impressions: 0, reach: 0, engagement: 0, clicks: 0 }
  )
  return {
    totals: { ...totals, orders, revenue: rev },
    byNetwork: [...byNetwork.entries()].map(([network, v]) => ({ network, ...v })),
    top: [...posts].sort((a, b) => b.revenue - a.revenue || b.engagement - a.engagement).slice(0, 20),
  }
}

export async function listInbox(tenantId: string | null, filter: 'open' | 'all' = 'open') {
  const s = scope(tenantId, 'b.tenant_id')
  const r = await controlPlanePool().query(
    `SELECT b.*, p.caption AS post_caption, p.permalink AS post_permalink FROM social_inbox b
     LEFT JOIN scheduled_social_posts p ON p.id = b.post_id
     WHERE ${s.sql} ${filter === 'open' ? 'AND b.replied_at IS NULL' : ''}
     ORDER BY b.created_at DESC NULLS LAST LIMIT 200`,
    s.args
  )
  return r.rows
}

export async function listTemplates(tenantId: string | null) {
  const s = scope(tenantId)
  return (await controlPlanePool().query(`SELECT * FROM social_templates WHERE ${s.sql} ORDER BY name`, s.args)).rows
}

export async function listAutopostRules(tenantId: string | null) {
  const s = scope(tenantId)
  return (await controlPlanePool().query(`SELECT * FROM social_autopost_rules WHERE ${s.sql} ORDER BY created_at`, s.args)).rows
}

/** Every network with its connection state and whether the platform has its app credentials. */
export async function listConnections(tenantId: string | null) {
  const rows = await listAccounts(tenantId)
  const meta = oauthProviderInfo('meta')
  return NETWORKS.map(network => {
    const p = providerFor(network)
    const row = rows.find(a => a.provider === network)
    const missing = network === 'facebook' || network === 'instagram' ? meta.missing : (p.oauth?.env ?? []).filter(k => !process.env[k])
    const isMeta = network === 'facebook' || network === 'instagram'
    const platformEnv = !tenantId && !row && isMeta && !!process.env.META_JEFFI_PAGE_TOKEN
    const info = row && !isMeta ? connectionInfo(row) : null
    return {
      network,
      label: NETWORK_LABEL[network],
      status: platformEnv ? 'connected' : (row?.status ?? 'not_connected'),
      target: platformEnv ? 'Platform page (env)' : row?.page_name ?? row?.page_id ?? null,
      tokenExpiry: row?.token_expiry ?? null,
      via: info?.via ?? null,
      ownApp: info?.ownApp ?? false,
      configured: missing.length === 0,
      missing,
      redirectUri: network === 'facebook' || network === 'instagram' ? meta.redirectUri : socialRedirectUri(),
      limits: p.limits,
      requires: p.requires,
      features: { insights: !!p.metrics, inbox: !!p.inbox, reply: !!p.reply },
    }
  })
}
