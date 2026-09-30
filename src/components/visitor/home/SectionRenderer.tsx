import HeroCarousel from '@/components/visitor/HeroCarousel'
import OfferSlider from '@/components/visitor/OfferSlider'
import FeaturedForYou from '@/components/visitor/FeaturedForYou'
import TrustStrip, { type TrustStripItem } from './TrustStrip'
import CategoryGrid from './CategoryGrid'
import ProductRowSection from './ProductRowSection'
import BrandCarousel from './BrandCarousel'
import CategoryShowcase from './CategoryShowcase'
import DealOfTheDay from './DealOfTheDay'
import PromoBanner from './PromoBanner'
import Benefits, { type BenefitItem } from './Benefits'
import WhyUs, { type WhyUsItem } from './WhyUs'
import AboutSection from './AboutSection'
import BusinessCta from './BusinessCta'
import CountdownDealBanner from './CountdownDealBanner'
import TestimonialWall from './TestimonialWall'
import CategoryTabs from './CategoryTabs'
import BlogTeaser, { type BlogTeaserItem } from './BlogTeaser'
import SocialStrip, { type SocialStripItem } from './SocialStrip'
import ValueStats from './ValueStats'
import RecentlyViewed from '@/components/visitor/RecentlyViewed'
import {
  sectionLayout,
  sectionLimit,
  configNumber,
  justLandedDays,
  launchedWithin,
  safeHref,
  SECTION_COPY_DEFAULTS,
  type HomepageSection,
} from '@/lib/homepage-sections'
import { cardPropsFor } from '@/lib/product-card-props'
import type { CategoryTab, CountdownDealData, Testimonial, ValueStat } from '@/lib/homepage-extras'
import type { ProductOffer } from '@/lib/product-offers-shared'

export interface SectionData {
  heroSlides: any[]
  offers: ProductOffer[]
  mainCategories: any[]
  topBrands: any[]
  categoryShowcase: any[]
  dealOfTheDay: any[]
  productRows: Map<string, any[]>
  freeShippingThreshold: number
  gstEnabled: boolean
  stats: { value: string; label: string }[]
  aboutCopy: string
  storeName: string
  businessLandingUrl: string
  businessSignupUrl: string
  /** Per-section data for the section types that load their own (loadSectionExtras). */
  extras: Map<string, unknown>
}

// Per-row styling that the hardcoded page applied by position. Index 0/1/2 reproduce the
// Featured / New Arrivals / Best Sellers looks so a default layout renders unchanged.
const ROW_STYLES = [
  {
    sectionClassName: 'py-12 md:py-20 bg-surface-secondary',
    eyebrowClassName: 'text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1',
    headingClassName: 'text-2xl md:text-4xl font-black text-foreground tracking-tight',
    gridClassName: 'grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5',
    accentBarClassName: 'w-1 h-10 bg-primary-500 rounded-full',
  },
  {
    sectionClassName: 'py-12 md:py-20 bg-surface',
    eyebrowClassName: 'text-accent-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1',
    headingClassName: 'text-2xl md:text-4xl font-black text-foreground tracking-tight',
    gridClassName: 'grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5',
    accentBarClassName: 'w-1 h-10 bg-accent-500 rounded-full',
  },
  {
    sectionClassName: 'py-12 md:py-16 bg-surface-secondary',
    eyebrowClassName: 'text-accent-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1',
    headingClassName: 'text-2xl md:text-3xl font-black text-foreground tracking-tight',
    gridClassName: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4',
    inlineViewAllArrow: true,
  },
]

// Tiles are admin-authored jsonb, so anything malformed is dropped rather than crashing the page.
function tiles<T>(raw: unknown, keys: (keyof T & string)[]): T[] | null {
  if (!Array.isArray(raw)) return null
  const rows = raw.filter(
    (r): r is Record<string, unknown> =>
      !!r && typeof r === 'object' && keys.every(k => typeof (r as Record<string, unknown>)[k] === 'string')
  )
  return rows.length > 0 ? (rows as T[]) : null
}

export default function SectionRenderer({
  section,
  data,
  rowIndex,
}: {
  section: HomepageSection
  data: SectionData
  rowIndex: number
}) {
  const cfg = (section.config ?? {}) as Record<string, unknown>
  const carousel = sectionLayout(section) === 'carousel'
  const extra = data.extras.get(section.id)

  switch (section.type) {
    case 'hero':
      return <HeroCarousel slides={data.heroSlides} />

    case 'offer_slider':
      if (data.offers.length === 0) return null
      return <OfferSlider offers={data.offers} title={section.title} eyebrow={section.eyebrow} />

    case 'trust_strip':
      return (
        <TrustStrip
          freeShippingThreshold={data.freeShippingThreshold}
          items={tiles<TrustStripItem>(cfg.items, ['icon', 'label'])}
        />
      )

    case 'category_grid':
      if (data.mainCategories.length === 0) return null
      return (
        <CategoryGrid
          categories={data.mainCategories}
          title={section.title}
          eyebrow={section.eyebrow}
          carousel={carousel}
        />
      )

    case 'brand_carousel':
      if (data.topBrands.length === 0) return null
      return (
        <BrandCarousel brands={data.topBrands} title={section.title} eyebrow={section.eyebrow} carousel={carousel} />
      )

    case 'category_showcase':
      if (data.categoryShowcase.length === 0) return null
      return <CategoryShowcase items={data.categoryShowcase} title={section.title} eyebrow={section.eyebrow} />

    case 'deal_of_the_day':
      if (data.dealOfTheDay.length === 0) return null
      return (
        <DealOfTheDay
          products={data.dealOfTheDay}
          gstEnabled={data.gstEnabled}
          title={section.title}
          eyebrow={section.eyebrow}
          countdownEndsAt={typeof cfg.countdownEndsAt === 'string' ? cfg.countdownEndsAt : null}
        />
      )

    case 'product_row': {
      const products = data.productRows.get(section.id) ?? []
      if (products.length === 0) return null
      const style = ROW_STYLES[rowIndex % ROW_STYLES.length]
      const newDays = justLandedDays(section)
      return (
        <ProductRowSection
          title={section.title ?? SECTION_COPY_DEFAULTS.product_row.title}
          eyebrow={section.eyebrow ?? ''}
          products={products}
          gstEnabled={data.gstEnabled}
          viewAllHref={section.cta_url ?? SECTION_COPY_DEFAULTS.product_row.ctaUrl}
          viewAllLabel={section.cta_label ?? SECTION_COPY_DEFAULTS.product_row.ctaLabel}
          carousel={carousel}
          badgeFor={newDays ? p => (launchedWithin(p, newDays) ? 'New' : null) : undefined}
          {...style}
        />
      )
    }

    case 'promo_banner':
      return (
        <PromoBanner
          title={section.title}
          subtitle={section.subtitle}
          eyebrow={section.eyebrow}
          imageUrl={typeof cfg.imageUrl === 'string' ? cfg.imageUrl : null}
          imageUrlMobile={typeof cfg.imageUrlMobile === 'string' ? cfg.imageUrlMobile : null}
          blurhash={typeof cfg.blurhash === 'string' ? cfg.blurhash : null}
          ctaLabel={section.cta_label}
          ctaUrl={section.cta_url}
        />
      )

    case 'featured_for_you':
      return <FeaturedForYou title={section.title} />

    case 'benefits':
      return (
        <Benefits
          title={section.title}
          eyebrow={section.eyebrow}
          items={tiles<BenefitItem>(cfg.items, ['icon', 'title', 'sub'])}
        />
      )

    case 'why_us':
      return (
        <WhyUs
          title={section.title}
          eyebrow={section.eyebrow}
          items={tiles<WhyUsItem>(cfg.items, ['icon', 'title', 'desc', 'color'])}
        />
      )

    case 'about':
      return (
        <AboutSection
          eyebrow={section.eyebrow}
          title={section.title}
          aboutCopy={section.subtitle || data.aboutCopy}
          body={typeof cfg.body === 'string' ? cfg.body : null}
          imageUrl={typeof cfg.imageUrl === 'string' ? cfg.imageUrl : null}
          ctaLabel={section.cta_label}
          ctaUrl={section.cta_url}
          stats={tiles<{ value: string; label: string }>(cfg.stats, ['value', 'label']) ?? data.stats}
          storeName={data.storeName}
        />
      )

    case 'business_cta':
      return (
        <BusinessCta
          businessLandingUrl={data.businessLandingUrl}
          businessSignupUrl={data.businessSignupUrl}
          title={section.title}
          subtitle={section.subtitle}
          ctaLabel={section.cta_label}
          ctaUrl={section.cta_url}
        />
      )

    case 'countdown_deal': {
      const deal = extra as CountdownDealData | null | undefined
      if (!deal) return null
      return (
        <CountdownDealBanner
          product={cardPropsFor([deal.product], data.gstEnabled)[0]}
          endsAt={deal.endsAt}
          eyebrow={section.eyebrow}
          title={section.title}
          ctaLabel={section.cta_label}
        />
      )
    }

    case 'testimonials': {
      const items = (extra as Testimonial[] | undefined) ?? []
      if (items.length === 0) return null
      return <TestimonialWall items={items} eyebrow={section.eyebrow} title={section.title} carousel={carousel} />
    }

    case 'recently_viewed':
      return (
        <RecentlyViewed
          title={section.title ?? SECTION_COPY_DEFAULTS.recently_viewed.title}
          limit={sectionLimit(section, 6)}
          minItems={configNumber(section, 'minItems', 2, 12)}
          className="container mx-auto px-4 py-12 md:py-16"
        />
      )

    case 'category_tabs': {
      const tabs = (extra as CategoryTab[] | undefined) ?? []
      if (tabs.length === 0) return null
      return (
        <CategoryTabs
          tabs={tabs.map(t => ({
            id: t.id,
            name: t.name,
            slug: t.slug,
            products: cardPropsFor(t.products, data.gstEnabled),
          }))}
          eyebrow={section.eyebrow}
          title={section.title}
        />
      )
    }

    case 'bundle_spotlight':
    case 'back_in_stock': {
      const products = (extra as any[] | undefined) ?? []
      if (products.length === 0) return null
      const bundle = section.type === 'bundle_spotlight'
      const copy = bundle ? SECTION_COPY_DEFAULTS.bundle_spotlight : SECTION_COPY_DEFAULTS.back_in_stock
      return (
        <ProductRowSection
          title={section.title ?? copy.title}
          eyebrow={section.eyebrow ?? copy.eyebrow}
          products={products}
          gstEnabled={data.gstEnabled}
          viewAllHref={safeHref(section.cta_url) ?? ''}
          viewAllLabel={section.cta_label ?? 'View all'}
          carousel={carousel}
          badgeFor={bundle ? p => (p.is_bundle ? 'Bundle' : null) : () => 'Back in stock'}
          {...ROW_STYLES[bundle ? 1 : 2]}
        />
      )
    }

    case 'blog_teaser': {
      const items = (tiles<BlogTeaserItem>(cfg.items, ['title', 'excerpt', 'url', 'imageUrl']) ?? [])
        .map(i => ({ ...i, url: safeHref(i.url) ?? '', imageUrl: safeHref(i.imageUrl) ?? '' }))
        .filter(i => i.title.trim() && i.url)
      if (items.length === 0) return null
      return (
        <BlogTeaser
          items={items}
          eyebrow={section.eyebrow}
          title={section.title}
          ctaLabel={section.cta_label}
          ctaUrl={safeHref(section.cta_url)}
        />
      )
    }

    case 'social_strip': {
      const items = (tiles<SocialStripItem>(cfg.items, ['imageUrl', 'url', 'caption']) ?? [])
        .map(i => ({ ...i, url: safeHref(i.url) ?? '', imageUrl: safeHref(i.imageUrl) ?? '' }))
        .filter(i => i.url && i.imageUrl)
      if (items.length === 0) return null
      return (
        <SocialStrip
          items={items}
          eyebrow={section.eyebrow}
          title={section.title}
          ctaLabel={section.cta_label}
          ctaUrl={safeHref(section.cta_url)}
        />
      )
    }

    case 'value_stats': {
      const stats = (extra as ValueStat[] | undefined) ?? []
      if (stats.length === 0) return null
      return <ValueStats stats={stats} eyebrow={section.eyebrow} title={section.title} />
    }

    default:
      return null
  }
}
