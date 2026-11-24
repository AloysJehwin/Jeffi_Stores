import { SHOWCASE_HOST_PREFIX } from './types'

// A Showcase's address: site-{slug}.<root>, and site-{slug}.localhost in dev (the dev router on :3000 sends it to
// showcase-service). No database here, so client components can use it.

const ROOT = process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'

/** 3–58 characters (the host label stays within 63), lowercase letters, digits and inner hyphens. */
export const SHOWCASE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,56}[a-z0-9])$/

export const showcaseHost = (slug: string) => `${SHOWCASE_HOST_PREFIX}${slug}.${ROOT}`

/** Where the site opens: https://site-{slug}.<root>, or the dev router's site-{slug}.localhost:3000 outside production. */
export function showcaseUrl(slug: string): string {
  return process.env.NODE_ENV === 'production' ? `https://${showcaseHost(slug)}` : `http://${SHOWCASE_HOST_PREFIX}${slug}.localhost:3000`
}

/** The slug a site-{slug}.<root> (or site-{slug}.localhost) host names; null for any other host. */
/** The query flag the console adds when the owner opens their own site: showcase-service's tracker doesn't count it. */
export const SHOWCASE_PREVIEW_PARAM = 'jeffi_preview'

/** The site's home on its own host, as its owner's look (not counted). */
export const SHOWCASE_OWNER_HOME = `/?${SHOWCASE_PREVIEW_PARAM}=1`

/** The site's address as the console links it for its owner (not counted as a visit). */
export const showcasePreviewUrl = (slug: string) => `${showcaseUrl(slug)}?${SHOWCASE_PREVIEW_PARAM}=1`

export function showcaseSlugFromHost(host: string): string | null {
  const h = host.toLowerCase().split(':')[0].trim()
  const root = h.endsWith('.localhost') ? 'localhost' : ROOT
  if (!h.endsWith(`.${root}`)) return null
  const label = h.slice(0, -(root.length + 1))
  if (!label.startsWith(SHOWCASE_HOST_PREFIX)) return null
  const slug = label.slice(SHOWCASE_HOST_PREFIX.length)
  return SHOWCASE_SLUG_RE.test(slug) ? slug : null
}
