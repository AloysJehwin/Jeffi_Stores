// Client-safe offer types and the pure href helper (no server imports).
// product-offers.ts (server) re-exports these; client components import from here.

export interface ProductOffer {
  id: string
  slug: string
  title: string
  subtitle: string | null
  badge_text: string | null
  badge_color: string | null
  image_url: string | null
  image_url_mobile: string | null
  blurhash: string | null
  blurhash_mobile: string | null
  cta_label: string | null
  starts_at: string | null
  ends_at: string | null
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Destination for an offer card: the products list filtered to this offer. */
export function offerHref(slug: string): string {
  return `/products?offer=${encodeURIComponent(slug)}`
}

/** Slugify a title for a new offer: lower-case, hyphenated, ascii-safe. */
export function slugifyOffer(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 200) || 'offer'
  )
}

export type PromoOffer = Pick<
  ProductOffer,
  | 'slug'
  | 'title'
  | 'subtitle'
  | 'badge_text'
  | 'badge_color'
  | 'image_url'
  | 'image_url_mobile'
  | 'blurhash'
  | 'blurhash_mobile'
  | 'cta_label'
>

/**
 * The offer to feature on a listing page: live, has an image, holds products (`eligibleSlugs`),
 * and is not the offer already being filtered on. Rotates by page so each page is stable.
 */
export function pickPromoOffer<T extends Pick<ProductOffer, 'slug' | 'image_url' | 'image_url_mobile'>>(
  offers: T[],
  opts: { page: number; activeSlug?: string | null; eligibleSlugs: Set<string> }
): T | null {
  const candidates = offers.filter(
    o => (o.image_url || o.image_url_mobile) && o.slug !== opts.activeSlug && opts.eligibleSlugs.has(o.slug)
  )
  if (candidates.length === 0) return null
  const page = Number.isFinite(opts.page) && opts.page >= 1 ? Math.floor(opts.page) : 1
  return candidates[(page - 1) % candidates.length]
}
