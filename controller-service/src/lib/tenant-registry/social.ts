import { controlPlanePool } from './shared'

export interface TenantSocialAccount {
  id: string
  tenant_id: string
  provider: 'facebook' | 'instagram'
  page_id: string | null
  page_name: string | null
  ig_user_id: string | null
  access_token_enc: string
  token_expiry: string | null
  status: string
}

/** Upsert a tenant's connected Meta account (one row per provider). Token is already encrypted. */
export async function saveTenantSocialAccount(a: {
  tenantId: string
  provider: 'facebook' | 'instagram'
  pageId?: string | null
  pageName?: string | null
  igUserId?: string | null
  accessTokenEnc: string
  tokenExpiry?: Date | null
}): Promise<void> {
  const pool = controlPlanePool()
  await pool.query(
    `INSERT INTO tenant_social_accounts
       (tenant_id, provider, page_id, page_name, ig_user_id, access_token_enc, token_expiry, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'connected')
     ON CONFLICT (tenant_id, provider) DO UPDATE SET
       page_id=EXCLUDED.page_id, page_name=EXCLUDED.page_name, ig_user_id=EXCLUDED.ig_user_id,
       access_token_enc=EXCLUDED.access_token_enc, token_expiry=EXCLUDED.token_expiry,
       status='connected', updated_at=now()`,
    [
      a.tenantId,
      a.provider,
      a.pageId ?? null,
      a.pageName ?? null,
      a.igUserId ?? null,
      a.accessTokenEnc,
      a.tokenExpiry ? a.tokenExpiry.toISOString() : null,
    ]
  )
}

export async function getTenantSocialAccounts(tenantId: string): Promise<TenantSocialAccount[]> {
  const pool = controlPlanePool()
  const r = await pool.query(`SELECT * FROM tenant_social_accounts WHERE tenant_id=$1`, [tenantId])
  return r.rows as TenantSocialAccount[]
}

export interface ScheduledSocialPost {
  id: string
  tenant_id: string | null
  product_id: string | null
  platform: 'fb' | 'ig' | 'ig_reel'
  caption: string | null
  hashtags: string | null
  image_url: string | null
  image_urls: string[] | null
  video_url: string | null
  scheduled_at: string
  status: string
  posted_id: string | null
  last_error: string | null
  attempts: number
}

/** Queue a post. scheduled_at defaults to now (post-ASAP) when omitted. tenantId null = Jeffi platform. */
export async function enqueueSocialPost(p: {
  tenantId: string | null
  productId?: string | null
  platform: 'fb' | 'ig' | 'ig_reel'
  caption?: string | null
  hashtags?: string | null
  imageUrl?: string | null
  imageUrls?: string[] | null
  videoUrl?: string | null
  scheduledAt?: Date | null
}): Promise<ScheduledSocialPost> {
  const pool = controlPlanePool()
  const r = await pool.query(
    `INSERT INTO scheduled_social_posts
       (tenant_id, product_id, platform, caption, hashtags, image_url, image_urls, video_url, scheduled_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9, now())) RETURNING *`,
    [
      p.tenantId,
      p.productId ?? null,
      p.platform,
      p.caption ?? null,
      p.hashtags ?? null,
      p.imageUrl ?? null,
      p.imageUrls?.length ? p.imageUrls : null,
      p.videoUrl ?? null,
      p.scheduledAt ? p.scheduledAt.toISOString() : null,
    ]
  )
  return r.rows[0] as ScheduledSocialPost
}

/** Posts whose scheduled time has arrived and are still pending. */
export async function dueSocialPosts(limit = 20): Promise<ScheduledSocialPost[]> {
  const pool = controlPlanePool()
  const r = await pool.query(
    `SELECT * FROM scheduled_social_posts
     WHERE status='pending' AND scheduled_at <= now()
     ORDER BY scheduled_at ASC LIMIT $1`,
    [limit]
  )
  return r.rows as ScheduledSocialPost[]
}

/** Jeffi platform posts (tenant_id IS NULL) for the admin Social Posts list. */
export async function listJeffiSocialPosts(limit = 100): Promise<ScheduledSocialPost[]> {
  const pool = controlPlanePool()
  const r = await pool.query(
    `SELECT * FROM scheduled_social_posts
     WHERE tenant_id IS NULL
     ORDER BY scheduled_at DESC LIMIT $1`,
    [limit]
  )
  return r.rows as ScheduledSocialPost[]
}

/** Social posts for a given scope: a tenant's own queue when tenantId is set, else the Jeffi
 * platform queue (tenant_id IS NULL). Keyed so a tenant admin never sees the platform feed and
 * vice-versa — the tenant is resolved from ALS by the caller, never from the client. */
export async function listSocialPostsForScope(tenantId: string | null, limit = 100): Promise<ScheduledSocialPost[]> {
  const pool = controlPlanePool()
  const r = tenantId
    ? await pool.query(
        `SELECT * FROM scheduled_social_posts
         WHERE tenant_id = $1
         ORDER BY scheduled_at DESC LIMIT $2`,
        [tenantId, limit]
      )
    : await pool.query(
        `SELECT * FROM scheduled_social_posts
         WHERE tenant_id IS NULL
         ORDER BY scheduled_at DESC LIMIT $1`,
        [limit]
      )
  return r.rows as ScheduledSocialPost[]
}

/** Load a single scheduled post by id (used by the admin "Post now" action). */
export async function getSocialPost(id: string): Promise<ScheduledSocialPost | null> {
  const pool = controlPlanePool()
  const r = await pool.query(`SELECT * FROM scheduled_social_posts WHERE id=$1`, [id])
  return (r.rows[0] as ScheduledSocialPost) || null
}

export async function updateSocialPost(
  id: string,
  patch: {
    status?: string
    postedId?: string | null
    lastError?: string | null
    caption?: string
    bumpAttempts?: boolean
  }
): Promise<void> {
  const pool = controlPlanePool()
  const sets: string[] = ['updated_at = now()']
  const args: any[] = []
  if (patch.status !== undefined) {
    args.push(patch.status)
    sets.push(`status=$${args.length}`)
  }
  if (patch.postedId !== undefined) {
    args.push(patch.postedId)
    sets.push(`posted_id=$${args.length}`)
  }
  if (patch.lastError !== undefined) {
    args.push(patch.lastError)
    sets.push(`last_error=$${args.length}`)
  }
  if (patch.caption !== undefined) {
    args.push(patch.caption)
    sets.push(`caption=$${args.length}`)
  }
  if (patch.bumpAttempts) sets.push('attempts = attempts + 1')
  args.push(id)
  await pool.query(`UPDATE scheduled_social_posts SET ${sets.join(', ')} WHERE id=$${args.length}`, args)
}

// ── Integration credentials (Google Merchant / Amazon Seller / …) ──────────────
