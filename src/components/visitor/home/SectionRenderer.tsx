import HeroCarousel from '@/components/visitor/HeroCarousel'
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
import { sectionLayout, type HomepageSection } from '@/lib/homepage-sections'

export interface SectionData {
  heroSlides: any[]
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
      !!r && typeof r === 'object' && keys.every(k => typeof (r as Record<string, unknown>)[k] === 'string'),
  )
  return rows.length > 0 ? (rows as T[]) : null
}

export default function SectionRenderer({
  section, data, rowIndex,
}: { section: HomepageSection; data: SectionData; rowIndex: number }) {
  const cfg = (section.config ?? {}) as Record<string, unknown>
  const carousel = sectionLayout(section) === 'carousel'

  switch (section.type) {
    case 'hero':
      return <HeroCarousel slides={data.heroSlides} />

    case 'trust_strip':
      return (
        <TrustStrip
          freeShippingThreshold={data.freeShippingThreshold}
          items={tiles<TrustStripItem>(cfg.items, ['icon', 'label'])}
        />
      )

    case 'category_grid':
      if (data.mainCategories.length === 0) return null
      return <CategoryGrid categories={data.mainCategories} title={section.title} eyebrow={section.eyebrow} carousel={carousel} />

    case 'brand_carousel':
      if (data.topBrands.length === 0) return null
      return <BrandCarousel brands={data.topBrands} title={section.title} eyebrow={section.eyebrow} carousel={carousel} />

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
      return (
        <ProductRowSection
          title={section.title ?? 'Products'}
          eyebrow={section.eyebrow ?? ''}
          products={products}
          gstEnabled={data.gstEnabled}
          viewAllHref={section.cta_url ?? '/products'}
          viewAllLabel={section.cta_label ?? 'View All'}
          carousel={carousel}
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
      return <FeaturedForYou />

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
      return <AboutSection aboutCopy={data.aboutCopy} stats={data.stats} storeName={data.storeName} />

    case 'business_cta':
      return <BusinessCta businessLandingUrl={data.businessLandingUrl} businessSignupUrl={data.businessSignupUrl} />

    default:
      return null
  }
}
