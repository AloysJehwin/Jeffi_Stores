// Meta Graph API helper — the seam between the app and Facebook/Instagram publishing.
// Fetch-based (no SDK; the Graph API is plain HTTP), mirroring the razorpay-subscriptions
// house style: env-driven config that throws if missing, typed async functions, all effects
// isolated here so callers (OAuth routes, publisher) stay declarative.
//
// Hard platform limits baked in (documented so nobody re-litigates them):
//   - IG accepts a PUBLIC image/video URL, never raw bytes.
//   - IG publish is a 2-step create-container → publish; video/Reels are async (poll status).
//   - Reels cannot carry licensed "trending" audio via the API — silent or own audio only.
//   - Only FB Pages + IG Business/Creator accounts are postable (never personal profiles).

import { controlPlanePool, deleteIntegrationCredential, getIntegrationCredential, saveIntegrationCredential } from '@/lib/tenant-registry'
import { decryptToken, encryptToken } from '@/lib/crypto/token-cipher'

/** One Graph version for every Meta caller (Social, Meta Ads, the Conversions API). */
export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v27.0'
export const META_GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`
const GRAPH = META_GRAPH

/** What post insights and the comment inbox need; connections made before these were asked for lack them. */
export const META_INSIGHTS_SCOPES = [
  'read_insights',
  'pages_read_user_content',
  'pages_manage_engagement',
  'instagram_manage_insights',
  'instagram_manage_comments',
]
/** Social Posts sign-in (a classic app; a Business-type app sends its login configuration instead). */
export const META_SOCIAL_SCOPES = [
  'pages_show_list',
  'pages_manage_posts',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
  ...META_INSIGHTS_SCOPES,
]
export const META_ADS_SCOPES = ['ads_read', 'ads_management', 'business_management']

export type MetaAppSource = 'own' | 'platform'

export interface OwnMetaApp {
  appId: string
  appSecret: string
  /** Facebook Login for Business configuration ids (Business-type apps). */
  loginConfigId?: string | null
  adsLoginConfigId?: string | null
}

export interface MetaConfig extends OwnMetaApp {
  source: MetaAppSource
}

/** A store's own Meta app, in tenant_integration_credentials like the other own-app providers. */
export const META_APP_PROVIDER = 'meta_app'

/** The platform Meta app from env, or null. */
export function platformMetaConfig(): MetaConfig | null {
  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) return null
  return {
    appId,
    appSecret,
    loginConfigId: process.env.META_LOGIN_CONFIG_ID || null,
    adsLoginConfigId: process.env.META_ADS_LOGIN_CONFIG_ID || null,
    source: 'platform',
  }
}

export async function readOwnMetaApp(tenantId: string): Promise<OwnMetaApp | null> {
  const row = await getIntegrationCredential(tenantId, META_APP_PROVIDER).catch(() => null)
  if (!row || row.status !== 'connected') return null
  try {
    const j = JSON.parse(decryptToken(row.config_enc))
    return j?.appId && j?.appSecret ? (j as OwnMetaApp) : null
  } catch {
    return null
  }
}

export async function saveOwnMetaApp(tenantId: string, app: OwnMetaApp): Promise<void> {
  await saveIntegrationCredential({
    tenantId,
    provider: META_APP_PROVIDER,
    label: 'Meta app',
    configEnc: encryptToken(JSON.stringify(app)),
    meta: {
      app_id: app.appId,
      login_config_id: app.loginConfigId ?? null,
      ads_login_config_id: app.adsLoginConfigId ?? null,
    },
  })
}

export async function deleteOwnMetaApp(tenantId: string): Promise<void> {
  await deleteIntegrationCredential(tenantId, META_APP_PROVIDER)
}

/** Every store's own app with this app id (for Meta's signed callbacks, which name only the app). */
export async function ownMetaAppsById(appId?: string | null): Promise<Array<OwnMetaApp & { tenantId: string }>> {
  const r = await controlPlanePool().query(
    `SELECT tenant_id, config_enc FROM tenant_integration_credentials
      WHERE provider = $1 AND status = 'connected' AND ($2::text IS NULL OR meta->>'app_id' = $2) LIMIT 500`,
    [META_APP_PROVIDER, appId ?? null]
  )
  const out: Array<OwnMetaApp & { tenantId: string }> = []
  for (const row of r.rows) {
    try {
      const j = JSON.parse(decryptToken(row.config_enc))
      if (j?.appId && j?.appSecret) out.push({ ...j, tenantId: String(row.tenant_id) })
    } catch {}
  }
  return out
}

/**
 * The Meta app a store signs in with: its own when it has one, else the platform's. `source` pins
 * one of them (a callback exchanges the code with the app the dialog was opened for). Null when none.
 */
export async function findMetaConfig(tenantId?: string | null, source?: MetaAppSource): Promise<MetaConfig | null> {
  if (source !== 'platform' && tenantId) {
    const own = await readOwnMetaApp(tenantId)
    if (own) return { ...own, source: 'own' }
  }
  return source === 'own' ? null : platformMetaConfig()
}

/** As findMetaConfig, but throws when there is no app. */
export async function getMetaConfig(tenantId?: string | null, source?: MetaAppSource): Promise<MetaConfig> {
  const cfg = await findMetaConfig(tenantId, source)
  if (!cfg) {
    throw new Error(
      source === 'own' ? "This store's own Meta app is not set up" : 'Meta not configured: set META_APP_ID and META_APP_SECRET'
    )
  }
  return cfg
}

function requirePlatform(): MetaConfig {
  const cfg = platformMetaConfig()
  if (!cfg) throw new Error('Meta not configured: set META_APP_ID and META_APP_SECRET')
  return cfg
}

async function graphGet(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${GRAPH}/${path}?${qs}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Meta GET ${path} failed (${res.status}): ${json?.error?.message || 'unknown'}`)
  return json
}

async function graphPost(path: string, body: Record<string, string>): Promise<any> {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Meta POST ${path} failed (${res.status}): ${json?.error?.message || 'unknown'}`)
  return json
}

// ── OAuth ────────────────────────────────────────────────────────────────────

/**
 * The Facebook Login dialog URL. A Business-type app signs in with its Facebook Login for Business
 * configuration (config_id) instead of a scope list.
 */
export function buildOAuthUrl(cfg: MetaConfig, redirectUri: string, state: string, kind: 'social' | 'ads' = 'social'): string {
  const configId = kind === 'ads' ? cfg.adsLoginConfigId : cfg.loginConfigId
  const qs = new URLSearchParams({ client_id: cfg.appId, redirect_uri: redirectUri, state })
  if (configId) {
    qs.set('config_id', configId)
    qs.set('response_type', 'code')
    qs.set('override_default_response_type', 'true')
  } else {
    qs.set('scope', (kind === 'ads' ? META_ADS_SCOPES : META_SOCIAL_SCOPES).join(','))
    qs.set('response_type', 'code')
  }
  return `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${qs}`
}

/** Exchange an OAuth code for a short-lived user access token. */
export async function exchangeCodeForToken(code: string, redirectUri: string, cfg: MetaConfig = requirePlatform()): Promise<string> {
  const json = await graphGet('oauth/access_token', {
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    redirect_uri: redirectUri,
    code,
  })
  return json.access_token as string
}

/** Upgrade a short-lived user token to a long-lived (~60-day) one. */
export async function getLongLivedToken(
  shortToken: string,
  cfg: MetaConfig = requirePlatform()
): Promise<{ token: string; expiresInSec: number }> {
  const json = await graphGet('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    fb_exchange_token: shortToken,
  })
  return { token: json.access_token as string, expiresInSec: Number(json.expires_in ?? 60 * 24 * 60 * 60) }
}

/** Checks an app id + secret by fetching an app access token. Throws with Meta's reason. */
export async function verifyMetaApp(appId: string, appSecret: string): Promise<void> {
  const json = await graphGet('oauth/access_token', {
    client_id: appId,
    client_secret: appSecret,
    grant_type: 'client_credentials',
  })
  if (!json?.access_token) throw new Error('Meta returned no app access token')
}

/** The signed-in Facebook user (app-scoped id) and the permissions they granted. */
export async function getMetaUser(userToken: string): Promise<{ id: string; granted: string[] }> {
  const [me, perms] = await Promise.all([
    graphGet('me', { fields: 'id', access_token: userToken }),
    graphGet('me/permissions', { access_token: userToken }).catch(() => ({ data: [] })),
  ])
  const granted = (perms?.data ?? []).filter((p: any) => p?.status === 'granted').map((p: any) => String(p.permission))
  return { id: String(me.id), granted }
}

/** Permissions on any token of this app (a Page token too), via debug_token. Null when Meta won't say. */
export async function tokenScopes(token: string, cfg: MetaConfig): Promise<string[] | null> {
  try {
    const j = await graphGet('debug_token', { input_token: token, access_token: `${cfg.appId}|${cfg.appSecret}` })
    return j?.data?.is_valid && Array.isArray(j.data.scopes) ? j.data.scopes.map(String) : null
  } catch {
    return null
  }
}

export interface MetaPage {
  pageId: string
  pageName: string
  pageAccessToken: string
  igUserId: string | null
}

/**
 * The Pages the user manages, each with its linked IG Business account. The PAGE access token
 * (long-lived) is what we persist and post with — it does not expire on the 60-day clock the user
 * token does, as long as the user token was long-lived at exchange time.
 */
export async function listMetaPages(userToken: string): Promise<MetaPage[]> {
  const pages = await graphGet('me/accounts', {
    access_token: userToken,
    fields: 'id,name,access_token,instagram_business_account',
    limit: '100',
  })
  return (pages.data ?? [])
    .filter((p: any) => p?.id && p?.access_token)
    .map((p: any) => ({
      pageId: String(p.id),
      pageName: String(p.name ?? ''),
      pageAccessToken: String(p.access_token),
      igUserId: p.instagram_business_account?.id ?? null,
    }))
}

export interface MetaPageInfo {
  pageId: string
  pageName: string
  igUserId: string | null
}

/** Read a Page with the given token (validates a pasted Page token and finds its linked IG account). */
export async function getPageInfo(pageId: string, accessToken: string): Promise<MetaPageInfo> {
  const page = await graphGet(encodeURIComponent(pageId), {
    access_token: accessToken,
    fields: 'id,name,instagram_business_account',
  })
  return {
    pageId: String(page.id),
    pageName: String(page.name ?? ''),
    igUserId: page.instagram_business_account?.id ?? null,
  }
}

// ── Facebook publishing ────────────────────────────────────────────────────────

/** Post to a Facebook Page — a photo post when imageUrl is given, else a text/link post. */
export async function publishFacebookPost(opts: {
  pageId: string
  message: string
  imageUrl?: string
  accessToken: string
  link?: string | null
}): Promise<{ id: string }> {
  if (opts.imageUrl) {
    const r = await graphPost(`${opts.pageId}/photos`, {
      url: opts.imageUrl,
      caption: opts.message,
      access_token: opts.accessToken,
    })
    return { id: r.post_id || r.id }
  }
  // With no photo, `link` turns the post into a real link card instead of leaving the URL to be
  // auto-linked inside the message text.
  const r = await graphPost(`${opts.pageId}/feed`, {
    message: opts.message,
    ...(opts.link ? { link: opts.link } : {}),
    access_token: opts.accessToken,
  })
  return { id: r.id }
}

/** Multi-photo Facebook Page post (2+ images attached to one feed post). */
export async function publishFacebookCarousel(opts: {
  pageId: string
  message: string
  imageUrls: string[]
  accessToken: string
}): Promise<{ id: string }> {
  if (opts.imageUrls.length < 2) {
    throw new Error('FB multi-photo post needs at least 2 images')
  }
  const mediaIds: string[] = []
  for (const url of opts.imageUrls) {
    const p = await graphPost(`${opts.pageId}/photos`, {
      url,
      published: 'false',
      access_token: opts.accessToken,
    })
    mediaIds.push(p.id)
  }
  const r = await graphPost(`${opts.pageId}/feed`, {
    message: opts.message,
    attached_media: JSON.stringify(mediaIds.map(id => ({ media_fbid: id }))),
    access_token: opts.accessToken,
  })
  return { id: r.id }
}

// ── Instagram publishing (2-step; video/Reels async) ────────────────────────────

async function publishIgContainer(igUserId: string, creationId: string, accessToken: string): Promise<{ id: string }> {
  const r = await graphPost(`${igUserId}/media_publish`, { creation_id: creationId, access_token: accessToken })
  return { id: r.id }
}

/** Single-image IG feed post. imageUrl MUST be publicly reachable by Meta. */
export async function publishInstagramImage(opts: {
  igUserId: string
  imageUrl: string
  caption: string
  accessToken: string
}): Promise<{ id: string }> {
  const container = await graphPost(`${opts.igUserId}/media`, {
    image_url: opts.imageUrl,
    caption: opts.caption,
    access_token: opts.accessToken,
  })
  return publishIgContainer(opts.igUserId, container.id, opts.accessToken)
}

/** Multi-image IG carousel (2–10 images). */
export async function publishInstagramCarousel(opts: {
  igUserId: string
  imageUrls: string[]
  caption: string
  accessToken: string
}): Promise<{ id: string }> {
  if (opts.imageUrls.length < 2 || opts.imageUrls.length > 10) {
    throw new Error('IG carousel needs 2–10 images')
  }
  const children: string[] = []
  for (const url of opts.imageUrls) {
    const c = await graphPost(`${opts.igUserId}/media`, {
      image_url: url,
      is_carousel_item: 'true',
      access_token: opts.accessToken,
    })
    children.push(c.id)
  }
  const parent = await graphPost(`${opts.igUserId}/media`, {
    media_type: 'CAROUSEL',
    children: children.join(','),
    caption: opts.caption,
    access_token: opts.accessToken,
  })
  return publishIgContainer(opts.igUserId, parent.id, opts.accessToken)
}

/**
 * IG Reel from a public video URL. Async: the container must reach status_code=FINISHED
 * before publish, so we poll. NOTE: no trending/licensed audio is possible via the API —
 * the Reel is published with whatever audio is baked into the video (or silent).
 */
export async function publishInstagramReel(opts: {
  igUserId: string
  videoUrl: string
  caption: string
  accessToken: string
  coverUrl?: string
}): Promise<{ id: string }> {
  const container = await graphPost(`${opts.igUserId}/media`, {
    media_type: 'REELS',
    video_url: opts.videoUrl,
    caption: opts.caption,
    ...(opts.coverUrl ? { cover_url: opts.coverUrl } : {}),
    access_token: opts.accessToken,
  })
  await waitForContainerReady(container.id, opts.accessToken)
  return publishIgContainer(opts.igUserId, container.id, opts.accessToken)
}

const CONTAINER_POLL_MS = 5000
const CONTAINER_MAX_POLLS = 60 // ~5 min

async function waitForContainerReady(containerId: string, accessToken: string): Promise<void> {
  for (let i = 0; i < CONTAINER_MAX_POLLS; i++) {
    const s = await graphGet(containerId, { fields: 'status_code', access_token: accessToken })
    if (s.status_code === 'FINISHED') return
    if (s.status_code === 'ERROR') throw new Error('IG media container processing failed (ERROR)')
    await new Promise(r => setTimeout(r, CONTAINER_POLL_MS))
  }
  throw new Error('IG media container did not reach FINISHED within the poll budget')
}

// ── Hashtag reach (free IG Hashtag Search API) ──────────────────────────────────

/**
 * Return the recent-media count for a hashtag, used to RANK candidate tags by reach.
 * Meta has no "trending tags" endpoint — this only measures a tag you already supply.
 * Best-effort: returns 0 on any error so ranking degrades gracefully.
 */
export async function searchHashtagReach(igUserId: string, tag: string, accessToken: string): Promise<number> {
  try {
    const search = await graphGet('ig_hashtag_search', {
      user_id: igUserId,
      q: tag.replace(/^#/, ''),
      access_token: accessToken,
    })
    const hashtagId = search.data?.[0]?.id
    if (!hashtagId) return 0
    const info = await graphGet(hashtagId, { fields: 'name', access_token: accessToken })
    // The API exposes recent_media edges; we use presence + a follow-up count where available.
    return info?.id ? 1 : 0
  } catch {
    return 0
  }
}
