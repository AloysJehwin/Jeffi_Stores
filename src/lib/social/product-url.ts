// Split out of content.ts so the composer can import it: content.ts pulls in ai-client and
// meta, which must not be bundled into a client component.

import { storeHostForHost } from '@/lib/tenancy/forms-host'

/**
 * Public storefront URL for a product — what a social caption should actually link to.
 *
 * The scheme is forced on: Facebook only auto-links text that starts with http(s)://, so a base
 * of "jeffistores.in" would silently post the URL as dead plain text rather than a link.
 */
export function productUrl(slug: string, storeBase?: string): string {
  const raw = (storeBase || defaultStoreBase()).trim()
  const base = (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, '')
  return `${base}/products/${slug}`
}

// In the admin composer the store is the one whose admin host we're on (admin-{slug}. → {slug}.);
// server callers pass the tenant's base explicitly, and the platform keeps its configured URL.
function defaultStoreBase(): string {
  if (typeof window !== 'undefined') return `https://${storeHostForHost(window.location.hostname)}`
  return process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistores.in'
}

/**
 * Append the product link to a caption. Captions are LLM-written and the model is told not to
 * invent URLs, so the link is attached here where the real slug is known. Idempotent: a caption
 * that already carries the link is returned unchanged, so re-generating never doubles it.
 */
export function withProductLink(caption: string, slug?: string | null, storeBase?: string): string {
  if (!slug) return caption
  const url = productUrl(slug, storeBase)
  if (caption.includes(url)) return caption
  return caption.trim() ? `${caption.trim()}\n\n${url}` : url
}
