import {
  getTenantSocialAccounts,
  updateSocialPost,
  type ScheduledSocialPost,
  type TenantSocialAccount,
} from '../tenant-registry'
import { decryptToken } from '../crypto/token-cipher'
import {
  publishFacebookPost,
  publishFacebookCarousel,
  publishInstagramImage,
  publishInstagramCarousel,
  publishInstagramReel,
} from '../meta'
import { queryOne } from '../db'
import { generateSocialCaption } from './caption'

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

/** Minimal product info from the app DB, for AI caption generation. Not the full getProduct() graph. */
async function getProductForCaption(productId: string): Promise<{ name: string; description: string | null } | null> {
  return queryOne<{ name: string; description: string | null }>(
    `SELECT name, COALESCE(short_description, description) AS description FROM products WHERE id = $1`,
    [productId],
  )
}

/** If the post has no caption, generate one from its linked product (falls back to '' — never throws). */
async function ensureCaption(post: ScheduledSocialPost): Promise<string> {
  if (post.caption?.trim()) return post.caption
  if (!post.product_id) return ''
  const product = await getProductForCaption(post.product_id)
  if (!product) return ''
  const generated = await generateSocialCaption({ productName: product.name, productDescription: product.description })
  if (generated) await updateSocialPost(post.id, { caption: generated })
  return generated
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

    const resolvedCaption = await ensureCaption(post)
    const caption = [resolvedCaption, post.hashtags].filter(Boolean).join('\n\n')
    const allImages = [post.image_url, ...(post.image_urls ?? [])].filter((u): u is string => !!u)

    let postedId: string
    if (post.platform === 'fb') {
      if (!creds.pageId) throw new Error('no Facebook Page id')
      const r = allImages.length >= 2
        ? await publishFacebookCarousel({ pageId: creds.pageId, message: caption, imageUrls: allImages, accessToken: creds.accessToken })
        : await publishFacebookPost({ pageId: creds.pageId, message: caption, imageUrl: allImages[0], accessToken: creds.accessToken })
      postedId = r.id
    } else if (post.platform === 'ig') {
      if (!creds.igUserId) throw new Error('no Instagram account connected')
      if (!allImages.length) throw new Error('IG post requires an image_url')
      const r = allImages.length >= 2
        ? await publishInstagramCarousel({ igUserId: creds.igUserId, imageUrls: allImages, caption, accessToken: creds.accessToken })
        : await publishInstagramImage({ igUserId: creds.igUserId, imageUrl: allImages[0], caption, accessToken: creds.accessToken })
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
