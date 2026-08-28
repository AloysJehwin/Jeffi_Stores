// Split out of content.ts so the composer can import it: content.ts pulls in ai-client and
// meta, which must not be bundled into a client component.

/**
 * Public storefront URL for a product — what a social caption should actually link to.
 *
 * The scheme is forced on: Facebook only auto-links text that starts with http(s)://, so a base
 * of "jeffistores.in" would silently post the URL as dead plain text rather than a link.
 */
export function productUrl(slug: string): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistores.in').trim()
  const base = (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, '')
  return `${base}/products/${slug}`
}

/**
 * Append the product link to a caption. Captions are LLM-written and the model is told not to
 * invent URLs, so the link is attached here where the real slug is known. Idempotent: a caption
 * that already carries the link is returned unchanged, so re-generating never doubles it.
 */
export function withProductLink(caption: string, slug?: string | null): string {
  if (!slug) return caption
  const url = productUrl(slug)
  if (caption.includes(url)) return caption
  return caption.trim() ? `${caption.trim()}\n\n${url}` : url
}
