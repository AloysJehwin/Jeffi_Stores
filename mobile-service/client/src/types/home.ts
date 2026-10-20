// Mirrors controller-service lib/catalog/homepage-model.ts (HomeModelJson), served by GET /api/home.

export type SectionType =
  | 'hero' | 'offer_slider' | 'trust_strip' | 'category_grid' | 'brand_carousel' | 'product_row'
  | 'category_showcase' | 'deal_of_the_day' | 'promo_banner' | 'featured_for_you' | 'benefits'
  | 'why_us' | 'about' | 'business_cta' | 'countdown_deal' | 'testimonials' | 'recently_viewed'
  | 'category_tabs' | 'bundle_spotlight' | 'back_in_stock' | 'blog_teaser' | 'social_strip' | 'value_stats'

export interface SectionCopy {
  eyebrow?: string
  title?: string
  subtitle?: string
  body?: string
  imageUrl?: string
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
