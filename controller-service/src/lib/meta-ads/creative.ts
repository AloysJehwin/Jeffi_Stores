import { query, queryMany, queryOne } from '@/lib/shared/db'
import { runChange, type ChangeOutcome } from '@/lib/channels/change-log'
import type { ChangeActor } from '@/lib/channels/types'
import { listAccounts } from '@/lib/social/accounts'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { metaAdsGraph, type MetaGraph } from './client'
import { utmLink, type MadsNewAd, type MadsSwapImage } from './creative-spec'

// Image ads: upload the image to the ad account (image_hash), create a creative on the store's
// connected Page (and Instagram account), then create the ad or point an existing ad at it.
// Previews upload the image (harmless, deduplicated by Meta) and validate the rest with validate_only.

const VALIDATE = { execution_options: ['validate_only'] }
const MAX_IMAGE_BYTES = 30 * 1024 * 1024

export interface MetaPage {
  pageId: string
  pageName: string | null
  igUserId: string | null
}

/** The Facebook Page (and linked Instagram account) the store connected under Social. */
export async function metaPageForAds(): Promise<MetaPage | null> {
  const tenantId = await resolveTenantId()
  const rows = await listAccounts(tenantId).catch(() => [])
  const fb = rows.find(r => r.provider === 'facebook')
  const ig = rows.find(r => r.provider === 'instagram')
  const pageId = fb?.page_id ?? ig?.page_id ?? (!tenantId ? process.env.META_JEFFI_PAGE_ID : null) ?? null
  if (!pageId) return null
  const igUserId = ig?.ig_user_id ?? fb?.ig_user_id ?? (!tenantId ? process.env.META_JEFFI_IG_USER_ID : null) ?? null
  return { pageId, pageName: fb?.page_name ?? ig?.page_name ?? null, igUserId }
}

/** Only our own S3 / CloudFront media is fetched server-side. */
export function isOwnMediaUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false
  const cf = process.env.CLOUDFRONT_URL
  if (cf) {
    try {
      if (u.host === new URL(cf).host) return true
    } catch {}
  }
  return /^[a-z0-9][a-z0-9.-]*\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i.test(u.host)
}

export async function fetchImageBytes(url: string): Promise<Buffer> {
  if (!isOwnMediaUrl(url)) throw new Error('Use a product photo, an upload or an AI image (our own media only).')
  const res = await fetch(url, { redirect: 'error' })
  if (!res.ok) throw new Error(`Could not read the image (HTTP ${res.status}).`)
  const type = res.headers.get('content-type') ?? ''
  if (type && !type.startsWith('image/')) throw new Error('That link is not an image.')
  const bytes = Buffer.from(await res.arrayBuffer())
  if (!bytes.length) throw new Error('The image is empty.')
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('The image is over 30 MB.')
  return bytes
}

// ---- Graph helpers ----

/** POST /act_{id}/adimages with the bytes; returns the image hash. */
export async function uploadAdImage(graph: MetaGraph, account: string, bytes: Buffer, name = 'ad-image.jpg'): Promise<string> {
  const res = await graph.post<{ images?: Record<string, { hash?: string }> }>(`${account}/adimages`, {
    bytes: bytes.toString('base64'),
    name,
  })
  const hash = Object.values(res?.images ?? {})[0]?.hash
  if (!hash) throw new Error('Meta did not return an image hash.')
  return hash
}

export interface LinkCreativeInput {
  pageId: string
  igUserId?: string | null
  imageHash: string
  link: string
  message: string
  headline: string
  description?: string
  cta: string
}

export function objectStorySpec(c: LinkCreativeInput) {
  return {
    page_id: c.pageId,
    ...(c.igUserId ? { instagram_user_id: c.igUserId } : {}),
    link_data: {
      image_hash: c.imageHash,
      link: c.link,
      message: c.message,
      name: c.headline,
      ...(c.description ? { description: c.description } : {}),
      call_to_action: { type: c.cta, value: { link: c.link } },
    },
  }
}

/** POST /act_{id}/adcreatives. Returns the creative id (absent when validateOnly). */
export async function createAdCreative(
  graph: MetaGraph,
  account: string,
  name: string,
  spec: Record<string, unknown>,
  validateOnly = false
): Promise<string | null> {
  const res = await graph.post<{ id?: string }>(`${account}/adcreatives`, {
    name,
    object_story_spec: spec,
    ...(validateOnly ? VALIDATE : {}),
  })
  return res?.id ? String(res.id) : null
}

/** POST /act_{id}/ads. `creative` is { creative_id } or, for validation, an inline creative spec. */
export async function createAd(
  graph: MetaGraph,
  account: string,
  ad: { name: string; adsetId: string; creative: Record<string, unknown>; status?: 'ACTIVE' | 'PAUSED' },
  validateOnly = false
): Promise<string | null> {
  const res = await graph.post<{ id?: string }>(`${account}/ads`, {
    name: ad.name,
    adset_id: ad.adsetId,
    creative: ad.creative,
    status: ad.status ?? 'PAUSED',
    ...(validateOnly ? VALIDATE : {}),
  })
  return res?.id ? String(res.id) : null
}

/** POST /{ad_id} with a new creative. */
export async function setAdCreative(
  graph: MetaGraph,
  adId: string,
  creative: Record<string, unknown>,
  validateOnly = false
): Promise<void> {
  await graph.post(adId, { creative, ...(validateOnly ? VALIDATE : {}) })
}

/** The single-image link creative an ad runs now, or a reason it cannot be swapped here. */
export async function currentLinkSpec(graph: MetaGraph, adId: string): Promise<{ spec: any; name: string } | string> {
  const ad = await graph.get<any>(adId, { fields: 'name,creative{name,object_story_spec}' })
  const spec = ad?.creative?.object_story_spec
  const link = spec?.link_data
  if (!spec?.page_id || !link || link.child_attachments)
    return 'This ad does not use a single-image link creative; change it in Ads Manager.'
  return { spec, name: String(ad?.creative?.name ?? ad?.name ?? adId) }
}

export function withImage(spec: any, imageHash: string) {
  const { picture: _p, image_url: _u, image_hash: _h, ...link } = spec.link_data
  return { ...spec, link_data: { ...link, image_hash: imageHash } }
}

// ---- Changes ----

export function textProblems(a: Pick<MadsNewAd, 'message' | 'headline' | 'description'>): string[] {
  const out: string[] = []
  if (a.headline.length > 40) out.push('Keep the headline to 40 characters.')
  if ((a.description ?? '').length > 30) out.push('Keep the description to 30 characters.')
  if (a.message.length > 2200) out.push('The primary text is over 2200 characters.')
  return out
}

export async function runMadsNewAd(a: MadsNewAd, actor: ChangeActor, preview: boolean): Promise<ChangeOutcome<unknown>> {
  const adset = await queryOne<{ name: string; campaign_id: string }>(
    `SELECT name, campaign_id FROM mads_adsets WHERE adset_id = $1`,
    [a.adsetId]
  )
  const page = await metaPageForAds()
  const link = utmLink(a.link, a.adsetId)
  const copy = { link, message: a.message, headline: a.headline, description: a.description, cta: a.cta }
  const build = async (validateOnly: boolean) => {
    const { graph, cfg } = await metaAdsGraph()
    const account = cfg.ad_account_id
    const hash = await uploadAdImage(graph, account, await fetchImageBytes(a.imageUrl))
    const spec = objectStorySpec({ pageId: page!.pageId, igUserId: page!.igUserId, imageHash: hash, ...copy })
    const creativeName = `${a.name} creative`
    if (validateOnly) {
      await createAdCreative(graph, account, creativeName, spec, true)
      await createAd(graph, account, { name: a.name, adsetId: a.adsetId, creative: { name: creativeName, object_story_spec: spec }, status: a.status }, true)
      return null
    }
    const creativeId = await createAdCreative(graph, account, creativeName, spec)
    if (!creativeId) throw new Error('Meta did not return a creative id.')
    const adId = await createAd(graph, account, { name: a.name, adsetId: a.adsetId, creative: { creative_id: creativeId }, status: a.status })
    if (!adId) throw new Error('Meta did not return an ad id.')
    return { adId, creativeId, imageHash: hash }
  }
  return runChange(
    {
      channel: 'meta_ads',
      action: 'ad.create',
      entityType: 'ad',
      entityId: null,
      summary: `Create ad "${a.name}" in ad set "${adset?.name ?? a.adsetId}" (${a.status === 'ACTIVE' ? 'active' : 'paused'})`,
      before: null,
      after: { adset: adset?.name ?? a.adsetId, name: a.name, status: a.status, image: a.imageUrl, ...copy },
      validate: async () => {
        if (!adset) return ['Ad set not found; sync first.']
        if (!page) return ['Connect a Facebook Page under Social first; Meta ads run from a Page.']
        const p = textProblems(a)
        if (p.length) return p
        await build(true)
        return []
      },
      apply: async () => {
        const res = (await build(false))!
        await query(
          `INSERT INTO mads_ads (ad_id, adset_id, campaign_id, name, status, effective_status, thumbnail_url)
           VALUES ($1, $2, $3, $4, $5, $5, $6) ON CONFLICT (ad_id) DO NOTHING`,
          [res.adId, a.adsetId, adset!.campaign_id, a.name, a.status, a.imageUrl]
        )
        return res
      },
    },
    actor,
    preview
  )
}

export async function runMadsSwapImage(a: MadsSwapImage, actor: ChangeActor, preview: boolean): Promise<ChangeOutcome<unknown>> {
  const row = await queryOne<{ name: string; thumbnail_url: string | null }>(
    `SELECT name, thumbnail_url FROM mads_ads WHERE ad_id = $1`,
    [a.adId]
  )
  const build = async (validateOnly: boolean) => {
    const { graph, cfg } = await metaAdsGraph()
    const cur = await currentLinkSpec(graph, a.adId)
    if (typeof cur === 'string') throw new Error(cur)
    const hash = await uploadAdImage(graph, cfg.ad_account_id, await fetchImageBytes(a.imageUrl))
    const spec = withImage(cur.spec, hash)
    if (validateOnly) {
      await createAdCreative(graph, cfg.ad_account_id, cur.name, spec, true)
      await setAdCreative(graph, a.adId, { name: cur.name, object_story_spec: spec }, true)
      return null
    }
    const creativeId = await createAdCreative(graph, cfg.ad_account_id, cur.name, spec)
    if (!creativeId) throw new Error('Meta did not return a creative id.')
    await setAdCreative(graph, a.adId, { creative_id: creativeId })
    return { creativeId, imageHash: hash }
  }
  return runChange(
    {
      channel: 'meta_ads',
      action: 'ad.image',
      entityType: 'ad',
      entityId: a.adId,
      summary: `Change the image of ad "${row?.name ?? a.adId}"`,
      before: { image: row?.thumbnail_url ?? null },
      after: { image: a.imageUrl },
      validate: async () => {
        if (!row) return ['Not found; sync first.']
        await build(true)
        return []
      },
      apply: async () => {
        const res = await build(false)
        await query(`UPDATE mads_ads SET thumbnail_url = $2 WHERE ad_id = $1`, [a.adId, a.imageUrl])
        return res
      },
    },
    actor,
    preview
  )
}

// ---- Dialog data ----

export async function loadAdSetup() {
  const [adsets, page] = await Promise.all([
    queryMany<{ adset_id: string; name: string; status: string; campaign: string | null }>(
      `SELECT s.adset_id, s.name, s.status, c.name AS campaign FROM mads_adsets s
       LEFT JOIN mads_campaigns c ON c.campaign_id = s.campaign_id
       ORDER BY (s.status = 'ACTIVE') DESC, s.name LIMIT 500`
    ),
    metaPageForAds(),
  ])
  return {
    adsets: adsets.map(s => ({ id: s.adset_id, name: s.name, status: s.status, campaign: s.campaign })),
    page: page ? { id: page.pageId, name: page.pageName, instagram: !!page.igUserId } : null,
  }
}

export interface AdProduct {
  id: string
  name: string
  slug: string
  description: string | null
  images: string[]
}

export async function searchAdProducts(q: string): Promise<AdProduct[]> {
  const like = q.replace(/[\\%_]/g, m => `\\${m}`)
  const rows = await queryMany<any>(
    `SELECT p.id, p.name, p.slug, p.short_description,
       ARRAY(SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id
             ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 8) AS images
     FROM products p
     WHERE p.is_active = true AND (p.name ILIKE $1 OR p.sku ILIKE $1)
     ORDER BY (p.name ILIKE $2) DESC, p.name ASC LIMIT 12`,
    [`%${like}%`, `${like}%`]
  )
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.short_description ?? null,
    images: (r.images ?? []).filter(Boolean),
  }))
}
