import type { CardProps } from '@/lib/catalog/product-card-props'

export type SectionType =
  | 'hero'
  | 'offer_slider'
  | 'trust_strip'
  | 'category_grid'
  | 'brand_carousel'
  | 'product_row'
  | 'category_showcase'
  | 'deal_of_the_day'
  | 'promo_banner'
  | 'featured_for_you'
  | 'benefits'
  | 'why_us'
  | 'about'
  | 'business_cta'
  | 'countdown_deal'
  | 'testimonials'
  | 'recently_viewed'
  | 'category_tabs'
  | 'bundle_spotlight'
  | 'back_in_stock'
  | 'blog_teaser'
  | 'social_strip'
  | 'value_stats'
  | 'motion_hero'
  | 'stories'
  | 'product_spotlight'
  | 'rewards_game'
  | 'slides'

export const SECTION_TYPES: SectionType[] = [
  'hero',
  'offer_slider',
  'trust_strip',
  'category_grid',
  'brand_carousel',
  'product_row',
  'category_showcase',
  'deal_of_the_day',
  'promo_banner',
  'featured_for_you',
  'benefits',
  'why_us',
  'about',
  'business_cta',
  'countdown_deal',
  'testimonials',
  'recently_viewed',
  'category_tabs',
  'bundle_spotlight',
  'back_in_stock',
  'blog_teaser',
  'social_strip',
  'value_stats',
  'motion_hero',
  'stories',
  'product_spotlight',
  'rewards_game',
  'slides',
]

/**
 * Types an app build from before per-surface layouts never sees: a GET /api/home with no ?surface
 * is such a build, and it renders nothing for a type it doesn't know, so these are left out of its
 * payload rather than loaded for nothing.
 */
export const LEGACY_APP_HIDDEN_TYPES: ReadonlySet<SectionType> = new Set<SectionType>([
  'motion_hero',
  'stories',
  'product_spotlight',
  'rewards_game',
  'slides',
])

/** Which query backs a product_row. Collapses the separate featured/new/best-seller fetches. */
export type ProductSource = 'featured' | 'new_arrivals' | 'best_sellers' | 'on_sale' | 'category'

export type SectionLayout = 'grid' | 'carousel'

/** The website and the mobile app each have their own homepage layout (sections and hero slides). */
export type HomepageSurface = 'web' | 'app'

export const HOMEPAGE_SURFACES: HomepageSurface[] = ['web', 'app']

export interface HomepageSection {
  id: string
  type: SectionType
  title: string | null
  subtitle: string | null
  eyebrow: string | null
  cta_label: string | null
  cta_url: string | null
  config: Record<string, unknown>
  display_order: number
  is_active: boolean
  starts_at: string | null
  ends_at: string | null
  /** Absent on rows saved before the column existed; read it through rowSurface(). */
  surface?: HomepageSurface | null
}

export function rowSurface(row: { surface?: string | null }): HomepageSurface {
  return row.surface === 'app' ? 'app' : 'web'
}

/**
 * The rows that belong to a surface. The app mirrors the website until it has a layout of its own
 * (any app row, active or not), so a store that never opens the Mobile app tab keeps one layout.
 */
export function forSurface<T extends { surface?: string | null }>(rows: T[], surface: HomepageSurface): T[] {
  const own = rows.filter(r => rowSurface(r) === surface)
  if (own.length > 0 || surface === 'web') return own
  return rows.filter(r => rowSurface(r) === 'web')
}

export interface SectionMeta {
  label: string
  description: string
  /** A singleton may only appear once on the page. */
  singleton?: boolean
  /** Surfaces that can use the type; absent means both. */
  surfaces?: HomepageSurface[]
  /** Types this one cannot share a layout with (two auto-advancing heroes, say). */
  excludes?: SectionType[]
}

/** The types the picker offers on a surface. */
export function sectionTypesFor(surface: HomepageSurface): SectionType[] {
  return SECTION_TYPES.filter(t => {
    const only = SECTION_META[t].surfaces
    return !only || only.includes(surface)
  })
}

export const SECTION_META: Record<SectionType, SectionMeta> = {
  hero: {
    label: 'Hero slides',
    description: 'Full-width rotating banner at the top of the page.',
    singleton: true,
    excludes: ['motion_hero'],
  },
  offer_slider: {
    label: 'Offer slider',
    description: 'Centered offer cards with left and right peek, each linking to its filtered products.',
    singleton: true,
  },
  trust_strip: { label: 'Trust strip', description: 'Row of delivery, returns and payment reassurances.' },
  category_grid: { label: 'Shop by category', description: 'Grid or carousel of top-level categories.' },
  brand_carousel: { label: 'Shop by brand', description: 'Grid or carousel of brands you stock.' },
  product_row: { label: 'Product row', description: 'Featured, new arrivals, best sellers, on sale, or one category.' },
  category_showcase: { label: 'Category showcase', description: 'Large category cards with product thumbnails.' },
  deal_of_the_day: { label: 'Deal of the day', description: 'A small set of highlighted offers.' },
  promo_banner: { label: 'Promo banner', description: 'Seasonal or sale banner. Supports a start and end date.' },
  featured_for_you: {
    label: 'Featured for you',
    description: 'Personalised picks. Hidden for signed-out visitors.',
    singleton: true,
  },
  benefits: { label: 'Benefits', description: 'Why-shop-with-us tiles.' },
  why_us: { label: 'Why us', description: 'Three larger cards explaining what sets the store apart.', singleton: true },
  about: { label: 'About', description: 'Store story with stats.', singleton: true },
  business_cta: { label: 'Business CTA', description: 'Banner promoting the B2B/bulk experience.', singleton: true },
  countdown_deal: {
    label: 'Countdown deal',
    description: 'One product in a full-width banner with a live countdown. Hides itself when the timer ends.',
  },
  testimonials: {
    label: 'Testimonials',
    description: 'Approved customer reviews, highest rated first.',
    singleton: true,
  },
  recently_viewed: {
    label: 'Recently viewed',
    description: "Each visitor's own recently viewed products. Hidden until they have viewed enough.",
    singleton: true,
  },
  category_tabs: {
    label: 'Category tabs',
    description: 'Tabs for your top categories, each showing its best sellers.',
  },
  bundle_spotlight: {
    label: 'Bundle spotlight',
    description: 'Products sold as bundles, or ones you pick, with their saving.',
  },
  back_in_stock: {
    label: 'Back in stock',
    description: 'Products that sold out and have just been restocked.',
    singleton: true,
  },
  blog_teaser: {
    label: 'Guides and articles',
    description: 'Cards linking to your guides, articles or blog posts.',
    singleton: true,
  },
  social_strip: {
    label: 'Social strip',
    description: 'A row of photos linking to your social posts.',
    singleton: true,
  },
  value_stats: {
    label: 'Store stats',
    description: 'Animated live numbers: orders shipped, products, cities served, customers.',
    singleton: true,
  },
  motion_hero: {
    label: 'Animated hero',
    description: 'Layered slides with a foreground image that drifts over the background and a headline that reveals itself.',
    singleton: true,
    excludes: ['hero'],
  },
  stories: {
    label: 'Stories',
    description: 'A row of tappable rings that open full-screen image stories with a Shop button.',
    singleton: true,
  },
  product_spotlight: {
    label: 'Product spotlight',
    description: 'One product, large, with callouts that appear as the visitor scrolls past.',
  },
  rewards_game: {
    label: 'Rewards game',
    description: 'A spin-the-wheel or scratch card that gives signed-in customers a coupon.',
    singleton: true,
  },
  slides: {
    label: 'Slides',
    description: 'A slider of offers, categories, products or your own animated slides.',
  },
}

export interface SectionCopy {
  eyebrow?: string
  title?: string
  subtitle?: string
  body?: string
  imageUrl?: string
  ctaLabel?: string
  ctaUrl?: string
}

/** Copy the storefront renders when a section leaves a field empty; the admin shows the same text. */
export const SECTION_COPY_DEFAULTS = {
  product_row: { title: 'Products', ctaLabel: 'View All', ctaUrl: '/products' },
  category_grid: { eyebrow: 'Explore', title: 'Shop by Category' },
  brand_carousel: { eyebrow: 'Trusted Names', title: 'Shop by Brand' },
  category_showcase: { eyebrow: 'Shop by Category', title: 'Top Categories' },
  deal_of_the_day: { eyebrow: 'Limited Time', title: 'Deal of the Day' },
  featured_for_you: { eyebrow: 'Picked for you', title: 'Featured For You' },
  why_us: { eyebrow: 'Why us', title: 'Built for Industry' },
  about: {
    eyebrow: 'About Us',
    title: 'Your Trusted Hardware Partner',
    body: 'We combine product breadth with expert service so your operations stay seamless and efficient.',
    imageUrl: '/images/Working.png',
    ctaLabel: 'Learn More',
    ctaUrl: '/about',
  },
  business_cta: {
    eyebrow: 'For Business',
    title: 'Buying for a business?',
    subtitle:
      'Bulk discounts, GSTIN invoicing, and a dedicated account manager. Trusted by 500+ businesses across India.',
    ctaLabel: 'Register Now',
  },
  countdown_deal: { eyebrow: 'Limited time', title: 'Deal ends soon', ctaLabel: 'Grab the deal' },
  testimonials: { eyebrow: 'Customer reviews', title: 'What our customers say' },
  recently_viewed: { title: 'Recently viewed' },
  category_tabs: { eyebrow: 'Best sellers', title: 'Top picks by category' },
  bundle_spotlight: { eyebrow: 'Better together', title: 'Bundle deals' },
  back_in_stock: { eyebrow: 'Restocked', title: 'Back in stock' },
  blog_teaser: { eyebrow: 'Guides', title: 'Tips and how-tos' },
  social_strip: { eyebrow: 'Follow along', title: 'Find us on social', ctaLabel: 'Follow us' },
  value_stats: { eyebrow: 'By the numbers', title: 'Trusted by our customers' },
  stories: { eyebrow: 'Fresh today', title: 'Stories' },
  product_spotlight: { eyebrow: 'Spotlight', ctaLabel: 'Shop now' },
  rewards_game: { eyebrow: 'Your reward', title: 'Spin to win', ctaLabel: 'Play now' },
} satisfies Partial<Record<SectionType, SectionCopy>>

export function sectionCopyDefaults(type: SectionType): SectionCopy {
  return (SECTION_COPY_DEFAULTS as Partial<Record<SectionType, SectionCopy>>)[type] ?? {}
}

/** Tiles the storefront shows while a tile section has none saved; the admin shows the same tiles. */
export const SECTION_TILE_DEFAULTS = {
  trust_strip: [
    { icon: 'Truck', label: 'Free delivery above {amount}' },
    { icon: 'Receipt', label: 'GST invoice on every order' },
    { icon: 'Boxes', label: '10,000+ products in stock' },
    { icon: 'CreditCard', label: 'Cash on delivery available' },
  ],
  benefits: [
    {
      icon: 'Receipt',
      title: 'Save up to 18% with GST',
      sub: 'Claim input tax credit on every purchase with a valid GSTIN invoice',
    },
    {
      icon: 'CreditCard',
      title: 'Bulk order discounts',
      sub: 'Special pricing for businesses ordering in volume — contact us for a quote',
    },
    {
      icon: 'Clock',
      title: 'Dedicated account manager',
      sub: 'Registered businesses get priority support and a personal account manager',
    },
  ],
  why_us: [
    {
      icon: 'Zap',
      title: 'Fast Delivery',
      desc: 'Prompt dispatch and reliable delivery to your doorstep across India.',
      color: 'primary',
    },
    {
      icon: 'Boxes',
      title: 'Wide Range',
      desc: 'Fasteners, power tools, electrical, welding, and hundreds of industrial categories.',
      color: 'accent',
    },
    {
      icon: 'Clock',
      title: '24/7 Support',
      desc: 'Expert team always available to help you source the right product fast.',
      color: 'secondary',
    },
  ],
  about: [
    { value: '10+', label: 'Years in Business' },
    { value: '1000+', label: 'Happy Customers' },
  ],
} satisfies Partial<Record<SectionType, Record<string, string>[]>>

/** The About stats from the store's stats JSON setting, else the built-in tiles. */
export function resolveAboutStats(statsJson: string): { value: string; label: string }[] {
  if (statsJson.trim()) {
    try {
      const parsed = JSON.parse(statsJson)
      if (
        Array.isArray(parsed) &&
        parsed.length &&
        parsed.every(s => s && typeof s.value === 'string' && typeof s.label === 'string')
      ) {
        return parsed
      }
    } catch {
      /* fall through to the built-in tiles */
    }
  }
  return SECTION_TILE_DEFAULTS.about
}

/** The About story when the section has none: the store's own about copy, else a line naming the store. */
export function defaultAboutCopy(storeAboutCopy: string, storeName: string): string {
  return storeAboutCopy.trim() || `${storeName} brings you a curated range of quality products, delivered across India.`
}

const DEFAULT_LIMITS: Partial<Record<SectionType, number>> = {
  category_grid: 8,
  brand_carousel: 8,
  category_showcase: 4,
  deal_of_the_day: 4,
  testimonials: 6,
  recently_viewed: 6,
  bundle_spotlight: 4,
  back_in_stock: 8,
}

export function sectionLimit(section: Pick<HomepageSection, 'type' | 'config'>, fallback?: number): number {
  const raw = section.config?.limit
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  if (Number.isFinite(n) && n > 0) return n
  return fallback ?? DEFAULT_LIMITS[section.type] ?? 8
}

export function sectionLayout(section: Pick<HomepageSection, 'config'>): SectionLayout {
  return section.config?.layout === 'carousel' ? 'carousel' : 'grid'
}

export function productSource(section: Pick<HomepageSection, 'config'>): ProductSource {
  const s = section.config?.source
  return s === 'new_arrivals' || s === 'best_sellers' || s === 'on_sale' || s === 'category' ? s : 'featured'
}

/** Cache key so two rows with identical settings cost one query. */
export function productRowKey(section: Pick<HomepageSection, 'config'>, limit: number): string {
  const categorySlug = typeof section.config?.categorySlug === 'string' ? section.config.categorySlug : ''
  return `${productSource(section)}:${limit}:${categorySlug}`
}

/** A positive whole-number config value, capped, else the fallback. */
export function configNumber(
  section: Pick<HomepageSection, 'config'>,
  key: string,
  fallback: number,
  max = 100
): number {
  const raw = section.config?.[key]
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : fallback
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Record ids saved in config (picked products or categories); anything malformed is dropped. */
export function configIds(section: Pick<HomepageSection, 'config'>, key: string): string[] {
  const raw = section.config?.[key]
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && GUID.test(v)) : []
}

/** An admin-entered link, kept only when it is a site path or an http(s) URL (never javascript:). */
export function safeHref(url: string | null | undefined): string | null {
  const u = (url ?? '').trim()
  return /^(https?:\/\/|\/(?![/\\]))/i.test(u) ? u : null
}

export function configId(section: Pick<HomepageSection, 'config'>, key: string): string | null {
  const raw = section.config?.[key]
  return typeof raw === 'string' && GUID.test(raw) ? raw : null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const objects = (raw: unknown): Record<string, unknown>[] =>
  Array.isArray(raw) ? raw.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : []

// Animated hero: `config.slides`, each with a background image and a headline at least.
export interface MotionHeroSlide {
  bgImage: string
  fgImage: string | null
  eyebrow: string | null
  headline: string
  sub: string | null
  ctaLabel: string | null
  url: string | null
}

export function motionHeroSlides(section: Pick<HomepageSection, 'config'>): MotionHeroSlide[] {
  const slides: MotionHeroSlide[] = []
  for (const r of objects(section.config?.slides)) {
    const bgImage = safeHref(str(r.bgImage))
    const headline = str(r.headline)
    if (!bgImage || !headline) continue
    slides.push({
      bgImage,
      fgImage: safeHref(str(r.fgImage)),
      eyebrow: str(r.eyebrow),
      headline,
      sub: str(r.sub),
      ctaLabel: str(r.ctaLabel),
      url: safeHref(str(r.url)),
    })
    if (slides.length === 8) break
  }
  return slides
}

/** Seconds a slide stays before the next one; the editor stores `intervalSeconds`. */
export function motionHeroIntervalMs(section: Pick<HomepageSection, 'config'>): number {
  return Math.max(3, configNumber(section, 'intervalSeconds', 6, 20)) * 1000
}

// Stories: `config.groups`, each a titled ring with a cover and image slides.
export interface StorySlide {
  id: string
  image: string
  caption: string | null
  ctaLabel: string | null
  url: string | null
  /** How long the slide shows, 2–15 s. */
  seconds: number
}

export interface StoryGroup {
  id: string
  title: string
  cover: string
  slides: StorySlide[]
}

export function storyGroups(section: Pick<HomepageSection, 'config'>): StoryGroup[] {
  const groups: StoryGroup[] = []
  objects(section.config?.groups).forEach((g, gi) => {
    const title = str(g.title)
    const cover = safeHref(str(g.cover))
    if (!title || !cover) return
    const slides: StorySlide[] = []
    objects(g.slides).forEach((s, si) => {
      const image = safeHref(str(s.image))
      if (!image) return
      const secs = typeof s.seconds === 'number' ? s.seconds : parseFloat(String(s.seconds ?? ''))
      slides.push({
        id: str(s.id) ?? `${gi}-${si}`,
        image,
        caption: str(s.caption),
        ctaLabel: str(s.ctaLabel),
        url: safeHref(str(s.url)),
        seconds: Number.isFinite(secs) ? Math.min(15, Math.max(2, secs)) : 5,
      })
    })
    if (slides.length === 0) return
    groups.push({ id: str(g.id) ?? `group-${gi}`, title, cover, slides: slides.slice(0, 12) })
  })
  return groups.slice(0, 24)
}

// Slides: `config.items`, each pointing at an offer, category or product, or a slide of its own.
export type SlidesLayout = 'cards' | 'banner' | 'rail' | 'fade'
export type SlidesAspect = '4:5' | '1:1' | '16:9'
export type SlideKind = 'offer' | 'category' | 'product' | 'custom'
export type SlideMotion = 'none' | 'kenburns' | 'parallax' | 'reveal'

export const SLIDES_LAYOUTS: SlidesLayout[] = ['cards', 'banner', 'rail', 'fade']
export const SLIDES_ASPECTS: SlidesAspect[] = ['4:5', '1:1', '16:9']
export const SLIDE_KINDS: SlideKind[] = ['offer', 'category', 'product', 'custom']
export const SLIDE_MOTIONS: SlideMotion[] = ['none', 'kenburns', 'parallax', 'reveal']
export const MAX_SLIDES = 12

export interface CustomSlide {
  id: string
  kind: 'custom'
  image: string
  imageCard: string | null
  eyebrow: string | null
  title: string
  sub: string | null
  ctaLabel: string | null
  url: string | null
  motion: SlideMotion
}

export type SlideItem =
  | { id: string; kind: 'offer'; offerId: string }
  | { id: string; kind: 'category'; categoryId: string }
  | { id: string; kind: 'product'; productId: string }
  | CustomSlide

export interface SlidesConfig {
  layout: SlidesLayout
  aspect: SlidesAspect
  autoplay: boolean
  /** 3–20 s; only used with autoplay. */
  intervalSeconds: number
  items: SlideItem[]
}

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback

const guid = (v: unknown): string | null => (typeof v === 'string' && GUID.test(v) ? v : null)

export function slidesConfig(section: Pick<HomepageSection, 'config'>): SlidesConfig {
  const cfg = section.config ?? {}
  const items: SlideItem[] = []
  const seen = new Set<string>()
  for (const [i, r] of objects(cfg.items).entries()) {
    let id = str(r.id) ?? `slide-${i}`
    if (seen.has(id)) id = `${id}-${i}`
    let item: SlideItem | null = null
    if (r.kind === 'offer') {
      const offerId = guid(r.offerId)
      if (offerId) item = { id, kind: 'offer', offerId }
    } else if (r.kind === 'category') {
      const categoryId = guid(r.categoryId)
      if (categoryId) item = { id, kind: 'category', categoryId }
    } else if (r.kind === 'product') {
      const productId = guid(r.productId)
      if (productId) item = { id, kind: 'product', productId }
    } else if (r.kind === 'custom') {
      const image = safeHref(str(r.image))
      const title = str(r.title)
      if (image && title) {
        item = {
          id,
          kind: 'custom',
          image,
          imageCard: safeHref(str(r.imageCard)),
          eyebrow: str(r.eyebrow),
          title,
          sub: str(r.sub),
          ctaLabel: str(r.ctaLabel),
          url: safeHref(str(r.url)),
          motion: oneOf(r.motion, SLIDE_MOTIONS, 'none'),
        }
      }
    }
    if (!item) continue
    seen.add(id)
    items.push(item)
    if (items.length === MAX_SLIDES) break
  }
  return {
    layout: oneOf(cfg.layout, SLIDES_LAYOUTS, 'cards'),
    aspect: oneOf(cfg.aspect, SLIDES_ASPECTS, '4:5'),
    autoplay: cfg.autoplay === true,
    intervalSeconds: Math.max(3, configNumber(section, 'intervalSeconds', 6, 20)),
    items,
  }
}

/** One resolved slide, whatever it points at; what the storefront and the app draw. */
export interface SlideCard {
  /** The item id from config, stable across edits. */
  id: string
  kind: SlideKind
  href: string | null
  title: string
  eyebrow: string | null
  sub: string | null
  badge: string | null
  /** A `bg-*` class for the badge pill, when the source sets one. */
  badgeClass: string | null
  ctaLabel: string | null
  /** The wide picture (or the only one). */
  image: string | null
  /** The portrait 4:5 picture, when there is one. */
  imageCard: string | null
  blurhash: string | null
  blurhashCard: string | null
  price?: number
  mrp?: number | null
  productId?: string
  productSlug?: string
  /** Product slides: the full card props, for the quick-add button. */
  product?: CardProps
  motion: SlideMotion
}

export type SlidesData = Omit<SlidesConfig, 'items'> & { slides: SlideCard[] }

// Product spotlight: one picked product with short callouts.
export interface SpotlightConfig {
  productId: string | null
  headline: string | null
  callouts: string[]
}

export function spotlightConfig(section: Pick<HomepageSection, 'config'>): SpotlightConfig {
  const raw = section.config?.callouts
  const callouts = Array.isArray(raw) ? raw.map(str).filter((c): c is string => !!c).slice(0, 4) : []
  return { productId: configId(section, 'productId'), headline: str(section.config?.headline), callouts }
}

// Rewards game: the admin saves any JSON, so the server re-validates on every play.
export type RewardPrizeKind = 'percent' | 'fixed' | 'none'
export type RewardPlayLimit = 'once' | 'daily' | 'weekly'
export type RewardGameMode = 'wheel' | 'scratch'

export interface RewardPrize {
  id: string
  label: string
  kind: RewardPrizeKind
  /** Percent off (1–90) or rupees off; 0 for a no-win segment. */
  value: number
  minPurchase: number
  maxDiscount: number | null
  /** Days the coupon stays valid, 1–365. */
  validDays: number
  /** Relative chance, > 0. */
  weight: number
}

export interface RewardsGameConfig {
  /** Minted by the editor; stable across publishes and layout copies so play limits hold. */
  gameKey: string | null
  mode: RewardGameMode
  playLimit: RewardPlayLimit
  prizes: RewardPrize[]
}

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : fallback
}

export function rewardsGameConfig(section: Pick<HomepageSection, 'config'>): RewardsGameConfig {
  const cfg = section.config ?? {}
  const prizes: RewardPrize[] = []
  for (const r of objects(cfg.prizes)) {
    const id = str(r.id)
    const label = str(r.label)
    const kind: RewardPrizeKind = r.kind === 'percent' || r.kind === 'fixed' || r.kind === 'none' ? r.kind : 'none'
    if (!id || !label) continue
    const value = kind === 'none' ? 0 : num(r.value, 0)
    if (kind === 'percent' && (value < 1 || value > 90)) continue
    if (kind === 'fixed' && value <= 0) continue
    const maxDiscount = kind === 'percent' ? num(r.maxDiscount, 0) : 0
    const weight = num(r.weight, 1)
    prizes.push({
      id: id.slice(0, 64),
      label: label.slice(0, 120),
      kind,
      value: Math.round(value * 100) / 100,
      minPurchase: Math.max(0, num(r.minPurchase, 0)),
      maxDiscount: maxDiscount > 0 ? maxDiscount : null,
      validDays: Math.min(365, Math.max(1, Math.round(num(r.validDays, 30)))),
      weight: weight > 0 ? weight : 1,
    })
    if (prizes.length === 12) break
  }
  return {
    gameKey: configId(section, 'gameKey'),
    mode: cfg.mode === 'scratch' ? 'scratch' : 'wheel',
    playLimit: cfg.playLimit === 'daily' || cfg.playLimit === 'weekly' ? cfg.playLimit : 'once',
    prizes,
  }
}

/** A game needs its key and at least two prizes before anyone can play it. */
export function rewardsGamePlayable(game: RewardsGameConfig): boolean {
  return !!game.gameKey && game.prizes.length >= 2
}

export interface RewardsGamePublic {
  gameKey: string
  mode: RewardGameMode
  playLimit: RewardPlayLimit
  prizes: { id: string; label: string; kind: RewardPrizeKind }[]
}

/** What a client may know about a game: never the weights or the coupon terms. Null when unplayable. */
export function rewardsGamePublic(section: Pick<HomepageSection, 'config'>): RewardsGamePublic | null {
  const game = rewardsGameConfig(section)
  if (!rewardsGamePlayable(game) || !game.gameKey) return null
  return {
    gameKey: game.gameKey,
    mode: game.mode,
    playLimit: game.playLimit,
    prizes: game.prizes.map(p => ({ id: p.id, label: p.label, kind: p.kind })),
  }
}

/** Days a product row badges products as new, or null when its Just Landed treatment is off. */
export function justLandedDays(section: Pick<HomepageSection, 'config'>): number | null {
  return section.config?.justLanded === true ? configNumber(section, 'newWithinDays', 30, 365) : null
}

export function launchedWithin(
  product: { launch_date?: unknown; created_at?: unknown },
  days: number,
  now = Date.now()
): boolean {
  const raw = product.launch_date || product.created_at
  const t = raw ? Date.parse(String(raw)) : NaN
  return Number.isFinite(t) && t <= now && now - t <= days * 86_400_000
}

export type ValueStatMetric = 'orders_shipped' | 'products' | 'cities' | 'customers'

export const VALUE_STAT_METRICS: { metric: ValueStatMetric; label: string }[] = [
  { metric: 'orders_shipped', label: 'Orders shipped' },
  { metric: 'products', label: 'Products to choose from' },
  { metric: 'cities', label: 'Cities served' },
  { metric: 'customers', label: 'Happy customers' },
]

const DEFAULT_VALUE_STATS: ValueStatMetric[] = ['orders_shipped', 'products', 'cities']

/** Rounds down to a figure that stays true with a "+": 1,234 reads as 1,200+. */
export function friendlyCount(n: number): string {
  const step = n >= 1000 ? 100 : n >= 100 ? 10 : 1
  const floored = Math.floor(n / step) * step
  return `${floored.toLocaleString('en-IN')}${step > 1 ? '+' : ''}`
}

/** The stats a Store stats section shows, in catalogue order, each with its label. */
export function valueStatMetrics(
  section: Pick<HomepageSection, 'config'>
): { metric: ValueStatMetric; label: string }[] {
  const raw = section.config?.metrics
  if (!Array.isArray(raw)) return VALUE_STAT_METRICS.filter(m => DEFAULT_VALUE_STATS.includes(m.metric))
  const picked = new Map<string, string>()
  for (const r of raw) {
    if (r && typeof r === 'object' && typeof (r as Record<string, unknown>).metric === 'string') {
      const label = (r as Record<string, unknown>).label
      picked.set((r as Record<string, unknown>).metric as string, typeof label === 'string' ? label.trim() : '')
    }
  }
  return VALUE_STAT_METRICS.filter(m => picked.has(m.metric)).map(m => ({
    metric: m.metric,
    label: picked.get(m.metric) || m.label,
  }))
}

// Scheduling is evaluated here rather than in SQL: a SQL NOW() would be frozen into the
// page's ISR cache entry and never re-evaluate.
export function isWithinWindow(section: Pick<HomepageSection, 'starts_at' | 'ends_at'>, now = Date.now()): boolean {
  if (section.starts_at && now < Date.parse(section.starts_at)) return false
  if (section.ends_at && now > Date.parse(section.ends_at)) return false
  return true
}

export function visibleSections(sections: HomepageSection[], now = Date.now()): HomepageSection[] {
  return sections.filter(s => s.is_active && isWithinWindow(s, now)).sort((a, b) => a.display_order - b.display_order)
}

type DefaultSection = Omit<HomepageSection, 'id' | 'is_active' | 'starts_at' | 'ends_at'>

const d = (
  type: SectionType,
  display_order: number,
  extra: Partial<Omit<DefaultSection, 'type' | 'display_order'>> = {}
): DefaultSection => ({
  type,
  title: null,
  subtitle: null,
  eyebrow: null,
  cta_label: null,
  cta_url: null,
  config: {},
  display_order,
  ...extra,
})

// The layout a store starts with: provisioning seeds it, and a store with no saved sections renders it.
// The engagement sections here need no setup and stay hidden until they have something to show.
export const DEFAULT_SECTIONS: DefaultSection[] = [
  d('hero', 0),
  d('trust_strip', 1),
  d('category_grid', 2, { title: 'Shop by Category', eyebrow: 'Browse' }),
  d('product_row', 3, { title: 'Featured Products', eyebrow: 'Handpicked', config: { source: 'featured' } }),
  d('brand_carousel', 4, { title: 'Shop by Brand', eyebrow: 'Trusted Names' }),
  d('product_row', 5, {
    title: 'New Arrivals',
    eyebrow: 'Just In',
    config: { source: 'new_arrivals', justLanded: true },
  }),
  d('category_showcase', 6, { title: 'Shop by Category', eyebrow: 'Explore' }),
  d('featured_for_you', 7),
  d('recently_viewed', 8),
  d('product_row', 9, { title: 'Best Sellers', eyebrow: 'Popular', config: { source: 'best_sellers' } }),
  d('category_tabs', 10),
  d('back_in_stock', 11),
  d('testimonials', 12),
  d('benefits', 13),
  d('why_us', 14, { title: 'Built for Industry', eyebrow: 'Why us' }),
  d('value_stats', 15),
  d('about', 16),
  d('business_cta', 17),
]

export function withDefaults(rows: HomepageSection[]): HomepageSection[] {
  if (rows.length > 0) return rows
  return DEFAULT_SECTIONS.map((s, i) => ({
    ...s,
    id: `default-${i}`,
    is_active: true,
    starts_at: null,
    ends_at: null,
  }))
}

export interface PickerProduct {
  id: string
  name: string
  sku: string | null
  image_url: string | null
  is_bundle: boolean
}

export interface PreviewItem {
  id: string
  name: string
  image_url: string | null
  price?: number | null
  value?: string
}
