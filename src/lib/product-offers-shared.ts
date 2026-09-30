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
