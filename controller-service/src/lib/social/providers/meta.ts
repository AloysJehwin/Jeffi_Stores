import {
  publishFacebookCarousel,
  publishFacebookPost,
  publishInstagramCarousel,
  publishInstagramImage,
  publishInstagramReel,
} from '@/lib/catalog/meta'
import { fetchWithRetry } from '@/lib/channels/ratelimit'
import { SocialApiError, type InboxItem, type Network, type PostMetrics, type SocialAuth, type SocialProvider } from './types'

// Facebook Pages and Instagram Business through the Graph API. Publishing reuses lib/catalog/meta;
// insights, comments and replies are here. Connection stays on the existing Meta flow (Page token).

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v21.0'}`

async function graph(network: Network, path: string, params: Record<string, string>, token: string, method: 'GET' | 'POST' = 'GET'): Promise<any> {
  const qs = new URLSearchParams({ ...params, access_token: token })
  const res = await fetchWithRetry(method === 'GET' ? `${GRAPH}/${path}?${qs}` : `${GRAPH}/${path}`, {
    method,
    ...(method === 'POST' ? { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs } : {}),
  })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok || json?.error) throw new SocialApiError(network, res.status, `${network === 'facebook' ? 'Facebook' : 'Instagram'}: ${json?.error?.message ?? `HTTP ${res.status}`}`)
  return json
}

const num = (v: unknown) => (v == null ? undefined : Number(v))

/** Graph insights array ([{name, values:[{value}]}]) to a name -> number map. */
export function insightValues(data: any[] | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of data ?? []) {
    const v = m?.values?.[0]?.value ?? m?.total_value?.value
    if (typeof v === 'number') out[m.name] = v
  }
  return out
}

export const facebookProvider: SocialProvider = {
  network: 'facebook',
  label: 'Facebook',
  limits: { caption: 63_206 },
  requires: {},
  async publish(auth, input) {
    const message = input.caption
    const r =
      input.imageUrls.length >= 2
        ? await publishFacebookCarousel({ pageId: auth.targetId, message, imageUrls: input.imageUrls, accessToken: auth.accessToken })
        : await publishFacebookPost({ pageId: auth.targetId, message, imageUrl: input.imageUrls[0], link: input.link ?? null, accessToken: auth.accessToken })
    return { externalId: r.id, url: `https://www.facebook.com/${r.id}` }
  },
  async metrics(auth, ids) {
    const out: Record<string, PostMetrics> = {}
    for (const id of ids) {
      const j = await graph(
        'facebook',
        id,
        { fields: 'insights.metric(post_impressions,post_impressions_unique,post_clicks),reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares' },
        auth.accessToken
      ).catch(() => null)
      if (!j) continue
      const i = insightValues(j.insights?.data)
      out[id] = {
        impressions: i.post_impressions,
        reach: i.post_impressions_unique,
        clicks: i.post_clicks,
        likes: num(j.reactions?.summary?.total_count),
        comments: num(j.comments?.summary?.total_count),
        shares: num(j.shares?.count) ?? 0,
      }
    }
    return out
  },
  async inbox(auth, ids) {
    const items: InboxItem[] = []
    for (const id of ids) {
      const j = await graph('facebook', `${id}/comments`, { fields: 'id,message,from{name},created_time,comment_count', limit: '50', order: 'reverse_chronological' }, auth.accessToken).catch(() => null)
      for (const c of j?.data ?? []) {
        items.push({ externalId: c.id, postExternalId: id, kind: 'comment', author: c.from?.name ?? null, text: c.message ?? null, createdAt: c.created_time ?? null, replied: Number(c.comment_count ?? 0) > 0 })
      }
    }
    return items
  },
  async reply(auth, item, text) {
    await graph('facebook', `${item.externalId}/comments`, { message: text }, auth.accessToken, 'POST')
  },
}

export const instagramProvider: SocialProvider = {
  network: 'instagram',
  label: 'Instagram',
  limits: { caption: 2200, hashtags: 30 },
  requires: { image: true },
  async publish(auth, input) {
    const caption = input.caption
    const r = input.videoUrl
      ? await publishInstagramReel({ igUserId: auth.targetId, videoUrl: input.videoUrl, caption, accessToken: auth.accessToken })
      : input.imageUrls.length >= 2
        ? await publishInstagramCarousel({ igUserId: auth.targetId, imageUrls: input.imageUrls, caption, accessToken: auth.accessToken })
        : await publishInstagramImage({ igUserId: auth.targetId, imageUrl: input.imageUrls[0], caption, accessToken: auth.accessToken })
    const link = await graph('instagram', r.id, { fields: 'permalink' }, auth.accessToken).catch(() => null)
    return { externalId: r.id, url: link?.permalink ?? null }
  },
  async metrics(auth, ids) {
    const out: Record<string, PostMetrics> = {}
    for (const id of ids) {
      const j = await graph('instagram', `${id}/insights`, { metric: 'reach,likes,comments,shares,saved,views' }, auth.accessToken).catch(() => null)
      if (!j) continue
      const i = insightValues(j.data)
      out[id] = { reach: i.reach, impressions: i.views, likes: i.likes, comments: i.comments, shares: i.shares, saves: i.saved, videoViews: i.views }
    }
    return out
  },
  async inbox(auth, ids) {
    const items: InboxItem[] = []
    for (const id of ids) {
      const j = await graph('instagram', `${id}/comments`, { fields: 'id,text,username,timestamp,replies.limit(1){id}', limit: '50' }, auth.accessToken).catch(() => null)
      for (const c of j?.data ?? []) {
        items.push({ externalId: c.id, postExternalId: id, kind: 'comment', author: c.username ?? null, text: c.text ?? null, createdAt: c.timestamp ?? null, replied: !!c.replies?.data?.length })
      }
    }
    return items
  },
  async reply(auth, item, text) {
    await graph('instagram', `${item.externalId}/replies`, { message: text }, auth.accessToken, 'POST')
  },
}

export type { SocialAuth }
