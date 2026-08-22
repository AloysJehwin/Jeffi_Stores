import {
  getTenantSocialAccounts,
  updateSocialPost,
  type ScheduledSocialPost,
  type TenantSocialAccount,
} from '../tenant-registry'
import { decryptToken } from '../crypto/token-cipher'
import {
  publishFacebookPost,
  publishInstagramImage,
  publishInstagramReel,
} from '../meta'

// Publisher: turn one queued scheduled_social_posts row into a live FB/IG post. Resolves the
// right credentials (env for Jeffi's own platform posts / decrypted per-tenant token), dispatches
// to the correct meta.ts call by platform, and records the outcome. Idempotent at the row level:
// only 'pending' rows are picked up, and the row is flipped to 'publishing' before the network
// call so a concurrent tick won't double-post.

interface ResolvedCreds {
  pageId?: string | null
  igUserId?: string | null
  accessToken: string
}

/** Jeffi's own platform credentials come from env (Secrets Manager), never the tenant table. */
function jeffiCreds(): ResolvedCreds | null {
  const accessToken = process.env.META_JEFFI_PAGE_TOKEN
  if (!accessToken) return null
  return {
    pageId: process.env.META_JEFFI_PAGE_ID ?? null,
    igUserId: process.env.META_JEFFI_IG_USER_ID ?? null,
    accessToken,
  }
}

function tenantCreds(accounts: TenantSocialAccount[], wantIg: boolean): ResolvedCreds | null {
  // Both FB and IG rows carry the same Page token; pick IG when we need the ig_user_id.
  const fb = accounts.find((a) => a.provider === 'facebook')
  const ig = accounts.find((a) => a.provider === 'instagram')
  const src = wantIg ? ig : (fb ?? ig)
  if (!src) return null
  return {
    pageId: (fb ?? src).page_id,
    igUserId: ig?.ig_user_id ?? null,
    accessToken: decryptToken(src.access_token_enc),
  }
}

async function resolveCreds(post: ScheduledSocialPost): Promise<ResolvedCreds | null> {
  const wantIg = post.platform === 'ig' || post.platform === 'ig_reel'
  if (post.tenant_id === null) return jeffiCreds()
  const accounts = await getTenantSocialAccounts(post.tenant_id)
  return tenantCreds(accounts, wantIg)
}

/**
 * Publish a single queued post. Returns the Meta post/media id on success. Marks the row
 * 'publishing' → 'posted'/'failed' and records the error on failure (no throw — the caller
 * loops over many rows).
 */
export async function publishScheduledPost(post: ScheduledSocialPost): Promise<{ ok: boolean; postedId?: string; error?: string }> {
  await updateSocialPost(post.id, { status: 'publishing', bumpAttempts: true })
  try {
    const creds = await resolveCreds(post)
    if (!creds) throw new Error('no connected social account / credentials for this post')

    const caption = [post.caption, post.hashtags].filter(Boolean).join('\n\n')

    let postedId: string
    if (post.platform === 'fb') {
      if (!creds.pageId) throw new Error('no Facebook Page id')
      const r = await publishFacebookPost({
        pageId: creds.pageId, message: caption, imageUrl: post.image_url ?? undefined, accessToken: creds.accessToken,
      })
      postedId = r.id
    } else if (post.platform === 'ig') {
      if (!creds.igUserId) throw new Error('no Instagram account connected')
      if (!post.image_url) throw new Error('IG post requires an image_url')
      const r = await publishInstagramImage({
        igUserId: creds.igUserId, imageUrl: post.image_url, caption, accessToken: creds.accessToken,
      })
      postedId = r.id
    } else { // ig_reel
      if (!creds.igUserId) throw new Error('no Instagram account connected')
      if (!post.video_url) throw new Error('IG Reel requires a video_url')
      const r = await publishInstagramReel({
        igUserId: creds.igUserId, videoUrl: post.video_url, caption, accessToken: creds.accessToken,
      })
      postedId = r.id
    }

    await updateSocialPost(post.id, { status: 'posted', postedId })
    return { ok: true, postedId }
  } catch (e: any) {
    const error = e?.message || 'publish failed'
    await updateSocialPost(post.id, { status: 'failed', lastError: error })
    return { ok: false, error }
  }
}
