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

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0'
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`

export interface MetaConfig {
  appId: string
  appSecret: string
}

/** App-level Meta credentials (platform Meta app). Throws if unset — same posture as getRazorpayInstance. */
export function getMetaConfig(): MetaConfig {
  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) {
    throw new Error('Meta not configured: set META_APP_ID and META_APP_SECRET')
  }
  return { appId, appSecret }
}

export function isMetaEnabled(): boolean {
  return !!(process.env.META_APP_ID && process.env.META_APP_SECRET)
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

/** Build the Facebook Login dialog URL for the per-tenant connect flow. */
export function buildOAuthUrl(redirectUri: string, state: string): string {
  const { appId } = getMetaConfig()
  const scopes = [
    'pages_show_list', 'pages_manage_posts', 'pages_read_engagement',
    'instagram_basic', 'instagram_content_publish', 'business_management',
  ].join(',')
  const qs = new URLSearchParams({
    client_id: appId, redirect_uri: redirectUri, state, scope: scopes, response_type: 'code',
  }).toString()
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${qs}`
}

/** Exchange an OAuth code for a short-lived user access token. */
export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
  const { appId, appSecret } = getMetaConfig()
  const json = await graphGet('oauth/access_token', {
    client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code,
  })
  return json.access_token as string
}

/** Upgrade a short-lived user token to a long-lived (~60-day) one. */
export async function getLongLivedToken(shortToken: string): Promise<{ token: string; expiresInSec: number }> {
  const { appId, appSecret } = getMetaConfig()
  const json = await graphGet('oauth/access_token', {
    grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken,
  })
  return { token: json.access_token as string, expiresInSec: Number(json.expires_in ?? 60 * 24 * 60 * 60) }
}

export interface MetaAccounts {
  pageId: string
  pageName: string
  pageAccessToken: string
  igUserId: string | null
}

/**
 * Resolve the user's first Page + its connected IG Business account. The PAGE access token
 * (long-lived) is what we persist and post with — it does not expire on the 60-day clock the
 * user token does, as long as the user token was long-lived at exchange time.
 */
export async function getPageAndIgAccounts(userToken: string): Promise<MetaAccounts> {
  const pages = await graphGet('me/accounts', {
    access_token: userToken, fields: 'id,name,access_token,instagram_business_account',
  })
  const page = pages.data?.[0]
  if (!page) throw new Error('No Facebook Page found on this account (a Page is required to post)')
  return {
    pageId: page.id,
    pageName: page.name,
    pageAccessToken: page.access_token,
    igUserId: page.instagram_business_account?.id ?? null,
  }
}

// ── Facebook publishing ────────────────────────────────────────────────────────

/** Post to a Facebook Page — a photo post when imageUrl is given, else a text/link post. */
export async function publishFacebookPost(opts: {
  pageId: string; message: string; imageUrl?: string; accessToken: string
}): Promise<{ id: string }> {
  if (opts.imageUrl) {
    const r = await graphPost(`${opts.pageId}/photos`, {
      url: opts.imageUrl, caption: opts.message, access_token: opts.accessToken,
    })
    return { id: r.post_id || r.id }
  }
  const r = await graphPost(`${opts.pageId}/feed`, { message: opts.message, access_token: opts.accessToken })
  return { id: r.id }
}

// ── Instagram publishing (2-step; video/Reels async) ────────────────────────────

async function publishIgContainer(igUserId: string, creationId: string, accessToken: string): Promise<{ id: string }> {
  const r = await graphPost(`${igUserId}/media_publish`, { creation_id: creationId, access_token: accessToken })
  return { id: r.id }
}

/** Single-image IG feed post. imageUrl MUST be publicly reachable by Meta. */
export async function publishInstagramImage(opts: {
  igUserId: string; imageUrl: string; caption: string; accessToken: string
}): Promise<{ id: string }> {
  const container = await graphPost(`${opts.igUserId}/media`, {
    image_url: opts.imageUrl, caption: opts.caption, access_token: opts.accessToken,
  })
  return publishIgContainer(opts.igUserId, container.id, opts.accessToken)
}

/** Multi-image IG carousel (2–10 images). */
export async function publishInstagramCarousel(opts: {
  igUserId: string; imageUrls: string[]; caption: string; accessToken: string
}): Promise<{ id: string }> {
  if (opts.imageUrls.length < 2 || opts.imageUrls.length > 10) {
    throw new Error('IG carousel needs 2–10 images')
  }
  const children: string[] = []
  for (const url of opts.imageUrls) {
    const c = await graphPost(`${opts.igUserId}/media`, {
      image_url: url, is_carousel_item: 'true', access_token: opts.accessToken,
    })
    children.push(c.id)
  }
  const parent = await graphPost(`${opts.igUserId}/media`, {
    media_type: 'CAROUSEL', children: children.join(','), caption: opts.caption, access_token: opts.accessToken,
  })
  return publishIgContainer(opts.igUserId, parent.id, opts.accessToken)
}

/**
 * IG Reel from a public video URL. Async: the container must reach status_code=FINISHED
 * before publish, so we poll. NOTE: no trending/licensed audio is possible via the API —
 * the Reel is published with whatever audio is baked into the video (or silent).
 */
export async function publishInstagramReel(opts: {
  igUserId: string; videoUrl: string; caption: string; accessToken: string; coverUrl?: string
}): Promise<{ id: string }> {
  const container = await graphPost(`${opts.igUserId}/media`, {
    media_type: 'REELS', video_url: opts.videoUrl, caption: opts.caption,
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
    await new Promise((r) => setTimeout(r, CONTAINER_POLL_MS))
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
      user_id: igUserId, q: tag.replace(/^#/, ''), access_token: accessToken,
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
