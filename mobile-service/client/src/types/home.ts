// Mirrors controller-service lib/catalog/homepage-model.ts (HomeModelJson), served by GET /api/home.

export type SectionType =
  | 'hero' | 'offer_slider' | 'trust_strip' | 'category_grid' | 'brand_carousel' | 'product_row'
  | 'category_showcase' | 'deal_of_the_day' | 'promo_banner' | 'featured_for_you' | 'benefits'
  | 'why_us' | 'about' | 'business_cta' | 'countdown_deal' | 'testimonials' | 'recently_viewed'
  | 'category_tabs' | 'bundle_spotlight' | 'back_in_stock' | 'blog_teaser' | 'social_strip' | 'value_stats'
  | 'motion_hero' | 'stories' | 'product_spotlight' | 'rewards_game' | 'slides'

export interface SectionCopy {
  eyebrow?: string
  title?: string
  subtitle?: string
  body?: string
  imageUrl?: string
  /** MP4/WebM for the banner image (promo, about); `imageUrl` is its poster. */
  video?: string
  ctaLabel?: string
  ctaUrl?: string
}

export interface HomeSection {
  id: string
  type: SectionType
  title: string | null
  subtitle: string | null
  eyebrow: string | null
  cta_label: string | null
  cta_url: string | null
  config: Record<string, unknown>
  display_order: number
  layout: 'grid' | 'carousel'
  copy: SectionCopy
  /** Blog and social items may carry an optional `video` beside `imageUrl`. */
  items: Record<string, string>[] | null
}

/** The web's productCardProps, plus the row badge. */
export interface CardProduct {
  id: string
  name: string
  slug: string
  hasVariants: boolean
  displayPrice: number
  mrp: number | null
  mrpDiscount: number
  effectiveStock: number
  primaryImage: { image_url: string; thumbnail_url?: string; blurhash?: string | null } | null
  brandName: string | null
  categoryName: string | null
  discountPct: number
  extraDeliveryDays: number
  isDigital: boolean
  badge?: string | null
}

export interface HeroSlide {
  id?: string
  title?: string
  name?: string
  slug?: string
  subtitle?: string | null
  badge_text?: string | null
  badge_color?: string | null
  image_url?: string | null
  image_url_mobile?: string | null
  hero_image_mobile?: string | null
  hero_image_desktop?: string | null
  blurhash?: string | null
  blurhash_mobile?: string | null
  /** MP4/WebM banner; `image_url` is its poster. */
  video_url?: string | null
  href?: string
}

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
  image_url_card?: string | null
  blurhash_card?: string | null
  /** MP4/WebM for the card and wide slots; image_url_card / image_url are the posters. */
  video_url_card?: string | null
  video_url?: string | null
  cta_label: string | null
  ends_at: string | null
}

export interface HomeCategory {
  id: string
  name: string
  slug: string
  image_url: string | null
  description?: string | null
}

export interface Testimonial {
  id: string
  rating: number
  title: string | null
  comment: string
  author: string
  verified: boolean
  productName: string
  productSlug: string
}

export interface CategoryTab {
  id: string
  name: string
  slug: string
  products: CardProduct[]
}

export interface ValueStat {
  metric: 'orders_shipped' | 'products' | 'cities' | 'customers'
  label: string
  value: number
}

export interface CountdownDeal {
  product: CardProduct
  endsAt: string | null
}

// extras[section.id] for the app-first sections (homepage-sections.ts motionHeroSlides / storyGroups / spotlightConfig).

export interface MotionHeroSlide {
  bgImage: string
  /** MP4/WebM behind the slide; `bgImage` is its poster. */
  bgVideo?: string
  fgImage: string | null
  eyebrow: string | null
  headline: string
  sub: string | null
  ctaLabel: string | null
  url: string | null
}

export interface MotionHeroData {
  slides: MotionHeroSlide[]
  intervalMs: number
}

export interface StorySlide {
  id: string
  image: string
  /** MP4/WebM for the slide; `image` is its poster. */
  video?: string
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

export interface StoriesData {
  groups: StoryGroup[]
}

export interface SpotlightData {
  product: CardProduct
  headline: string | null
  callouts: string[]
}

// extras[section.id] of a slides section (homepage-extras.ts getSlides): every reference resolved, dead ones dropped.
export interface SlideCard {
  id: string
  kind: 'offer' | 'category' | 'product' | 'custom'
  href: string | null
  title: string
  eyebrow: string | null
  sub: string | null
  badge: string | null
  /** A `bg-*` class for the badge pill, when the source sets one. */
  badgeClass: string | null
  ctaLabel: string | null
  image: string | null
  /** Portrait 4:5 picture, when there is one. */
  imageCard: string | null
  /** MP4/WebM for the wide slot and the card; `image` / `imageCard` are the posters. */
  video?: string | null
  videoCard?: string | null
  blurhash: string | null
  blurhashCard: string | null
  price?: number
  mrp?: number | null
  productId?: string
  productSlug?: string
  /** Product slides: the card, for the quick-add sheet. */
  product?: CardProduct
  motion: 'none' | 'kenburns' | 'parallax' | 'reveal'
}

export interface SlidesData {
  layout: 'cards' | 'banner' | 'rail' | 'fade'
  aspect: '4:5' | '1:1' | '16:9'
  autoplay: boolean
  /** 3–20 s; only used with autoplay. */
  intervalSeconds: number
  slides: SlideCard[]
}

// extras[section.id] of a rewards_game section (homepage-sections.ts rewardsGamePublic): no weights, null when unplayable.
export interface RewardsGamePrize {
  id: string
  label: string
  kind: 'percent' | 'fixed' | 'none'
}

export interface RewardsGameData {
  gameKey: string
  mode: 'wheel' | 'scratch'
  playLimit: 'once' | 'daily' | 'weekly'
  prizes: RewardsGamePrize[]
}

// Responses of /api/rewards/game/[gameKey] (lib/rewards/game.ts GamePlay / GameState).
export interface RewardGamePlay {
  prizeId: string
  prizeLabel: string
  playedAt: string
  coupon: {
    id: string
    code: string
    discountType: 'fixed' | 'percentage'
    value: number
    minPurchase: number
    maxDiscount: number | null
    validUntil: string | null
  } | null
}

export interface RewardGameState {
  canPlay: boolean
  nextPlayAt: string | null
  lastPlay: RewardGamePlay | null
}

export interface HomeData {
  heroSlides: HeroSlide[]
  offers: ProductOffer[]
  mainCategories: HomeCategory[]
  topBrands: { id: string; name: string; slug: string; product_count: number }[]
  categoryShowcase: { id: string; name: string; slug: string; products: CardProduct[] }[]
  dealOfTheDay: CardProduct[]
  productRows: Record<string, CardProduct[]>
  freeShippingThreshold: number
  gstEnabled: boolean
  stats: { value: string; label: string }[]
  aboutCopy: string
  storeName: string
  businessLandingUrl: string
  businessSignupUrl: string
  extras: Record<string, unknown>
}

export interface HomeModel {
  sections: HomeSection[]
  data: HomeData
}

/** Every home section component takes the section and the shared data, like the web's SectionRenderer. */
export interface SectionProps {
  section: HomeSection
  data: HomeData
}
