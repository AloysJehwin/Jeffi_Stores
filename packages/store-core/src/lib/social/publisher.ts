import { updateSocialPost, type ScheduledSocialPost } from '../tenant-registry'
import { queryOne } from '@/lib/shared/db'
import { resolveCurrentTenant, storeBaseUrlAsync } from '@/lib/catalog/brand'
import { generateSocialCaption } from './caption'
import { productUrl } from './product-url'
import { authFor } from './accounts'
import { networkOf, providerFor } from './providers'
import { fitHashtags, fitText, type Network } from './providers/types'

// Publisher: one claimed scheduled_social_posts row to a live post through the network's provider.
// The row is already 'publishing' (claimDueSocialPosts). Links carry UTM tags (source = network,
// campaign = social_<post>) so orders attribute back to the post. A failure is retried with
// backoff (5, 10, 20, 40 minutes) and marked failed after the fifth attempt.

export const MAX_ATTEMPTS = 5
const BASE_BACKOFF_MS = 5 * 60_000

export function retryDelayMs(attempts: number): number {
  return BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1)
}

/** The destination with UTM tags for this network and post (existing query kept). */
export function withUtm(url: string, network: Network, campaignId: string): string {
  try {
    const u = new URL(url)
    u.searchParams.set('utm_source', network)
    u.searchParams.set('utm_medium', 'social')
    u.searchParams.set('utm_campaign', `social_${campaignId}`)
    return u.toString()
  } catch {
    return url
  }
}

/** Caption + link + hashtags, fitted to the network's limits. The link goes in the text where the
 * network has no link field for this kind of post (X adds its own; YouTube and Instagram have none;
 * Facebook and LinkedIn image posts drop the link field). */
export function linkInText(network: Network, hasImages: boolean): boolean {
  if (network === 'instagram' || network === 'youtube') return true
  if (network === 'facebook' || network === 'linkedin') return hasImages
  return false
}

export function composeCaption(network: Network, caption: string, hashtags: string | null, link: string | null, hasImages = false): string {
  const p = providerFor(network)
  const tags = hashtags ? fitHashtags(hashtags, p.limits.hashtags) : ''
  const inlineLink = link && linkInText(network, hasImages) && !caption.includes(link) ? link : ''
  const tail = [inlineLink, tags].filter(Boolean).join('\n\n')
  const room = p.limits.caption - (tail ? tail.length + 2 : 0)
  const body = fitText(caption.trim(), Math.max(20, room))
  return [body, tail].filter(Boolean).join('\n\n')
}

async function getProductForCaption(productId: string): Promise<{ name: string; slug: string; description: string | null } | null> {
  return queryOne<{ name: string; slug: string; description: string | null }>(
    `SELECT name, slug, COALESCE(short_description, description) AS description FROM products WHERE id = $1`,
    [productId]
  )
}

async function tenantStoreBase(): Promise<string | undefined> {
  const tenant = await resolveCurrentTenant()
  return tenant?.slug ? storeBaseUrlAsync() : undefined
}

export async function publishScheduledPost(post: ScheduledSocialPost): Promise<{ ok: boolean; postedId?: string; error?: string }> {
  const network = networkOf(post.platform)
  const provider = providerFor(network)
  try {
    const auth = await authFor(post.tenant_id, network)
    if (!auth) throw new Error(`${provider.label} is not connected for this store`)
    const product = post.product_id ? await getProductForCaption(post.product_id) : null
    const base = post.link_url || (product ? productUrl(product.slug, await tenantStoreBase()) : null)
    const link = base ? withUtm(base, network, post.group_id ?? post.id) : null

    let caption = post.caption?.trim() ?? ''
    if (!caption && product) {
      caption = await generateSocialCaption({ productName: product.name, productDescription: product.description })
      if (caption) await updateSocialPost(post.id, { caption })
    }
    const images = [post.image_url, ...(post.image_urls ?? [])].filter((u): u is string => !!u)
    if (provider.requires.image && !images.length && !post.video_url) throw new Error(`${provider.label} needs an image`)
    if (provider.requires.video && !post.video_url) throw new Error(`${provider.label} needs a video`)

    const r = await provider.publish(auth, {
      caption: composeCaption(network, caption, post.hashtags, link, images.length > 0),
      title: post.title ?? product?.name ?? null,
      link,
      imageUrls: images,
      videoUrl: post.platform === 'fb' || post.platform === 'ig' ? null : post.video_url,
    })
    await updateSocialPost(post.id, { status: 'posted', postedId: r.externalId, permalink: r.url ?? null, lastError: null, nextAttemptAt: null })
    return { ok: true, postedId: r.externalId }
  } catch (e: any) {
    const error = String(e?.message || 'publish failed').slice(0, 500)
    const attempts = post.attempts ?? 1
    if (attempts < MAX_ATTEMPTS) {
      await updateSocialPost(post.id, { status: 'pending', lastError: error, nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)) })
    } else {
      await updateSocialPost(post.id, { status: 'failed', lastError: error })
    }
    return { ok: false, error }
  }
}
