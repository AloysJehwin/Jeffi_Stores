import { aiChat } from '../ai-client'
import { searchHashtagReach } from '../meta'
import { withProductLink } from './product-url'

// Post-content generation: caption + hashtags for a product social post. Caption is
// LLM-composed (reuses the app's aiChat, modelHint 'copy'); hashtags are generated from the
// product then optionally reach-ranked via the IG Hashtag Search API.
//
// There is deliberately a HashtagProvider seam: today the default provider derives tags from
// product data (free), with optional IG reach-ranking. A paid "trending tags" API can be
// dropped in later by implementing the same interface — callers don't change.

export interface ProductForPost {
  name: string
  slug?: string | null
  category?: string | null
  brand?: string | null
  description?: string | null
  attributes?: Record<string, string> | null
}

export { productUrl, withProductLink } from './product-url'

/** Compose a short marketing caption. Falls back to a deterministic caption if the LLM is down. */
export async function generateCaption(product: ProductForPost, brandName: string): Promise<string> {
  const attrs = product.attributes
    ? Object.entries(product.attributes).map(([k, v]) => `${k}: ${v}`).join(', ')
    : ''
  try {
    const res = await aiChat({
      modelHint: 'copy',
      temperature: 0.7,
      maxTokens: 180,
      messages: [
        { role: 'system', content: `You write punchy, upbeat social-media captions for an online store (${brandName}). 1–2 short sentences, a light emoji or two, no hashtags (those are added separately). Never invent specs.` },
        { role: 'user', content: `Product: ${product.name}\nCategory: ${product.category ?? '—'}\nBrand: ${product.brand ?? '—'}\n${attrs ? `Details: ${attrs}\n` : ''}${product.description ? `About: ${product.description.slice(0, 300)}` : ''}` },
      ],
    })
    const text = res.content.trim()
    if (text) return withProductLink(text, product.slug)
  } catch { /* fall through to deterministic caption */ }
  return withProductLink(`${product.name} — now available at ${brandName}. Shop today!`, product.slug)
}

export interface HashtagProvider {
  /** Return candidate hashtags (WITHOUT the leading #) for a product. */
  suggest(product: ProductForPost): Promise<string[]>
}

/** Slugify a token to a valid hashtag word (alnum only, no spaces/punctuation). */
function tagWord(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** Default provider: derive candidate tags from product fields + a few evergreen store tags. */
export const productHashtagProvider: HashtagProvider = {
  async suggest(product) {
    const raw = [
      product.name, product.category, product.brand,
      ...(product.attributes ? Object.values(product.attributes) : []),
      'onlineshopping', 'shopnow', 'sale',
    ]
    const seen = new Set<string>()
    const tags: string[] = []
    for (const r of raw) {
      if (!r) continue
      // split multi-word values into individual + combined tags
      const combined = tagWord(String(r))
      if (combined && combined.length >= 3 && !seen.has(combined)) { seen.add(combined); tags.push(combined) }
    }
    return tags
  },
}

/**
 * Generate up to `max` hashtags for a product. When an IG account is available, candidates are
 * reach-ranked via the IG Hashtag Search API (best-effort); otherwise returns the candidates
 * as-is. Returns a space-joined '#tag' string ready to append to a caption.
 */
export async function generateHashtags(
  product: ProductForPost,
  opts?: { max?: number; igUserId?: string; accessToken?: string; provider?: HashtagProvider },
): Promise<string> {
  const provider = opts?.provider ?? productHashtagProvider
  const max = opts?.max ?? 12
  const candidates = await provider.suggest(product)

  let ordered = candidates
  if (opts?.igUserId && opts?.accessToken) {
    const scored = await Promise.all(
      candidates.map(async (t) => ({ t, reach: await searchHashtagReach(opts.igUserId!, t, opts.accessToken!) })),
    )
    ordered = scored.sort((a, b) => b.reach - a.reach).map((s) => s.t)
  }
  return ordered.slice(0, max).map((t) => `#${t}`).join(' ')
}
