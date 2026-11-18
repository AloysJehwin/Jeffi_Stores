// Who a page is for, the device it is laid out for, and which page it is. Every (audience, surface, page) is its own
// document: nothing set on one changes another. The app has the home page only.

export type SiteAudience = 'store' | 'business'
export type SiteSurface = 'web' | 'web_mobile' | 'app'

export const SITE_AUDIENCES: SiteAudience[] = ['store', 'business']
export const SITE_SURFACES: SiteSurface[] = ['web', 'web_mobile', 'app']

export const PAGE_KEYS = [
  'home',
  'products',
  'category',
  'brand',
  'categories',
  'brands',
  'product',
  'cart',
  'checkout',
  'wishlist',
  'compare',
  'account',
  'login',
  'signup',
  'about',
  'contact',
  'support',
  'returns',
  'legal',
  'search',
  'track',
  'not_found',
  'custom',
  'quotes',
  'orders',
  'catalog',
  'header',
  'footer',
  'announcement',
  // The site's product card: one code section that every product list draws its products with.
  'card',
  // A Showcase site's one page (lib/showcase): never part of a store.
  'showcase',
] as const
export type PageKey = (typeof PAGE_KEYS)[number]

export const isPageKey = (v: unknown): v is PageKey => typeof v === 'string' && (PAGE_KEYS as readonly string[]).includes(v)

/** The site-wide parts every page shares, laid out per layout like a page (the app keeps its own native chrome). */
export const CHROME_PAGES = ['header', 'footer', 'announcement'] as const
export const isChromePage = (page: PageKey) => (CHROME_PAGES as readonly string[]).includes(page)

/** Pages a surface can have: the app lays out its home page and the sections between listing products. */
export const surfaceAllows = (surface: SiteSurface, page: PageKey) =>
  surface !== 'app' || page === 'home' || page === 'products' || page === 'category' || page === 'brand'

export interface PageRef {
  audience: SiteAudience
  surface: SiteSurface
  page: PageKey
  /** Custom pages only (`/p/<slug>`); '' otherwise. */
  slug?: string
}

export const pageRefKey = (r: PageRef) => `${r.audience}:${r.surface}:${r.page}:${r.slug ?? ''}`

export function parsePageRefKey(key: string): PageRef | null {
  const [audience, surface, page, slug = ''] = key.split(':')
  if (!SITE_AUDIENCES.includes(audience as SiteAudience) || !SITE_SURFACES.includes(surface as SiteSurface) || !isPageKey(page)) return null
  return { audience: audience as SiteAudience, surface: surface as SiteSurface, page, slug }
}
